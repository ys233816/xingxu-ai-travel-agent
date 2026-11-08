import { randomUUID } from "node:crypto";
import { getRuntimeConfig } from "./config.js";
import { createModelClient, PROMPT_METADATA } from "./model-client.js";
import { createLiveTools, TOOL_CONTRACT_METADATA } from "./tools.js";
import { aggregateModelCosts, calculateModelCost } from "./usage-cost.js";
import { MAX_ATTEMPTS_PER_TOOL, MAX_TOOL_CALLS, resolveToolCallBudget } from "./runtime-contract.js";

const MAX_HOTEL_COMMUTE_CANDIDATES = 2;
const MAX_HOTEL_DETAIL_CANDIDATES = 2;
const MAX_DINING_REPLACEMENT_ROUTE_CHECKS = 3;
const RAIN_PATTERN = /雨|暴雨|雷暴|雷阵雨/i;
const WALKING_DEFAULT_MAX_MINUTES = 20;
const EASY_WALKING_DEFAULT_MAX_MINUTES = 30;
const SHORT_COMMUTE_DEFAULT_MAX_MINUTES = 30;
const SLOW_PACE_DEFAULT_MAX_MINUTES = 40;
const LESS_WALKING_ROUTE_WALK_MAX_METERS = 800;
const SCHEDULE_WINDOWS = Object.freeze({
  morning: { label: "上午", start: 8 * 60, end: 12 * 60 },
  afternoon: { label: "下午", start: 13 * 60, end: 18 * 60 },
  lunch: { label: "午餐", start: 11 * 60, end: 14 * 60 },
  dinner: { label: "晚餐", start: 17 * 60, end: 21 * 60 },
  evening: { label: "傍晚", start: 17 * 60, end: 20 * 60 },
});

const KNOWN_CITY_NAMES = [
  "北京", "上海", "天津", "重庆", "石家庄", "唐山", "秦皇岛", "邯郸", "保定", "张家口", "承德", "沧州", "廊坊",
  "太原", "大同", "晋中", "临汾", "运城", "沈阳", "大连", "鞍山", "丹东", "锦州", "长春", "吉林", "延吉",
  "哈尔滨", "齐齐哈尔", "牡丹江", "南京", "无锡", "徐州", "常州", "苏州", "南通", "连云港", "扬州", "镇江",
  "泰州", "盐城", "淮安", "宿迁", "杭州", "宁波", "温州", "嘉兴", "湖州", "绍兴", "金华", "衢州", "舟山",
  "台州", "丽水", "合肥", "芜湖", "蚌埠", "黄山", "池州", "安庆", "福州", "厦门", "泉州", "漳州", "莆田",
  "龙岩", "武夷山", "平潭", "南昌", "九江", "景德镇", "上饶", "赣州", "婺源", "济南", "青岛", "烟台",
  "威海", "潍坊", "淄博", "泰安", "日照", "临沂", "郑州", "洛阳", "开封", "焦作", "新乡", "安阳", "南阳",
  "武汉", "宜昌", "襄阳", "恩施", "荆州", "十堰", "长沙", "张家界", "凤凰", "岳阳", "衡阳", "株洲", "湘潭",
  "广州", "深圳", "珠海", "佛山", "东莞", "中山", "惠州", "汕头", "潮州", "湛江", "肇庆", "南宁", "桂林",
  "北海", "阳朔", "柳州", "防城港", "海口", "三亚", "万宁", "琼海", "成都", "绵阳", "乐山", "宜宾", "泸州",
  "九寨沟", "都江堰", "峨眉山", "贵阳", "遵义", "六盘水", "安顺", "荔波", "黔东南", "昆明", "大理", "丽江",
  "西双版纳", "香格里拉", "腾冲", "曲靖", "玉溪", "拉萨", "日喀则", "林芝", "西安", "咸阳", "宝鸡", "延安",
  "汉中", "兰州", "敦煌", "嘉峪关", "张掖", "天水", "西宁", "格尔木", "海西", "银川", "中卫", "乌鲁木齐",
  "喀什", "吐鲁番", "伊宁", "阿勒泰", "香港", "澳门", "台北", "高雄", "台中", "台南", "花莲",
];

const CITY_NAME_PATTERN = KNOWN_CITY_NAMES
  .sort((a, b) => b.length - a.length)
  .map((city) => city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");
const CITY_MENTION_PATTERN = new RegExp(`(?:${CITY_NAME_PATTERN})(?:市)?`, "g");
const MULTI_CITY_CONNECTOR_PATTERN = /^(?:和|与|及|跟|、|以及|还有|再|然后|接着|再到|再去|顺便|外加)+$/;
const MULTI_CITY_HINT_PATTERN = /两个城市|多个城市|双城|每个城市|各玩|分别玩|分别规划|逐一规划|排进同一份|一起安排|再去|然后去|接着去|再前往/;

function normalizeCityName(value) {
  return String(value ?? "").trim().replace(/市$/, "");
}

function findCityMentions(text) {
  const matches = [];
  for (const match of text.matchAll(CITY_MENTION_PATTERN)) {
    const name = normalizeCityName(match[0]);
    if (!name || match.index === undefined) continue;
    matches.push({ name, start: match.index, end: match.index + match[0].length });
  }
  return matches;
}

export function detectMultipleDestinations(message, previousConstraints = null) {
  const text = String(message ?? "").replace(/\s+/g, "");
  const mentions = findCityMentions(text);
  const uniqueCities = [...new Set(mentions.map((item) => item.name))];

  if (uniqueCities.length >= 2) {
    for (let index = 0; index < mentions.length - 1; index += 1) {
      const current = mentions[index];
      const next = mentions[index + 1];
      if (current.name === next.name) continue;
      const connector = text.slice(current.end, next.start);
      if (MULTI_CITY_CONNECTOR_PATTERN.test(connector)) return uniqueCities;
    }
    if (MULTI_CITY_HINT_PATTERN.test(text)) return uniqueCities;

    const citiesWithDays = uniqueCities.filter((city) => {
      const escaped = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`${escaped}市?(?:的|要|想|计划|玩|待|住|停留|安排|行程)?[\\d一二两三四五六七八九十]+天`).test(text);
    });
    if (citiesWithDays.length >= 2) return uniqueCities;
  }

  const previousDestination = normalizeCityName(previousConstraints?.destination);
  const addAnotherDestination = /再加|加上|增加|还要去|也想去|顺便去|一起去|一起安排|外加/.test(text);
  if (previousDestination && addAnotherDestination) {
    const added = uniqueCities.find((city) => city !== previousDestination);
    if (added) return [previousDestination, added];
  }
  return [];
}

function makeTrace() {
  const events = [];
  let sequence = 0;
  return {
    events,
    add(type, title, detail, extra = {}) {
      sequence += 1;
      const event = { id: `evt-${sequence}`, type, title, detail, time: new Date().toISOString(), ...extra };
      events.push(event);
      return event;
    },
  };
}

export function preflightGuard(message, { previousConstraints = null } = {}) {
  const text = String(message ?? "");
  if (/系统提示词|system\s*prompt|内部工具配置|忽略之前的规则/i.test(text)) {
    return { state: "blocked", boundary: "prompt_injection", message: "我不会展示或修改内部提示词、工具配置与安全规则。", nextStep: "请提供你自己的单目的地旅行需求。" };
  }
  if (/别人的|他人的|其他用户|读取.*订单|查看.*行程/.test(text)) {
    return { state: "blocked", boundary: "privacy", message: "我只能访问你在当前任务中主动提供的旅行信息，不能读取其他用户的行程或订单。", nextStep: "请提供你自己的目的地、日期和人数。" };
  }
  const explicitWriteAction = /(?:帮我|直接|替我|请).{0,16}(?:订|预订|下单|付款|支付|退款|退房|取消订单)/.test(text)
    || /订酒店|酒店.{0,8}(?:订好|预订好)/.test(text);
  const asksForRules = /解释|说明|介绍|规则|政策|是否|支持|有哪些|怎么|如何|区别/.test(text);
  if (explicitWriteAction && !asksForRules) {
    return { state: "blocked", boundary: "write_action", message: "当前版本没有注册预订、支付或退改工具，不能替你改变真实订单。", nextStep: "请通过酒店官方渠道确认房态、价格和退改条件。", refusedTool: "hotel.book" };
  }
  if (/台风|暴雨|灾害/.test(text) && /忽略|不用管|坚持|照常/.test(text)) {
    return { state: "blocked", boundary: "safety", message: "我不能忽略恶劣天气预警或承诺安全。", nextStep: "请先查看当地气象、应急和景区官方公告。" };
  }
  const cities = detectMultipleDestinations(text, previousConstraints);
  if (cities.length >= 2) {
    return {
      state: "blocked",
      boundary: "multi_city",
      message: "当前版本一次只支持一个目的地，暂无法把多个城市合并进同一份可核验行程。请先选择主目的地，或在明确先后顺序后拆成多次规划。",
      nextStep: `请选择一个主目的地；你想先规划${cities.slice(0, 2).join("还是")}？`,
      destinations: cities,
    };
  }
  return null;
}

function missingConstraints(constraints) {
  const missing = [];
  if (!constraints.destination) missing.push("目的地");
  if (!constraints.startDate) missing.push("出发日期");
  if (!constraints.days) missing.push("停留天数");
  return missing;
}

const CHINESE_NUMBER_VALUES = Object.freeze({
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
});

function parseSpokenNumber(value) {
  const text = String(value ?? "").trim();
  if (/^\d+$/.test(text)) return Number(text);
  if (text === "十") return 10;
  const tenMatch = text.match(/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/);
  if (tenMatch) {
    return (CHINESE_NUMBER_VALUES[tenMatch[1]] ?? 1) * 10
      + (CHINESE_NUMBER_VALUES[tenMatch[2]] ?? 0);
  }
  return CHINESE_NUMBER_VALUES[text] ?? null;
}

function deriveDailyAttractionLimit(value) {
  const text = String(value ?? "").replace(/\s+/g, "");
  const scheduled = text.match(/(?:每天|每日).{0,8}?(?:安排|游览|去|逛)([0-9一二两三四五六七八九十]+)个?(?:主要)?景点/);
  const reduced = text.match(/(?:每天|每日).{0,10}?景点.{0,8}?(?:减到|只安排|不超过|限制为|保留)([0-9一二两三四五六七八九十]+)个?/);
  return parseSpokenNumber(scheduled?.[1]) ?? parseSpokenNumber(reduced?.[1]) ?? null;
}

function uniqueStrings(values) {
  return [...new Set(values.map((item) => String(item ?? "").trim()).filter(Boolean))];
}

const SEA_VIEW_EXCLUSION_PATTERN = /海军博物馆|海底世界|海洋馆|海鲜/;
const SEA_VIEW_PATTERN = /海湾|海滩|沙滩|海滨|海岸|海边|滨海|海岛|码头|帆船|栈桥|奥帆/;

function isVerifiedSeaViewAttraction(item) {
  const text = [item?.name ?? item?.title, item?.type, item?.address].filter(Boolean).join(" ");
  return SEA_VIEW_PATTERN.test(text) && !SEA_VIEW_EXCLUSION_PATTERN.test(text);
}

function clockMinutes(value) {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(value ?? "").trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function openingWindows(value) {
  const text = String(value ?? "").trim();
  if (!text || /需确认|待确认|未知/.test(text)) return null;
  if (/全天|24\s*小时|24h/i.test(text)) return [{ start: 0, end: 24 * 60 }];
  const windows = [];
  for (const match of text.matchAll(/(\d{1,2}:\d{2})\s*[-–—至]\s*(\d{1,2}:\d{2})/g)) {
    const start = clockMinutes(match[1]);
    const end = clockMinutes(match[2]);
    if (start === null || end === null) continue;
    if (end > start) windows.push({ start, end });
    else if (end < start) windows.push({ start, end: 24 * 60 }, { start: 0, end });
    else windows.push({ start: 0, end: 24 * 60 });
  }
  return windows.length ? windows : null;
}

const OPENING_WEEKDAYS = Object.freeze({ 周日: 0, 周一: 1, 周二: 2, 周三: 3, 周四: 4, 周五: 5, 周六: 6 });

function openingWeekdayAllowed(value, isoDate) {
  const text = String(value ?? "");
  const weekday = new Date(`${isoDate}T12:00:00+08:00`).getDay();
  if (/周末|周六|周日/.test(text) && !/周一至周日|每日|每天/.test(text) && weekday >= 1 && weekday <= 5 && /仅|只|周末/.test(text)) return false;
  if (/工作日/.test(text) && (weekday === 0 || weekday === 6)) return false;
  for (const match of text.matchAll(/(周[一二三四五六日])\s*(?:至|到|-)\s*(周[一二三四五六日])/g)) {
    const start = OPENING_WEEKDAYS[match[1]];
    const end = OPENING_WEEKDAYS[match[2]];
    const inRange = start <= end ? weekday >= start && weekday <= end : weekday >= start || weekday <= end;
    if (!inRange) return false;
  }
  const explicitDays = [...text.matchAll(/周[一二三四五六日]/g)].map((match) => OPENING_WEEKDAYS[match[0]]);
  if (explicitDays.length === 1 && !/(?:至|到|-)/.test(text) && weekday !== explicitDays[0]) return false;
  return true;
}

function openingStatusForSlot(item, isoDate, slot, openValue = item?.open) {
  if (!item?.openVerified && !item?.open) return { status: "unknown", reason: "营业时间未取得" };
  if (!item?.openVerified) return { status: "unknown", reason: "营业时间需官方确认" };
  if (!openingWeekdayAllowed(openValue, isoDate)) return { status: "conflict", reason: `该日期不在“${openValue}”的开放星期内` };
  const windows = openingWindows(openValue);
  if (!windows) return { status: "unknown", reason: `无法解析营业时间“${openValue}”` };
  const range = SCHEDULE_WINDOWS[slot];
  if (!range) return { status: "unknown", reason: `未知时段 ${slot}` };
  const overlap = windows.some((window) => window.end > range.start && window.start < range.end);
  return overlap
    ? { status: "compatible", reason: `${range.label}与“${openValue}”有可用交集` }
    : { status: "conflict", reason: `${range.label}安排在 ${range.start / 60}:00–${range.end / 60}:00，但营业时间为“${openValue}”` };
}

function deriveHardConstraints(textValue, existing = {}) {
  const text = String(textValue ?? "").replace(/\s+/g, "");
  const constraints = { ...existing };
  if (/(?:每天|每日|每一天).{0,10}室内(?:备选|景点)/.test(text)) constraints.dailyIndoorBackup = true;
  if (/(?:午后|下午).{0,8}休息|留出休息/.test(text)) constraints.afternoonRest = true;
  if (/(?:每天|每日).{0,12}海景/.test(text)) constraints.dailySeaView = true;
  if (/想看海|去看海|看海景|去海边|想看海景/.test(text)) constraints.seaView = true;
  if (/通勤短|通勤更短|少通勤|缩短首日通勤/.test(text)) constraints.shortCommute = true;
  if (/少走路|不想走太多|步行少|尽量少走/.test(text)) constraints.lessWalking = true;
  if (/节奏慢|慢节奏|慢一点|慢一些|节奏适中|不要太赶|不要安排太满|行程别太满/.test(text)) constraints.slowPace = true;
  if (/avoidearlystarts?|不要早起|避免早起/.test(text)) constraints.avoidEarlyStart = true;
  if (/easy\s*walking/i.test(text)) constraints.easyWalking = true;
  if (/少走台阶|少.*长坡|优先平缓|避免连续高强度步行/.test(text)) constraints.avoidStepsAndSlopes = true;
  if (/不想暴晒|避免暴晒/.test(text)) constraints.avoidSunExposure = true;
  if (/具体天气|天气预报/.test(text)) constraints.specificWeather = true;
  return constraints;
}

function deriveAdjustmentContext(message, previousPlan, previousConstraints, decision) {
  const text = String(message ?? "").replace(/\s+/g, "");
  const base = {
    ...(previousConstraints ?? {}),
    ...(previousPlan?.constraints ?? {}),
  };
  const modelConstraints = decision.constraints ?? {};
  const fullRefresh = /全部重做|重新规划|从头规划|整份行程重做/.test(text);
  const releaseAttractions = /景点(?:可以|都)?(?:换|改)|重新选景点|重选景点|替换景点/.test(text);
  const addAttractions = /增加|新增|加一个|多加/.test(text) && /景点/.test(text);
  const removeAttractions = /删除|去掉|减少|减到|减为一个|只留/.test(text) && /景点/.test(text);
  const maxAttractionsPerDay = deriveDailyAttractionLimit(text)
    ?? modelConstraints.maxAttractionsPerDay
    ?? base.maxAttractionsPerDay
    ?? null;
  const attractionChange = fullRefresh || releaseAttractions || addAttractions || removeAttractions || Boolean(maxAttractionsPerDay);
  const needsAttractionSearch = fullRefresh || releaseAttractions || addAttractions;

  const diningPreserve = /(?:保留|不变).{0,8}(?:午餐|晚餐|餐饮)|(?:午餐|晚餐|餐饮).{0,8}(?:保留|不变)/.test(text);
  const diningMention = /午餐|晚饭|晚餐|餐饮|餐厅|本地菜|清淡|海鲜|小吃/.test(text);
  const diningChangeVerb = /换|改|清淡|本地菜|海鲜|小吃|更近/.test(text);
  const specificDiningMatch = text.match(/第([0-9一二两三四五六七八九十]+)天(?:的)?(午餐|午饭|晚饭|晚餐).{0,5}(?:换|改)/);
  const specificDiningDay = parseSpokenNumber(specificDiningMatch?.[1]);
  const specificDiningTime = specificDiningMatch?.[2]?.replace("午饭", "午餐").replace("晚饭", "晚餐") ?? null;
  const diningChange = !diningPreserve && diningMention && diningChangeVerb;
  const diningSlots = specificDiningMatch && specificDiningDay
    ? [{ day: specificDiningDay, time: specificDiningTime }]
    : [];

  const hotelPreferenceLocked = /(?:保留|不变).{0,8}酒店偏好|酒店偏好.{0,8}(?:保留|不变)/.test(text);
  const hotelChange = !hotelPreferenceLocked
    && /酒店|住宿/.test(text)
    && /换|改|优先|附近|区域|更短|舒适/.test(text);
  const hotelAreaMatch = text.match(/酒店(?:优先)?(?:换到|改到|靠近|位于)([^，。；]+?)(?:附近|周边|区域)/);
  const hotelArea = hotelAreaMatch?.[1]?.trim() || modelConstraints.hotelArea || base.hotelArea || null;

  const shiftMatch = text.match(/(推迟|延后|提前)([0-9一二两三四五六七八九十]+)天/);
  const parsedShift = parseSpokenNumber(shiftMatch?.[2]);
  const dateShiftDays = shiftMatch && parsedShift
    ? (shiftMatch[1] === "提前" ? -parsedShift : parsedShift)
    : 0;
  const explicitDate = text.match(/20\d{2}-\d{2}-\d{2}/)?.[0] ?? null;
  const daysMatch = text.match(/(?:玩|待|安排|改成|变为|行程(?:调整)?为?)([0-9一二两三四五六七八九十]+)天/);
  const explicitDays = parseSpokenNumber(daysMatch?.[1]);
  const travelerChangeMatch = text.match(/([0-9一二两三四五六七八九十]+)个?人.{0,6}(?:改成|变成)([0-9一二两三四五六七八九十]+)个?人/);
  const travelerCount = parseSpokenNumber(travelerChangeMatch?.[2])
    ?? (/(?:人数|成人|游客)/.test(text)
      ? parseSpokenNumber(text.match(/([0-9一二两三四五六七八九十]+)个?人/)?.[1])
      : null);
  const travelersChanged = Number.isInteger(travelerCount) && travelerCount > 0;
  const datesChanged = Boolean(explicitDate || dateShiftDays);
  const startDate = explicitDate ?? addDays(base.startDate, dateShiftDays);
  const days = explicitDays ?? base.days ?? null;
  const travelers = travelerCount ?? base.travelers ?? null;
  const preferences = uniqueStrings([
    ...(base.preferences ?? []),
    ...(modelConstraints.preferences ?? []),
    ...(diningChange ? [text.match(/(清淡|本地菜|海鲜|小吃)/)?.[1]].filter(Boolean) : []),
  ]);
  const constraints = {
    ...base,
    destination: base.destination ?? modelConstraints.destination ?? null,
    startDate,
    days,
    travelers,
    currency: "CNY",
    preferences,
    dateShiftDays,
    hotelArea,
    maxAttractionsPerDay,
    hardConstraints: deriveHardConstraints(text, base.hardConstraints ?? {}),
  };

  const affected = new Set();
  if (datesChanged || fullRefresh) {
    affected.add("weather");
    affected.add("itinerary");
    affected.add("routes");
    affected.add("hotel");
  }
  if (attractionChange) {
    affected.add("itinerary");
    affected.add("routes");
  }
  if (diningChange) {
    affected.add("itinerary");
    affected.add("routes");
  }
  if (hotelChange || travelersChanged) affected.add("hotel");
  if (!affected.size) {
    for (const module of decision.affectedModules ?? []) affected.add(module);
  }
  if (!affected.size) {
    affected.add("itinerary");
    affected.add("routes");
  }

  const preservation = {
    dates: !datesChanged,
    attractions: {
      mode: attractionChange ? (maxAttractionsPerDay && !needsAttractionSearch ? "trimmed" : "changed") : "all",
      maxPerDay: maxAttractionsPerDay,
    },
    dining: {
      mode: diningChange ? (diningSlots.length ? "slots_changed" : "changed") : "all",
      slots: diningSlots,
    },
    hotelPreferences: !hotelChange,
  };
  return {
    constraints,
    preservation,
    hotelArea,
    fullRefresh,
    diningChanged: diningChange,
    diningSlots,
    needs: {
      weather: fullRefresh || datesChanged,
      attractions: fullRefresh || needsAttractionSearch,
      dining: fullRefresh || diningChange,
      hotel: fullRefresh || hotelChange || datesChanged || travelersChanged,
    },
    affectedModules: [...affected],
    summary: {
      datesChanged,
      dateShiftDays,
      attractionsChanged: attractionChange,
      maxAttractionsPerDay,
      diningChanged: diningChange,
      diningSlots,
      hotelChanged: hotelChange || datesChanged || travelersChanged,
      hotelArea,
    },
  };
}

function isRainyForecast(forecast) {
  if (!forecast) return false;
  const precipitation = Number.parseFloat(String(forecast.precipitation ?? "").replace("%", ""));
  return RAIN_PATTERN.test(String(forecast.condition ?? "")) || (Number.isFinite(precipitation) && precipitation >= 50);
}

function chooseHotel(hotels, { hotelArea = null, travelers = 2 } = {}) {
  const bookable = hotels.filter((hotel) => Boolean(chooseRoom(hotel, { travelers })));
  if (!bookable.length) return null;
  return [...bookable].sort((a, b) => compareHotelCandidates(a, b, { hotelArea, travelers }))[0] ?? null;
}

function roomCapacity(room, roomCount) {
  return Number.isFinite(room?.maxOccupancy) ? room.maxOccupancy * roomCount : null;
}

function chooseRoom(hotel, { travelers = 2 } = {}) {
  const roomCount = Math.max(1, Number(hotel?.roomCount || Math.ceil(Number(travelers || 1) / 2)));
  return [...(hotel?.rooms ?? [])]
    .filter((room) => room.isAvailable && Number.isFinite(room.totalPrice))
    .filter((room) => {
      const capacity = roomCapacity(room, roomCount);
      if (!Number.isFinite(capacity) || capacity < travelers) return false;
      return !Number.isFinite(room.inventoryCount) || room.inventoryCount >= roomCount;
    })
    .map((room) => ({
      ...room,
      roomCount,
      totalCapacity: roomCapacity(room, roomCount),
      capacityVerified: Number.isFinite(roomCapacity(room, roomCount)),
      inventorySufficient: !Number.isFinite(room.inventoryCount) || room.inventoryCount >= roomCount,
    }))
    .sort((a, b) => {
      if (a.isOnRequest !== b.isOnRequest) return a.isOnRequest ? 1 : -1;
      return a.totalPrice - b.totalPrice;
    })[0] ?? null;
}

function uniqueAttractions(attractions) {
  const seen = new Set();
  return attractions.filter((item) => {
    if (!item?.name || !item.location) return false;
    const key = item.id || `${item.name}:${item.location}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueDining(dining) {
  const seen = new Set();
  return dining.filter((item) => {
    if (!item?.name || !item.location) return false;
    const key = item.id || `${item.name}:${item.location}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizedMatchText(value) {
  return String(value ?? "").replace(/\s+/g, "").toLocaleLowerCase("zh-CN");
}

function hotelMatchesArea(hotel, hotelArea) {
  const area = normalizedMatchText(hotelArea);
  if (!area) return false;
  return [hotel?.area, hotel?.name, hotel?.address]
    .some((value) => normalizedMatchText(value).includes(area));
}

function isBookableHotel(hotel, travelers = 2) {
  return Boolean(chooseRoom(hotel, { travelers }));
}

function compareHotelCandidates(a, b, { hotelArea = null, travelers = 2 } = {}) {
  const aBookable = isBookableHotel(a, travelers) ? 0 : 1;
  const bBookable = isBookableHotel(b, travelers) ? 0 : 1;
  if (aBookable !== bBookable) return aBookable - bBookable;
  if (hotelArea) {
    const aArea = hotelMatchesArea(a, hotelArea) ? 0 : 1;
    const bArea = hotelMatchesArea(b, hotelArea) ? 0 : 1;
    if (aArea !== bArea) return aArea - bArea;
  }
  const aMinutes = Number.isFinite(a.commuteMinutes) ? a.commuteMinutes : Number.POSITIVE_INFINITY;
  const bMinutes = Number.isFinite(b.commuteMinutes) ? b.commuteMinutes : Number.POSITIVE_INFINITY;
  if (aMinutes !== bMinutes) return aMinutes - bMinutes;
  const ratingDifference = Number.parseFloat(b.rating || 0) - Number.parseFloat(a.rating || 0);
  if (ratingDifference !== 0) return ratingDifference;
  return String(a.name || "").localeCompare(String(b.name || ""), "zh-CN");
}

function attractionItemsFromDay(day) {
  return (day?.items ?? []).filter((item) => item.time === "上午" || item.time === "下午");
}

function mealItemFromDay(day, time) {
  return (day?.items ?? []).find((item) => item.time === time) ?? null;
}

function diningSlotIsChanged(lock, day, time) {
  const diningLock = lock?.dining;
  if (diningLock?.mode === "changed") return true;
  if (diningLock?.mode !== "slots_changed") return false;
  return (diningLock.slots ?? []).some((slot) => slot.day === day && slot.time === time);
}

function applyCommuteToMeal(item, commute) {
  if (!item || !commute) return item;
  return {
    ...item,
    routeVerified: Boolean(commute.verified),
    route: commute.verified ? {
      from: commute.from,
      to: commute.to,
      mode: commute.mode,
      minutes: commute.minutes,
      distanceMeters: commute.distanceMeters,
    } : null,
  };
}

function scheduledAttractionsFromDay(day, attractions) {
  const attractionsByName = new Map(uniqueAttractions(attractions).map((item) => [item.name, item]));
  return (day?.items ?? [])
    .filter((item) => ["上午", "下午"].includes(item.time) && ["景点", "室内景点"].includes(item.type))
    .map((item) => attractionsByName.get(item.title) ?? { name: item.title, location: null });
}

function coordinateMeters(location) {
  const [longitude, latitude] = String(location || "").split(",").map(Number);
  return Number.isFinite(longitude) && Number.isFinite(latitude) ? { longitude, latitude } : null;
}

function approximateDistanceMeters(origin, destination) {
  const start = coordinateMeters(origin);
  const end = coordinateMeters(destination);
  if (!start || !end) return Number.POSITIVE_INFINITY;
  const radians = (value) => (value * Math.PI) / 180;
  const latitudeDelta = radians(end.latitude - start.latitude);
  const longitudeDelta = radians(end.longitude - start.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(start.latitude)) * Math.cos(radians(end.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function chooseNearbyDining(dining, anchor, used, excluded = new Set(), preferredName = null, schedule = null) {
  const ranked = dining
    .filter((restaurant) => !schedule || openingStatusForSlot(restaurant, schedule.date, schedule.slot).status !== "conflict")
    .map((restaurant) => ({ restaurant, distanceMeters: approximateDistanceMeters(anchor?.location, restaurant.location) }))
    .sort((a, b) => {
      if (a.distanceMeters !== b.distanceMeters) return a.distanceMeters - b.distanceMeters;
      return Number.parseFloat(b.restaurant.rating || 0) - Number.parseFloat(a.restaurant.rating || 0);
    });
  const preferred = preferredName
    ? ranked.find((item) => item.restaurant.name === preferredName
      && !used.has(item.restaurant.id)
      && !excluded.has(item.restaurant.id)
      && !excluded.has(item.restaurant.name))
    : null;
  const next = preferred
    ?? ranked.find((item) => !used.has(item.restaurant.id) && !excluded.has(item.restaurant.id) && !excluded.has(item.restaurant.name))
    ?? ranked.find((item) => !used.has(item.restaurant.id))
    ?? ranked[0];
  if (!next) return null;
  used.add(next.restaurant.id);
  return next;
}

function preferredRouteMode(origin, destination, { lessWalking = false } = {}) {
  const distanceMeters = approximateDistanceMeters(origin, destination);
  const walkingLimit = lessWalking ? LESS_WALKING_ROUTE_WALK_MAX_METERS : 1500;
  return Number.isFinite(distanceMeters) && distanceMeters <= walkingLimit ? "walking" : "driving";
}

function diningRouteTargetsFromDays(days, attractions, dining) {
  const attractionsByName = new Map(uniqueAttractions(attractions).map((item) => [item.name, item]));
  const diningByName = new Map(uniqueDining(dining).map((item) => [item.name, item]));
  return days.flatMap((day) => {
    const first = attractionsByName.get(day.items.find((item) => item.time === "上午")?.title);
    const second = attractionsByName.get(day.items.find((item) => item.time === "下午")?.title);
    const lunch = diningByName.get(day.items.find((item) => item.time === "午餐" && item.type === "真实餐厅")?.title);
    const dinner = diningByName.get(day.items.find((item) => item.time === "晚餐" && item.type === "真实餐厅")?.title);
    return [
      first && lunch ? { day: day.day, time: "午餐", anchor: first, restaurant: lunch } : null,
      (second ?? first) && dinner ? { day: day.day, time: "晚餐", anchor: second ?? first, restaurant: dinner } : null,
    ].filter(Boolean);
  });
}

function diningAnchorForSlot(day, time, attractions) {
  if (!day) return null;
  const firstTitle = day.items.find((item) => item.time === "上午")?.title;
  const secondTitle = day.items.find((item) => item.time === "下午")?.title;
  const targetTitle = time === "晚餐" ? secondTitle ?? firstTitle : firstTitle;
  return uniqueAttractions(attractions).find((item) => item.name === targetTitle) ?? null;
}

function diningItem(time, candidate, anchor, commute = null) {
  if (!candidate) return {
    time,
    type: "待补充",
    title: "暂无匹配的真实餐厅",
    note: "高德没有返回可用餐饮 POI，系统未虚构餐厅。",
  };
  const { restaurant, distanceMeters } = candidate;
  const distance = commute?.verified
    ? `高德实测${commute.mode}约 ${commute.minutes} 分钟，${(commute.distanceMeters / 1000).toFixed(1)} km`
    : Number.isFinite(distanceMeters)
      ? `距${anchor.name}直线约 ${(distanceMeters / 1000).toFixed(1)} km，通勤时间待核验`
      : "距离待确认";
  const rating = restaurant.rating ? `高德评分 ${restaurant.rating}` : "评分暂缺";
  return {
    time,
    type: "真实餐厅",
    title: restaurant.name,
    note: `${restaurant.cuisine} · ${restaurant.address} · 营业：${restaurant.open} · ${rating} · ${distance}`,
    routeVerified: Boolean(commute?.verified),
    route: commute?.verified ? {
      from: commute.from,
      to: commute.to,
      mode: commute.mode,
      minutes: commute.minutes,
      distanceMeters: commute.distanceMeters,
    } : null,
  };
}

function pickIndoorBackup(indoor, usedAttractions) {
  return indoor.find((item) => !usedAttractions.has(item.name)) ?? indoor[0] ?? null;
}

function buildDays(constraints, attractions, dining, routes, weather = [], diningCommutes = [], options = {}) {
  const clean = uniqueAttractions(attractions);
  const cleanDining = uniqueDining(dining);
  const indoor = clean.filter((item) => item.indoor);
  const outdoor = clean.filter((item) => !item.indoor);
  const weatherByDate = new Map(weather.map((item) => [item.date, item]));
  const attractionsByName = new Map(clean.map((item) => [item.name, item]));
  const previousDays = options.previousDays ?? [];
  const lock = options.lock ?? null;
  const hardConstraints = constraints.hardConstraints ?? {};
  const preferIndoorAttractions = Boolean(hardConstraints.avoidSunExposure);
  const wantsSeaView = Boolean(hardConstraints.seaView || hardConstraints.dailySeaView);
  const diningSelections = options.diningSelections ?? new Map();
  const diningFallbacks = options.diningFallbacks ?? new Set();
  const attractionLockMode = lock?.attractions?.mode ?? "changed";
  const maxAttractionsPerDay = Math.max(
    1,
    Number(options.maxAttractionsPerDay ?? constraints.maxAttractionsPerDay ?? (preferIndoorAttractions ? 1 : 2))
  );
  let seaViewScheduled = false;
  const days = [];
  const weatherAdaptations = [];
  const warnings = [];
  const usedDining = new Set();
  const usedAttractions = new Set();
  const scheduledAttractionLocations = [];
  const pendingAttractionHours = new Set();
  const pendingDiningHours = new Set();
  if (!cleanDining.length) warnings.push("高德没有返回可验证的餐厅 POI，餐饮时段已明确标记待补充。");
  for (let index = 0; index < constraints.days; index += 1) {
    const date = addDays(constraints.startDate, index);
    const forecast = weatherByDate.get(date);
    const rainy = isRainyForecast(forecast);
    const previousDay = previousDays[index] ?? null;
    const previousAttractionItems = attractionItemsFromDay(previousDay);
    const preserveAttractions = Boolean(previousDay && ["all", "trimmed"].includes(attractionLockMode));
    const preservedAttractionItems = preserveAttractions
      ? previousAttractionItems.slice(0, maxAttractionsPerDay)
      : [];
    const lockedWeatherConflict = rainy && preservedAttractionItems.some((item) => item.type === "景点");
    const dryPool = outdoor.length ? outdoor : clean;
    const conflictsWithScheduledPlace = (item) => scheduledAttractionLocations
      .some((scheduled) => approximateDistanceMeters(scheduled.location, item.location) < 300);
    const selectFreshAttractions = (pool) => {
      const selectedWithSlots = [];
      for (const slot of ["morning", "afternoon"].slice(0, maxAttractionsPerDay)) {
        const item = pool.find((candidate) => {
          if (usedAttractions.has(candidate.name)) return false;
          if (openingStatusForSlot(candidate, date, slot).status === "conflict") return false;
          const tooClose = conflictsWithScheduledPlace(candidate)
            || selectedWithSlots.some(({ item: chosen }) => approximateDistanceMeters(chosen.location, candidate.location) < 300);
          return !tooClose;
        });
        if (item) selectedWithSlots.push({ item, slot });
      }
      selectedWithSlots.forEach(({ item }) => usedAttractions.add(item.name));
      return selectedWithSlots;
    };
    const selectedWithSlots = preserveAttractions
      ? []
      : rainy || preferIndoorAttractions
        ? selectFreshAttractions(indoor)
        : selectFreshAttractions(dryPool);
    const selected = selectedWithSlots.map(({ item }) => item);

    if (preservedAttractionItems.length) {
      preservedAttractionItems.forEach((item) => usedAttractions.add(item.title));
      preservedAttractionItems.forEach((item) => {
        const source = attractionsByName.get(item.title);
        if (source) {
          scheduledAttractionLocations.push(source);
          if (!source.openVerified) pendingAttractionHours.add(source.name);
        }
      });
    } else {
      scheduledAttractionLocations.push(...selected);
    }

    if (!preservedAttractionItems.length && !selected.length) {
      const reason = rainy
        ? `和风天气预测“${forecast?.condition}”，但高德没有返回可识别的室内 POI。系统没有继续安排未经确认的户外地点。`
        : "高德没有返回可验证的景点 POI。";
      days.push({
        day: index + 1,
        date,
        title: `${constraints.destination} · 第 ${index + 1} 天`,
        weatherHint: forecast ? `${forecast.condition} ${forecast.low}–${forecast.high}℃` : "天气暂不可用",
        weatherAdaptation: rainy ? {
          type: "rain_no_indoor",
          condition: forecast.condition,
          message: reason,
        } : null,
        items: rainy ? [{
          time: "全天",
          type: "待确认",
          title: "室内地点暂不可用",
          note: reason,
        }] : [],
      });
      if (rainy) {
        warnings.push(`第 ${index + 1} 天预测${forecast.condition}，但没有可验证的室内 POI，已停止填充户外景点。`);
        weatherAdaptations.push({ day: index + 1, date, condition: forecast.condition, message: reason, switched: false });
      }
      continue;
    }

    const first = preservedAttractionItems.length
      ? attractionsByName.get(preservedAttractionItems[0].title) ?? {
          name: preservedAttractionItems[0].title,
          location: null,
        }
      : selected[0];
    const second = preservedAttractionItems.length > 1
      ? attractionsByName.get(preservedAttractionItems[1].title) ?? {
          name: preservedAttractionItems[1].title,
          location: null,
        }
      : selected[1];
    selected.forEach((attraction) => {
      if (!attraction.openVerified) pendingAttractionHours.add(attraction.name);
    });
    const itemType = rainy || preferIndoorAttractions ? "室内景点" : "景点";
    const freshAttractionItem = (time, attraction) => ({
      time,
      type: itemType,
      title: attraction.name,
      note: `${attraction.address} · 开放：${attraction.open}${attraction.openVerified ? "（高德公开信息）" : "（需官方确认）"} · 票价需确认`,
    });
    const items = hardConstraints.avoidEarlyStart ? [{
      time: "出发",
      type: "节奏",
      title: "10:00 后开始",
      note: "按你不早起的要求预留充足出发时间。",
    }] : [];
    items.push(preservedAttractionItems[0]
      ? { ...preservedAttractionItems[0] }
      : freshAttractionItem(selectedWithSlots[0]?.slot === "afternoon" ? "下午" : "上午", first));
    const lunchPreserved = Boolean(previousDay)
      && (!diningSlotIsChanged(lock, index + 1, "午餐") || diningFallbacks.has(`${index + 1}-午餐`))
      && Boolean(mealItemFromDay(previousDay, "午餐"));
    const previousLunch = mealItemFromDay(previousDay, "午餐");
    const lunchChanged = diningSlotIsChanged(lock, index + 1, "午餐");
    const lunchPool = lunchChanged && options.changedDining?.length ? options.changedDining : cleanDining;
    const lunch = lunchPreserved
      ? null
      : chooseNearbyDining(
        lunchPool,
        first,
        usedDining,
        new Set(lunchChanged && previousLunch ? [previousLunch.title] : []),
        lunchChanged ? diningSelections.get(`${index + 1}-午餐`) : null,
        { date, slot: "lunch" },
      );
    const lunchCommute = diningCommutes.find((item) => item.day === index + 1 && item.time === "午餐" && item.verified) ?? null;
    if (lunchPreserved) {
      const preserved = mealItemFromDay(previousDay, "午餐");
      const preservedRestaurant = cleanDining.find((item) => item.name === preserved.title);
      if (preservedRestaurant?.id) usedDining.add(preservedRestaurant.id);
      items.push(applyCommuteToMeal(preserved, lunchCommute));
    } else {
      if (lunch?.restaurant && !lunch.restaurant.openVerified) pendingDiningHours.add(lunch.restaurant.name);
      items.push(diningItem("午餐", lunch, first, lunchCommute));
      if (lunchChanged && previousLunch && lunch?.restaurant?.name === previousLunch.title) {
        warnings.push(`第 ${index + 1} 天午餐请求更换，但本轮真实餐饮搜索没有返回可区分的替代餐厅，已明确保留原餐厅。`);
      }
    }
    if (index === 0 && routes[0]) {
      items.push({ time: "前往下一景点", type: routes[0].mode, title: `${routes[0].from} → ${routes[0].to}`, note: `高德实测约 ${routes[0].minutes} 分钟，${routes[0].distanceMeters} 米` });
    }
    if (preservedAttractionItems[1]) items.push({ ...preservedAttractionItems[1] });
    else if (second) items.push(freshAttractionItem(selectedWithSlots[1]?.slot === "morning" ? "上午" : "下午", second));
    if (hardConstraints.afternoonRest) {
      items.push({
        time: "午后",
        type: "休息",
        title: "留出自由休息时间",
        note: "按你的节奏要求，不安排额外强制景点。",
      });
    }
    const dinnerAnchor = second || first;
    const dinnerPreserved = Boolean(previousDay)
      && (!diningSlotIsChanged(lock, index + 1, "晚餐") || diningFallbacks.has(`${index + 1}-晚餐`))
      && Boolean(mealItemFromDay(previousDay, "晚餐"));
    const previousDinner = mealItemFromDay(previousDay, "晚餐");
    const dinnerChanged = diningSlotIsChanged(lock, index + 1, "晚餐");
    const dinnerPool = dinnerChanged && options.changedDining?.length ? options.changedDining : cleanDining;
    const dinner = dinnerPreserved
      ? null
      : chooseNearbyDining(
        dinnerPool,
        dinnerAnchor,
        usedDining,
        new Set(dinnerChanged && previousDinner ? [previousDinner.title] : []),
        dinnerChanged ? diningSelections.get(`${index + 1}-晚餐`) : null,
        { date, slot: "dinner" },
      );
    const dinnerCommute = diningCommutes.find((item) => item.day === index + 1 && item.time === "晚餐" && item.verified) ?? null;
    if (dinnerPreserved) {
      const preserved = mealItemFromDay(previousDay, "晚餐");
      const preservedRestaurant = cleanDining.find((item) => item.name === preserved.title);
      if (preservedRestaurant?.id) usedDining.add(preservedRestaurant.id);
      items.push(applyCommuteToMeal(preserved, dinnerCommute));
    } else {
      if (dinner?.restaurant && !dinner.restaurant.openVerified) pendingDiningHours.add(dinner.restaurant.name);
      items.push(diningItem("晚餐", dinner, dinnerAnchor, dinnerCommute));
      if (dinnerChanged && previousDinner && dinner?.restaurant?.name === previousDinner.title) {
        warnings.push(`第 ${index + 1} 天晚餐请求更换，但本轮真实餐饮搜索没有返回可区分的替代餐厅，已明确保留原餐厅。`);
      }
    }
    const mainSeaView = [first, second].find((item) => item && isVerifiedSeaViewAttraction(item));
    if (wantsSeaView && !rainy && mainSeaView) seaViewScheduled = true;
    const shouldAddSeaView = wantsSeaView
      && !rainy
      && !mainSeaView
      && (hardConstraints.dailySeaView || !seaViewScheduled);
    if (shouldAddSeaView) {
      const seaView = clean.find((item) => !usedAttractions.has(item.name)
        && isVerifiedSeaViewAttraction(item)
        && openingStatusForSlot(item, date, "evening").status !== "conflict"
        && !conflictsWithScheduledPlace(item));
      if (seaView) {
        items.push({
          time: "傍晚",
          type: "海景观景点",
          title: seaView.name,
          note: `${seaView.address ?? "地址待确认"} · 按高德公开名称或类型可核验为海边、海湾、沙滩类地点 · 安排在傍晚避开日间主活动；实际视野与紫外线请出发前复核`,
        });
        usedAttractions.add(seaView.name);
        scheduledAttractionLocations.push(seaView);
        if (!seaView.openVerified) pendingAttractionHours.add(seaView.name);
        seaViewScheduled = true;
      }
    }
    if (hardConstraints.dailyIndoorBackup) {
      const backup = pickIndoorBackup(indoor, usedAttractions);
      if (backup) {
        items.push({
          time: "室内备选",
          type: "备选",
          title: backup.name,
          note: `${backup.address ?? "地址待确认"} · 天气或体力不适合当前景点时可替换 · 开放：${backup.open}${backup.openVerified ? "（高德公开信息）" : "（需官方确认）"}`,
        });
        usedAttractions.add(backup.name);
      }
    }
    const adaptation = lockedWeatherConflict ? {
      type: "locked_weather_conflict",
      condition: forecast.condition,
      message: `和风天气预测“${forecast.condition}”。${preservedAttractionItems.map((item) => item.title).join("、")} 是你锁定的景点，已保留但可能存在降雨风险；是否允许我更换为可核验的室内景点？`,
      requiresUserConfirmation: true,
      preserved: preservedAttractionItems.map((item) => item.title),
    } : rainy ? {
      type: "rain_switch",
      condition: forecast.condition,
      message: `和风天气预测“${forecast.condition}”，已自动切换为高德返回的室内候选；室内属性按 POI 类型识别，开放状态仍需确认。`,
    } : null;
    if (adaptation) {
      weatherAdaptations.push({
        day: index + 1,
        date,
        condition: forecast.condition,
        type: adaptation.type,
        message: adaptation.message,
        switched: adaptation.type === "rain_switch",
        requiresUserConfirmation: adaptation.type === "locked_weather_conflict",
        preserved: adaptation.preserved ?? [],
        attractions: selected.map((item) => item.name),
      });
      if (adaptation.type === "locked_weather_conflict") {
        warnings.push(`第 ${index + 1} 天预测${forecast.condition}，锁定景点已保留且未自动替换；需要你确认是否允许更换。`);
      }
    }
    days.push({
      day: index + 1,
      date,
      title: `${constraints.destination} · 第 ${index + 1} 天`,
      weatherHint: forecast ? `${forecast.condition} ${forecast.low}–${forecast.high}℃` : "天气暂不可用",
      weatherAdaptation: adaptation,
      items,
    });
  }
  if (pendingAttractionHours.size) warnings.push(`${pendingAttractionHours.size} 个已安排景点的营业时间未由高德返回，页面已标记需官方确认。`);
  if (pendingDiningHours.size) warnings.push(`${pendingDiningHours.size} 个已安排餐厅的营业时间未由高德返回，页面已标记需现场确认。`);
  return { days, weatherAdaptations, warnings };
}

function lockedWeatherConflictDates(previousPlan, constraints, weather, lock) {
  const mode = lock?.attractions?.mode;
  if (!previousPlan || !["all", "trimmed"].includes(mode)) return [];
  return weather
    .filter(isRainyForecast)
    .filter((forecast) => {
      const offset = Math.round((new Date(`${forecast.date}T12:00:00Z`) - new Date(`${constraints.startDate}T12:00:00Z`)) / 86400000);
      const attractionItems = attractionItemsFromDay(previousPlan.days?.[offset])
        .slice(0, mode === "trimmed" ? Math.max(1, Number(lock.attractions.maxPerDay ?? 1)) : 2);
      return attractionItems.some((item) => item.type === "景点");
    })
    .map((item) => item.date);
}

function shouldRefreshDiningCommute(target, previousPlan, adjustmentContext, affectedModules) {
  const previous = (previousPlan?.diningCommutes ?? []).find((item) => item.day === target.day && item.time === target.time);
  if (!previous) return true;
  if (previous.from !== target.anchor.name || previous.to !== target.restaurant.name) return true;
  if (!adjustmentContext) return true;
  if (adjustmentContext.diningSlots?.length) {
    return adjustmentContext.diningSlots.some((slot) => slot.day === target.day && slot.time === target.time);
  }
  if (adjustmentContext.fullRefresh
    || adjustmentContext.summary.attractionsChanged
    || adjustmentContext.summary.diningChanged
    || adjustmentContext.summary.datesChanged) {
    return true;
  }
  return affectedModules.includes("routes");
}

function insertDiningCommute(list, target, commute) {
  if (!list.some((item) => item.day === target.day && item.time === target.time)) list.push(commute);
}

function lockedMealSignature(item) {
  return item ? `${item.time}|${item.type}|${item.title}` : "none";
}

function lockedAttractionSignature(item) {
  return item ? `${item.time}|${item.title}` : "none";
}

function summarizePlanChanges(previousPlan, nextPlan) {
  if (!previousPlan) return { dates: [], attractions: [], dining: [], hotel: [] };
  const previousDays = previousPlan.days ?? [];
  const nextDays = nextPlan.days ?? [];
  const dates = nextDays
    .map((day, index) => previousDays[index]?.date === day.date ? null : {
      day: day.day,
      from: previousDays[index]?.date ?? null,
      to: day.date,
    })
    .filter(Boolean);
  const attractions = nextDays.flatMap((day, index) => {
    const before = attractionItemsFromDay(previousDays[index]).map(lockedAttractionSignature);
    const after = attractionItemsFromDay(day).map(lockedAttractionSignature);
    return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ day: day.day, from: before, to: after }];
  });
  const dining = nextDays.flatMap((day, index) => ["午餐", "晚餐"].flatMap((time) => {
    const before = lockedMealSignature(mealItemFromDay(previousDays[index], time));
    const after = lockedMealSignature(mealItemFromDay(day, time));
    return before === after ? [] : [{ day: day.day, time, from: before, to: after }];
  }));
  const hotelBefore = previousPlan.selectedHotel?.name ?? null;
  const hotelAfter = nextPlan.selectedHotel?.name ?? null;
  return {
    dates,
    attractions,
    dining,
    hotel: hotelBefore === hotelAfter ? [] : [{ from: hotelBefore, to: hotelAfter }],
  };
}

function auditLockedPlan({ lock, previousPlan, plan, nextStep }) {
  if (!previousPlan || !lock) return { checks: [], complete: true };
  const previousDays = previousPlan.days ?? [];
  const nextDays = plan.days ?? [];
  const checks = [];

  if (lock.dates) {
    const datesPreserved = previousDays.every((day, index) => day.date === nextDays[index]?.date);
    checks.push({ key: "dates", pass: datesPreserved, detail: datesPreserved ? "锁定日期未变化" : "有锁定日期被意外改动" });
  }
  if (lock.attractions?.mode === "all" || lock.attractions?.mode === "trimmed") {
    const attractionsPreserved = previousDays.every((day, index) => {
      const before = attractionItemsFromDay(day).map(lockedAttractionSignature);
      const expected = lock.attractions.mode === "trimmed"
        ? before.slice(0, Math.max(1, Number(lock.attractions.maxPerDay ?? 1)))
        : before;
      const after = attractionItemsFromDay(nextDays[index]).map(lockedAttractionSignature);
      return JSON.stringify(expected) === JSON.stringify(after);
    });
    checks.push({
      key: "attractions",
      pass: attractionsPreserved,
      detail: attractionsPreserved
        ? lock.attractions.mode === "trimmed" ? "每日首景点均沿用锁定项并已降为一天一个" : "锁定景点按原日程保留"
        : "锁定景点或日程位置发生变化",
    });
  }
  if (lock.dining?.mode === "all" || lock.dining?.mode === "slots_changed") {
    const slots = lock.dining.slots ?? [];
    const diningPreserved = previousDays.every((day, index) => ["午餐", "晚餐"].every((time) => {
      const changed = slots.some((slot) => slot.day === day.day && slot.time === time);
      if (changed) return true;
      return lockedMealSignature(mealItemFromDay(day, time)) === lockedMealSignature(mealItemFromDay(nextDays[index], time));
    }));
    checks.push({
      key: "dining",
      pass: diningPreserved,
      detail: diningPreserved
        ? slots.length ? "仅指定餐次变更，其余餐次保持锁定" : "锁定午晚餐均按原日程保留"
        : "有未指定的餐次被意外改动",
    });
  }
  if (lock.hotelPreferences) {
    const area = plan.constraints?.hotelArea;
    const hotelPreferencePreserved = !area || Boolean(plan.selectedHotel && hotelMatchesArea(plan.selectedHotel, area));
    checks.push({
      key: "hotelPreferences",
      pass: hotelPreferencePreserved,
      detail: !area
        ? "未提出新的酒店区域偏好，本轮未改变酒店选择口径"
        : hotelPreferencePreserved ? `酒店候选符合锁定区域“${area}”` : `酒店候选未满足锁定区域“${area}”`,
    });
  }
  const conflicts = plan.lockConflicts ?? [];
  const conflictsDisclosed = conflicts.every((item) => item.requiresUserConfirmation && /是否|放宽|替换锁定景点/.test(String(nextStep ?? "")));
  checks.push({
    key: "conflicts",
    pass: conflictsDisclosed,
    detail: !conflicts.length ? "没有锁定项冲突" : conflictsDisclosed ? "锁定项冲突已保留并请求用户确认" : "锁定项冲突未被明确披露",
  });
  return { checks, complete: checks.every((check) => check.pass) };
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function validateLivePlan(plan) {
  const rainyDates = plan.weather.filter(isRainyForecast).map((item) => item.date);
  const adaptedDates = new Set([
    ...(plan.weatherAdaptations ?? []),
    ...(plan.inheritedWeatherAdaptations ?? []),
  ].map((item) => item.date));
  const weatherAdaptationComplete = rainyDates.every((date) => adaptedDates.has(date));
  const hotelBasisVerified = plan.hotelRanking?.basis !== "首日景点驾车通勤时间"
    || Number.isFinite(plan.selectedHotel?.commuteMinutes);
  const scheduledAttractionNames = new Set(plan.days.flatMap((day) => day.items
    .filter((item) => item.type === "景点" || item.type === "室内景点")
    .map((item) => item.title)));
  const scheduledAttractions = (plan.attractions ?? []).filter((item) => scheduledAttractionNames.has(item.name));
  const openHoursVerified = scheduledAttractions.filter((item) => item.openVerified).length;
  const checks = [
    { label: "真实数据标识", pass: plan.dataMode === "live", detail: "天气与地点数据来自真实接口，不使用 Mock 回填" },
    { label: "逐日行程存在", pass: plan.days.length > 0, detail: `${plan.days.length} 天行程来自已查询 POI` },
    {
      label: "景点营业时间有状态",
      pass: scheduledAttractions.every((item) => Boolean(item.open)),
      detail: `已安排 ${scheduledAttractions.length} 个景点；其中 ${openHoursVerified} 个由高德返回营业时间，其余明确标为需确认`,
    },
    {
      label: "餐饮候选可追溯",
      pass: (plan.dining ?? []).length > 0,
      detail: `${plan.dining?.length ?? 0} 个餐厅候选来自高德公开 POI；未展示未经查询的人均消费`,
    },
    {
      label: "逐日餐饮通勤有状态",
      pass: Boolean(plan.diningCommuteStatus?.complete),
      detail: plan.diningCommuteStatus?.complete
        ? `${plan.diningCommuteStatus.verified} 段午餐、晚餐路线均取得高德真实结果`
        : `仅核验 ${plan.diningCommuteStatus?.verified ?? 0} / ${plan.diningCommuteStatus?.requested ?? 0} 段餐厅路线，未核验路段保留直线位置提示`,
    },
    {
      label: "天气适配可追溯",
      pass: weatherAdaptationComplete,
      detail: rainyDates.length
        ? `${rainyDates.length} 个雨天日期均有室内切换或不可用说明`
        : "天气未触发雨天切换规则",
    },
    {
      label: "酒店排序口径一致",
      pass: hotelBasisVerified,
      detail: plan.hotelRanking?.basis === "首日景点驾车通勤时间"
        ? `首选酒店来自 ${plan.hotelRanking.checked} 家真实通勤比较`
        : "通勤时间不可用，已明确降级为评分排序",
    },
    {
      label: "房型价格可追溯",
      pass: !plan.selectedHotel || Number.isFinite(plan.selectedHotel.selectedRoom?.totalPrice),
      detail: plan.selectedHotel?.selectedRoom
        ? `${plan.selectedHotel.name} · ${plan.selectedHotel.selectedRoom.name}：${plan.selectedHotel.selectedRoom.priceBasis ?? "供应商价格"}，仅作规划参考`
        : "没有选中具体房型，页面不展示未经查询的价格",
    },
    { label: "只读授权", pass: true, detail: "未注册预订、支付、退改或读取他人数据的工具" },
  ];
  return checks;
}

function auditOpeningSchedule(plan) {
  const attractionSources = new Map((plan.attractions ?? []).map((item) => [item.name, item]));
  const diningSources = new Map((plan.dining ?? []).map((item) => [item.name, item]));
  const checks = [];
  for (const day of plan.days ?? []) {
    for (const item of day.items ?? []) {
      if (["上午", "下午", "傍晚"].includes(item.time) && ["景点", "室内景点", "海景观景点"].includes(item.type)) {
        const source = attractionSources.get(item.title) ?? { name: item.title, open: item.note, openVerified: /高德公开信息/.test(item.note) };
        const slot = item.time === "上午" ? "morning" : item.time === "下午" ? "afternoon" : "evening";
        const status = openingStatusForSlot(source, day.date, slot);
        checks.push({ day: day.day, date: day.date, time: item.time, type: "attraction", title: item.title, ...status });
      }
      if (["午餐", "晚餐"].includes(item.time) && item.type === "真实餐厅") {
        const source = diningSources.get(item.title) ?? { name: item.title, open: item.note, openVerified: /营业：/.test(item.note) };
        const status = openingStatusForSlot(source, day.date, item.time === "午餐" ? "lunch" : "dinner");
        checks.push({ day: day.day, date: day.date, time: item.time, type: "dining", title: item.title, ...status });
      }
    }
  }
  const conflicts = checks.filter((item) => item.status === "conflict");
  const unknowns = checks.filter((item) => item.status === "unknown");
  return {
    checks,
    conflicts,
    unknowns,
    complete: conflicts.length === 0,
    evidenceComplete: conflicts.length === 0 && unknowns.length === 0,
  };
}

function auditUserHardConstraints(plan) {
  const requested = plan.constraints?.hardConstraints ?? {};
  const days = plan.days ?? [];
  const checks = [];
  const add = (key, label, pass, detail) => checks.push({ key, label, pass: Boolean(pass), detail });
  const mealRoutes = plan.diningCommutes ?? [];
  const verifiedMealRoutes = mealRoutes.filter((item) => item.verified && Number.isFinite(item.minutes));
  const unverifiedMealRouteCount = Math.max(0, mealRoutes.length - verifiedMealRoutes.length);
  const maxMinutes = (items) => items.length ? Math.max(...items.map((item) => item.minutes)) : 0;
  const itemHasVerifiedSeaView = (item) => {
    if (item?.type === "海景观景点") return true;
    if (item?.type !== "景点") return false;
    const source = plan.attractions?.find((attraction) => attraction.name === item.title);
    return source ? isVerifiedSeaViewAttraction(source) : false;
  };

  add(
    "travelers",
    "同行人数",
    Number(plan.constraints?.travelers) > 0,
    `方案、酒店搜索与房型查询使用 ${plan.constraints?.travelers ?? "待确认"} 人。`,
  );
  if (plan.hotels?.length) {
    const room = plan.selectedHotel?.selectedRoom;
    const travelers = Number(plan.constraints?.travelers || 0);
    const capacityPass = Boolean(room)
      && Number.isFinite(room.totalCapacity)
      && room.totalCapacity >= travelers;
    add(
      "roomCapacity",
      "房型容量",
      capacityPass,
      capacityPass
        ? `${plan.selectedHotel.name} 共 ${room.roomCount} 间房，供应商返回的总容量为 ${room.totalCapacity} 人，可容纳 ${travelers} 人。`
        : "没有找到同时满足可售状态、房量与同行人数的房型组合；不会用未返回容量的房型冒充可住方案。",
    );
  }
  if (requested.dailyIndoorBackup) {
    const complete = days.length > 0 && days.every((day) => day.items?.some((item) => item.time === "室内备选" && item.type === "备选"));
    add("dailyIndoorBackup", "每天一个室内备选", complete, complete ? `${days.length} 天均已提供来自真实 POI 的室内备选。` : "未做到每天一个可验证室内备选。");
  }
  if (requested.afternoonRest) {
    const complete = days.length > 0 && days.every((day) => day.items?.some((item) => item.time === "午后" && item.type === "休息"));
    add("afternoonRest", "午后休息", complete, complete ? `${days.length} 天均已留出午后休息时间。` : "并非每天都留出午后休息时间。");
  }
  if (requested.dailySeaView) {
    const pass = days.length > 0 && days.every((day) => day.items?.some(itemHasVerifiedSeaView));
    add("dailySeaView", "每天一个海景景点", pass, pass ? `${days.length} 天均包含可核验的海边、海湾或沙滩类地点。` : "有日期未落实可核验的海边、海湾或沙滩类地点；普通“海军博物馆”等名称不计入。");
  }
  if (requested.seaView) {
    const pass = days.some((day) => day.items?.some(itemHasVerifiedSeaView));
    add("seaView", "看海安排", pass, pass ? "至少安排了一个可核验的海边、海湾或沙滩类地点。" : "真实景点结果中没有可核验的海边、海湾或沙滩类地点，未用名称猜测补齐。");
  }
  if (requested.avoidEarlyStart) {
    const pass = days.length > 0 && days.every((day) => day.items?.some((item) => item.time === "出发" && item.title === "10:00 后开始"));
    add("avoidEarlyStart", "避免早起", pass, pass ? `${days.length} 天均明确安排 10:00 后出发。` : "有日期未明确避免早起，不能把‘上午’当成已满足。");
  }
  if (requested.shortCommute) {
    const pass = mealRoutes.length > 0 && unverifiedMealRouteCount === 0 && maxMinutes(verifiedMealRoutes) <= SHORT_COMMUTE_DEFAULT_MAX_MINUTES;
    add("shortCommute", "通勤短", pass, pass ? `所有餐饮路线均有真实结果，且单段不超过 ${SHORT_COMMUTE_DEFAULT_MAX_MINUTES} 分钟。` : `最长已验证餐饮通勤 ${maxMinutes(verifiedMealRoutes)} 分钟，阈值为 ${SHORT_COMMUTE_DEFAULT_MAX_MINUTES} 分钟；${unverifiedMealRouteCount} 段未核验。`);
  }
  if (requested.lessWalking) {
    const walking = [...(plan.routes ?? []), ...verifiedMealRoutes].filter((item) => item.mode === "步行");
    const unverified = [...(plan.routes ?? []), ...mealRoutes].filter((item) => item.mode === "步行" && !item.verified);
    const longestWalking = maxMinutes(walking);
    const pass = unverified.length === 0 && walking.every((item) => item.minutes <= WALKING_DEFAULT_MAX_MINUTES);
    add(
      "lessWalking",
      "少走路",
      pass,
      pass
        ? `已核验步行段均不超过 ${WALKING_DEFAULT_MAX_MINUTES} 分钟。`
        : `最长已核验步行段 ${longestWalking} 分钟，阈值为 ${WALKING_DEFAULT_MAX_MINUTES} 分钟；${unverified.length} 段步行未核验。`,
    );
  }
  if (requested.slowPace) {
    const pass = mealRoutes.length > 0 && unverifiedMealRouteCount === 0 && maxMinutes(verifiedMealRoutes) <= SLOW_PACE_DEFAULT_MAX_MINUTES;
    add("slowPace", "节奏适中", pass, pass ? `所有餐饮路线均有真实结果，且单段不超过 ${SLOW_PACE_DEFAULT_MAX_MINUTES} 分钟。` : `最长已验证餐饮通勤 ${maxMinutes(verifiedMealRoutes)} 分钟，阈值为 ${SLOW_PACE_DEFAULT_MAX_MINUTES} 分钟；${unverifiedMealRouteCount} 段未核验。`);
  }
  if (requested.easyWalking) {
    const walking = [...(plan.routes ?? []), ...verifiedMealRoutes].filter((item) => item.mode === "步行");
    const walkingPass = walking.every((item) => item.minutes <= EASY_WALKING_DEFAULT_MAX_MINUTES);
    const tooClose = days.some((day) => {
      const items = attractionItemsFromDay(day);
      return items.length > 1 && items.some((item, index) => items.slice(index + 1).some((other) => {
        const first = plan.attractions?.find((candidate) => candidate.name === item.title);
        const second = plan.attractions?.find((candidate) => candidate.name === other.title);
        return first?.location && second?.location && approximateDistanceMeters(first.location, second.location) < 300;
      }));
    });
    const pass = walkingPass && !tooClose;
    add("easyWalking", "适合轻松步行", pass, pass
      ? `已核验步行段均不超过 ${EASY_WALKING_DEFAULT_MAX_MINUTES} 分钟，且同日两个主要景点不是同一位置内的重复点位。`
      : tooClose
        ? "同日两个主要景点相距不足 300 米，不能证明是两项独立活动。"
        : `已核验路线中有单段步行超过 ${EASY_WALKING_DEFAULT_MAX_MINUTES} 分钟。`);
  }
  if (plan.constraints?.hotelArea) {
    const selectedHotel = plan.selectedHotel;
    const areaPass = Boolean(selectedHotel && hotelMatchesArea(selectedHotel, plan.constraints.hotelArea));
    add(
      "hotelArea",
      `酒店区域：${plan.constraints.hotelArea}`,
      areaPass,
      areaPass
        ? `${selectedHotel.name} 的名称、地址或行政区明确匹配“${plan.constraints.hotelArea}”。`
        : `真实酒店候选中没有名称、地址或行政区明确匹配“${plan.constraints.hotelArea}”且满足房型容量的方案。`,
    );
  }
  if (requested.avoidStepsAndSlopes) {
    add("avoidStepsAndSlopes", "少台阶和长坡", false, "高德当前返回值不提供台阶与坡度字段，无法核验平缓程度；页面不会把未核验项说成已满足。");
  }
  if (requested.avoidSunExposure) {
    const pass = days.length > 0 && days.every((day) => {
      const attractions = attractionItemsFromDay(day);
      return attractions.length > 0 && attractions.every((item) => item.type === "室内景点");
    });
    add("avoidSunExposure", "避免暴晒", pass, pass ? "所有已安排的主动景点均使用高德返回的室内 POI。" : "有日期没有取得可核验的室内景点，未把户外安排说成已满足避晒要求。");
  }
  if (requested.specificWeather) {
    const pass = plan.weatherCoverage?.complete === true && !plan.weatherUnavailable;
    add("specificWeather", "具体天气预报", pass, pass ? "所有行程日期均取得真实天气预报。" : `仅取得 ${plan.weatherCoverage?.returnedDays ?? 0} / ${plan.weatherCoverage?.requestedDays ?? days.length} 天具体预报。`);
  }

  const gaps = checks.filter((check) => !check.pass);
  return { checks, gaps, complete: gaps.length === 0 };
}

function relaxationOptionsFor({ gaps, lockConflicts, openingConflicts }) {
  const options = [];
  const gapKeys = new Set(gaps.map((item) => item.key));
  if (gapKeys.has("roomCapacity")) options.push("允许增加房间数或换一家能明确容纳全部同行人的酒店。");
  if (gapKeys.has("hotelArea")) options.push("放宽酒店区域，或接受通勤时间更长的可核验酒店。");
  if (gapKeys.has("shortCommute") || gapKeys.has("slowPace")) options.push("放宽通勤或节奏上限，或减少每日主要活动。");
  if (gapKeys.has("lessWalking") || gapKeys.has("easyWalking")) options.push("接受较长的已核验步行段，或更换移动能力与住宿区域。");
  if (gapKeys.has("dailySeaView") || gapKeys.has("seaView")) options.push("放宽海景要求，或调整目的地、日期和景点范围。");
  if (gapKeys.has("avoidStepsAndSlopes")) options.push("接受以官方无障碍信息为准，或更换可核验平缓移动的地点。");
  if (gapKeys.has("specificWeather")) options.push("放宽具体天气要求，或改到真实预报覆盖范围内的日期。");
  if (openingConflicts.length) options.push("允许替换与营业时间冲突的景点或餐厅。");
  if (lockConflicts.length) options.push("允许在雨天替换锁定景点，或继续保留并要求人工确认风险。");
  return [...new Set(options.length ? options : ["补充或放宽当前无法满足的条件后重新规划。"])];
}

async function executeWithRetry({ trace, toolStats, toolId, args, execute, callLimit = MAX_TOOL_CALLS, retryDelayMs = 0 }) {
  const effectiveCallLimit = toolStats.limit ?? callLimit;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_TOOL; attempt += 1) {
    if (toolStats.count >= effectiveCallLimit) {
      trace.add("tool_error", "工具调用上限", `已达到单任务调用上限，未继续执行 ${toolId}。`, {
        toolId,
        status: "error",
        code: "TOOL_CALL_LIMIT_EXCEEDED",
      });
      return null;
    }
    toolStats.count += 1;
    trace.add("tool_call", `${toolId} · 第 ${attempt} 次`, JSON.stringify(args), { toolId, permission: "只读", attempt });
    try {
      const result = await execute();
      trace.add("observation", "真实接口返回", result.summary, { toolId, source: result.source, status: "success", dataMode: "live" });
      return result;
    } catch (error) {
      trace.add("tool_error", "真实接口失败", error.message, { toolId, status: "error", code: error.code ?? "LIVE_TOOL_ERROR" });
      if (attempt < MAX_ATTEMPTS_PER_TOOL && error.retryable) {
        toolStats.retries += 1;
        trace.add("retry", "有限重试", "同一查询只追加一次真实请求。", { toolId, status: "retry" });
        if (retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        continue;
      }
      return null;
    }
  }
  return null;
}

function resolveAffectedModules(decision, previousPlan, adjustmentContext = null) {
  if (previousPlan && adjustmentContext?.affectedModules?.length) return adjustmentContext.affectedModules;
  if (decision.affectedModules.length) return decision.affectedModules;
  return previousPlan ? ["itinerary"] : ["weather", "itinerary", "routes", "hotel"];
}

function ensureRequiredToolPlan(toolPlan, constraints, previousPlan, affectedModules, trace, adjustmentContext = null) {
  const required = previousPlan ? [] : ["weather.forecast", "poi.searchAttractions", "poi.searchDining", "hotel.search"];
  if (previousPlan) {
    if (affectedModules.includes("weather")) required.push("weather.forecast");
    if (affectedModules.includes("hotel")) required.push("hotel.search");
    if (affectedModules.includes("itinerary") || affectedModules.includes("routes")) {
      if (!adjustmentContext) {
        required.push("poi.searchAttractions", "poi.searchDining");
      } else {
        if (adjustmentContext.needs?.attractions) required.push("poi.searchAttractions");
        if (adjustmentContext.needs?.dining) required.push("poi.searchDining");
      }
    }
  }
  const allowed = new Set(required);
  const defaults = {
    "weather.forecast": { destination: constraints.destination, startDate: constraints.startDate, days: constraints.days },
    "poi.searchAttractions": { destination: constraints.destination, preferences: constraints.preferences },
    "poi.searchDining": { destination: constraints.destination, preferences: constraints.preferences },
    "hotel.search": {
      destination: constraints.destination,
      startDate: constraints.startDate,
      days: constraints.days,
      travelers: constraints.travelers,
      ...(constraints.hotelArea ? { query: constraints.hotelArea } : {}),
    },
  };
  const seen = new Set();
  const normalized = toolPlan.filter((item) => {
    if (!allowed.has(item.tool)) {
      trace.add("contract_repair", "移除无关只读工具", `局部调整无需调用 ${item.tool}，编排器已按锁定范围裁剪。`, {
        status: "warning",
        toolId: item.tool,
      });
      return false;
    }
    if (seen.has(item.tool)) return false;
    seen.add(item.tool);
    return true;
  });
  for (const tool of required) {
    if (!seen.has(tool)) {
      normalized.push({ tool, arguments: defaults[tool] });
      trace.add("contract_repair", "补齐必需只读工具", `模型未选择 ${tool}，编排器按任务合同补充。`, { status: "warning", toolId: tool });
    }
  }
  return normalized.map((item) => ({
    tool: item.tool,
    arguments: {
      ...item.arguments,
      destination: constraints.destination,
      ...(item.tool === "weather.forecast" ? { startDate: constraints.startDate, days: constraints.days } : {}),
      ...(item.tool === "hotel.search" ? {
        startDate: constraints.startDate,
        days: constraints.days,
        travelers: constraints.travelers,
        ...(constraints.hotelArea ? { query: constraints.hotelArea } : {}),
      } : {}),
    },
  }));
}

function buildVersionMetadata({ config = null, modelCalls = [] }) {
  let provider = null;
  if (config?.model?.baseUrl) {
    try {
      provider = new URL(config.model.baseUrl).host;
    } catch {
      provider = null;
    }
  }
  return {
    schemaVersion: 1,
    prompt: {
      version: PROMPT_METADATA.version,
      sha256: PROMPT_METADATA.sha256,
    },
    model: {
      provider,
      requested: config?.model?.name || null,
      reported: [...new Set(modelCalls.map((item) => item.responseModel).filter(Boolean))],
      responseModels: modelCalls.map((item) => ({
        requested: item.requestedModel ?? config?.model?.name ?? null,
        reported: item.responseModel ?? null,
        requestId: item.providerRequestId ?? null,
      })),
    },
    tools: {
      version: TOOL_CONTRACT_METADATA.version,
      sha256: TOOL_CONTRACT_METADATA.sha256,
      providers: {
        weather: "QWeather",
        map: "AMap Web Service",
        hotel: "RollingGo MCP",
        hotelProtocol: config?.rollingGo?.protocolVersion ?? null,
      },
    },
  };
}

function buildResultBase({ state, taskStatus, message, nextStep, constraints, plan, trace, startedAt, toolStats, modelRounds, usage, modelRequestIds = [], config = null, modelCalls = [] }) {
  const versions = buildVersionMetadata({ config, modelCalls });
  const callCosts = modelCalls.map((call) => calculateModelCost(call.usage ?? {}, config?.model?.pricing ?? {}, {
    modelRounds: 1,
    at: new Date(call.startedAt),
  }));
  const cost = modelRounds === 0
    ? calculateModelCost(usage, config?.model?.pricing ?? {}, { modelRounds: 0 })
    : aggregateModelCosts(callCosts, { modelRounds, usage, pricing: config?.model?.pricing ?? {} });
  return {
    runId: `live-${randomUUID()}`,
    state,
    taskStatus,
    message,
    nextStep,
    constraints,
    plan: publicPlan(plan),
    events: trace.events,
    dataMode: "live",
    metrics: {
      toolCalls: toolStats.count,
      retries: toolStats.retries,
      modelRounds,
      elapsedMs: Date.now() - startedAt,
      maxToolCalls: toolStats.limit ?? MAX_TOOL_CALLS,
      usage,
      estimatedCost: cost.amount,
      costStatus: cost.status,
    },
    provenance: {
      dataMode: "live",
      modelRequestIds: modelRequestIds.filter(Boolean),
      toolSources: [...new Set(trace.events.map((event) => event.source).filter(Boolean))],
      versions,
      modelCost: cost,
    },
  };
}

function publicRoom(room) {
  if (!room) return null;
  const {
    roomTypeId: _roomTypeId,
    ratePlanId: _ratePlanId,
    inventoryCount,
    isOnRequest: _isOnRequest,
    ...safe
  } = room;
  return {
    ...safe,
    inventoryLabel: Number.isFinite(inventoryCount)
      ? inventoryCount > 0 ? `剩余 ${inventoryCount} 间` : "暂无库存"
      : null,
  };
}

function publicHotel(hotel) {
  if (!hotel) return null;
  const {
    id: _id,
    providerHotelId: _providerHotelId,
    ...safe
  } = hotel;
  return {
    ...safe,
    rooms: (hotel.rooms ?? []).map(publicRoom),
    selectedRoom: publicRoom(hotel.selectedRoom),
  };
}

function publicPlan(plan) {
  if (!plan) return null;
  return {
    ...plan,
    hotels: (plan.hotels ?? []).map(publicHotel),
    selectedHotel: publicHotel(plan.selectedHotel),
  };
}

export async function runLiveAgent(input = {}, dependencies = {}) {
  const startedAt = Date.now();
  const trace = makeTrace();
  const toolStats = { count: 0, retries: 0, limit: MAX_TOOL_CALLS };
  const message = String(input.message ?? "").trim();
  const previousPlan = input.previousPlan ?? null;
  const previousConstraints = input.previousConstraints ?? null;
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    inputCacheHitTokens: 0,
    inputCacheMissTokens: 0,
    cacheBreakdownComplete: true,
  };
  const modelRequestIds = [];
  const modelCalls = [];
  let modelRounds = 0;
  let config = null;

  trace.add("goal", previousPlan ? "接收局部调整" : "接收真实旅行规划", message, { status: "running", dataMode: "live" });
  const guard = preflightGuard(message, { previousConstraints });
  if (guard) {
    trace.add("guard", guard.boundary === "multi_city" ? "多城市规划前拦截" : "权限边界拦截", guard.message, {
      status: "blocked",
      boundary: guard.boundary,
      refusedTool: guard.refusedTool ?? null,
      destinations: guard.destinations ?? null,
    });
    trace.add("next_step", "唯一下一步", guard.nextStep, { status: "waiting" });
    return buildResultBase({ state: "blocked", taskStatus: "阻塞", message: guard.message, nextStep: guard.nextStep, constraints: null, plan: null, trace, startedAt, toolStats, modelRounds, usage, modelRequestIds, config, modelCalls });
  }

  config = input.config ?? dependencies.config ?? getRuntimeConfig();
  const modelClient = dependencies.modelClient ?? createModelClient(config.model);
  const liveTools = dependencies.liveTools ?? createLiveTools(config);
  const routeSpacingMs = Math.max(0, Number(config.amap?.routeSpacingMs || 0));
  const routeRetryDelayMs = Math.max(0, Number(config.amap?.routeRetryDelayMs || 0));
  let lastRouteStartedAt = 0;
  const executeRoute = async (args) => {
    const waitMs = Math.max(0, routeSpacingMs - (Date.now() - lastRouteStartedAt));
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastRouteStartedAt = Date.now();
    return executeWithRetry({
      trace,
      toolStats,
      toolId: "route.plan",
      args,
      execute: () => liveTools.routePlan(args),
      retryDelayMs: routeRetryDelayMs,
    });
  };

  const accumulateModelMetadata = (metadata) => {
    usage.inputTokens += Number.isFinite(metadata.usage?.inputTokens) ? metadata.usage.inputTokens : 0;
    usage.outputTokens += Number.isFinite(metadata.usage?.outputTokens) ? metadata.usage.outputTokens : 0;
    if (metadata.usage?.cacheBreakdownComplete === true
      && Number.isFinite(metadata.usage?.inputCacheHitTokens)
      && Number.isFinite(metadata.usage?.inputCacheMissTokens)) {
      usage.inputCacheHitTokens += metadata.usage.inputCacheHitTokens;
      usage.inputCacheMissTokens += metadata.usage.inputCacheMissTokens;
    } else {
      usage.cacheBreakdownComplete = false;
    }
    if (metadata.providerRequestId) modelRequestIds.push(metadata.providerRequestId);
    modelCalls.push({
      requestedModel: metadata.requestedModel ?? config.model.name,
      responseModel: metadata.responseModel ?? null,
      providerRequestId: metadata.providerRequestId ?? null,
      startedAt: metadata.startedAt,
      usage: metadata.usage ?? { inputTokens: null, outputTokens: null },
      status: metadata.status ?? "success",
      errorCode: metadata.errorCode ?? null,
    });
  };

  let modelResult = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    modelRounds += 1;
    const modelCallStartedAt = new Date().toISOString();
    try {
      modelResult = await modelClient.planTravel({ message, previousConstraints, previousPlan });
      accumulateModelMetadata({ ...modelResult, startedAt: modelCallStartedAt, status: "success" });
      break;
    } catch (error) {
      const failedMetadata = {
        usage: error.usage ?? { inputTokens: null, outputTokens: null },
        providerRequestId: error.providerRequestId ?? null,
        requestedModel: error.requestedModel ?? config.model.name,
        responseModel: error.responseModel ?? null,
        prompt: error.prompt ?? PROMPT_METADATA,
        startedAt: modelCallStartedAt,
        status: "failed",
        errorCode: error.code ?? "MODEL_ERROR",
      };
      accumulateModelMetadata(failedMetadata);
      if (error.code === "MODEL_INVALID_JSON" && attempt === 1) {
        trace.add("model_retry", "模型输出格式异常，发起一次真实重试", "首次响应不是合法 JSON；已保留首次请求用量，并将重新请求模型。", {
          status: "warning",
          attempt,
          errorCode: error.code,
          modelRequestId: failedMetadata.providerRequestId,
        });
        continue;
      }
      trace.add("model_error", "模型调用失败", error.message || "模型调用异常", {
        status: "error",
        attempt,
        errorCode: failedMetadata.errorCode,
        modelRequestId: failedMetadata.providerRequestId,
      });
      error.executionSnapshot = {
        usage: { ...usage },
        modelRequestIds: [...modelRequestIds],
        modelCalls: [...modelCalls],
        trace: [...trace.events],
        prompt: failedMetadata.prompt,
      };
      throw error;
    }
  }
  const decision = modelResult.decision;
  trace.add("model_decision", "模型完成需求解析与工具计划", `状态：${decision.status}；工具：${decision.toolPlan.map((item) => item.tool).join("、") || "无"}`, {
    status: decision.status === "blocked" ? "blocked" : "success",
    modelRequestId: modelResult.providerRequestId,
    attempt: modelRounds,
  });

  if (decision.status === "blocked") {
    const text = decision.message || "该请求超出当前只读旅行规划能力。";
    const nextStep = decision.nextStep || "请修改为单目的地、只读旅行规划请求。";
    trace.add("guard", "模型触发权限边界", text, { status: "blocked" });
    trace.add("next_step", "唯一下一步", nextStep, { status: "waiting" });
    return buildResultBase({ state: "blocked", taskStatus: "阻塞", message: text, nextStep, constraints: decision.constraints, plan: null, trace, startedAt, toolStats, modelRounds, usage, modelRequestIds, config, modelCalls });
  }

  const adjustmentContext = previousPlan
    ? deriveAdjustmentContext(message, previousPlan, previousConstraints, decision)
    : null;
  if (adjustmentContext) {
    decision.constraints = adjustmentContext.constraints;
    decision.affectedModules = adjustmentContext.affectedModules;
  } else {
    decision.constraints = {
      ...decision.constraints,
      maxAttractionsPerDay: deriveDailyAttractionLimit(message) ?? decision.constraints.maxAttractionsPerDay ?? null,
      hardConstraints: deriveHardConstraints(message, decision.constraints.hardConstraints ?? {}),
    };
  }

  const missing = missingConstraints(decision.constraints);
  if (decision.status === "clarification" || missing.length) {
    const text = decision.message || `为了生成可执行方案，还需要确认：${missing.slice(0, 3).join("、")}。`;
    const nextStep = decision.nextStep || `请先补充${missing.slice(0, 3).join("、")}。`;
    trace.add("guard", "暂停正式规划", text, { status: "waiting", missing });
    trace.add("next_step", "唯一下一步", nextStep, { status: "waiting" });
    return buildResultBase({ state: "clarification", taskStatus: "阻塞", message: text, nextStep, constraints: decision.constraints, plan: null, trace, startedAt, toolStats, modelRounds, usage, modelRequestIds, config, modelCalls });
  }

  toolStats.limit = resolveToolCallBudget(decision.constraints.days);

  const affectedModules = resolveAffectedModules(decision, previousPlan, adjustmentContext);
  trace.add("plan", previousPlan ? "确定局部更新范围" : "执行真实工具计划", previousPlan
    ? `本轮更新：${affectedModules.join("、")}`
    : "模型选择工具；代码执行白名单校验、真实查询与规则校验", { status: "running", affectedModules });
  if (adjustmentContext) {
    trace.add("lock", "确定锁定内容", JSON.stringify(adjustmentContext.preservation), {
      status: "success",
      lock: adjustmentContext.preservation,
    });
  }
  const toolPlan = ensureRequiredToolPlan(decision.toolPlan, decision.constraints, previousPlan, affectedModules, trace, adjustmentContext);
  const executionPlan = [...toolPlan].sort((a, b) => {
    const order = { "poi.searchAttractions": 0, "poi.searchDining": 1, "weather.forecast": 2, "hotel.search": 3 };
    return (order[a.tool] ?? 9) - (order[b.tool] ?? 9);
  });
  const outputs = { weather: null, attractions: null, dining: null, hotels: null, routes: null, diningCommutes: null };

  for (const item of executionPlan) {
    let result = null;
    if (item.tool === "weather.forecast") {
      const location = outputs.attractions?.[0]?.location ?? previousPlan?.attractions?.[0]?.location;
      const weatherArgs = location ? { ...item.arguments, location } : item.arguments;
      result = await executeWithRetry({ trace, toolStats, toolId: item.tool, args: weatherArgs, execute: () => liveTools.weatherForecast(weatherArgs) });
    }
    if (item.tool === "poi.searchAttractions") result = await executeWithRetry({ trace, toolStats, toolId: item.tool, args: item.arguments, execute: () => liveTools.searchAttractions(item.arguments) });
    if (item.tool === "poi.searchDining") {
      result = await executeWithRetry({ trace, toolStats, toolId: item.tool, args: item.arguments, execute: () => liveTools.searchDining(item.arguments) });
      const requestedPreferences = Array.isArray(item.arguments?.preferences) ? item.arguments.preferences : [];
      if (!(result?.data ?? []).length && requestedPreferences.some((preference) => /临安|富阳|区县|方向/.test(preference))) {
        const fallbackArgs = {
          ...item.arguments,
          preferences: ["本地菜"],
        };
        trace.add("fallback", "扩大真实餐饮搜索", "区域菜查询无结果，使用同一高德接口扩大到本地菜；不会用模型记忆补写餐厅。", {
          status: "running",
          toolId: item.tool,
          fromPreferences: requestedPreferences,
          toPreferences: fallbackArgs.preferences,
        });
        result = await executeWithRetry({ trace, toolStats, toolId: item.tool, args: fallbackArgs, execute: () => liveTools.searchDining(fallbackArgs) });
        if (result) result.summary = `区域菜无结果；扩大真实查询后，${result.summary}`;
      }
    }
    if (item.tool === "hotel.search") result = await executeWithRetry({ trace, toolStats, toolId: item.tool, args: item.arguments, execute: () => liveTools.searchHotels(item.arguments) });
    if (item.tool === "weather.forecast") outputs.weather = result?.data ?? null;
    if (item.tool === "poi.searchAttractions") outputs.attractions = result?.data ?? null;
    if (item.tool === "poi.searchDining") outputs.dining = result?.data ?? null;
    if (item.tool === "hotel.search") outputs.hotels = result?.data ?? null;
  }
  const freshAttractions = uniqueAttractions(outputs.attractions ?? []);
  let attractions = uniqueAttractions([
    ...freshAttractions,
    ...(previousPlan?.attractions ?? []),
  ]);
  const freshDining = uniqueDining(outputs.dining ?? []);
  const dining = uniqueDining([
    ...freshDining,
    ...(previousPlan?.dining ?? []),
  ]);
  const refreshWarnings = [];
  const weather = outputs.weather ?? (affectedModules.includes("weather") ? [] : previousPlan?.weather ?? []);
  const weatherByDate = new Map(weather.map((item) => [item.date, item]));
  const rainyDays = weather
    .filter(isRainyForecast)
    .map((item) => ({ date: item.date, condition: item.condition }));
  const itineraryRefreshRequested = !previousPlan
    || affectedModules.includes("itinerary")
    || affectedModules.includes("routes")
    || affectedModules.includes("weather");
  const routeRefreshRequested = !previousPlan
    || affectedModules.includes("routes")
    || affectedModules.includes("itinerary")
    || affectedModules.includes("weather");
  const diningSelections = new Map();
  const diningFallbacks = new Set();
  const precomputedDiningRoutes = new Map();
  if (previousPlan && routeRefreshRequested && adjustmentContext?.diningSlots?.length) {
    for (const slot of adjustmentContext.diningSlots) {
      const key = `${slot.day}-${slot.time}`;
      const previousDay = previousPlan.days?.[slot.day - 1];
      const previousMeal = mealItemFromDay(previousDay, slot.time);
      const previousCommute = (previousPlan.diningCommutes ?? [])
        .find((item) => item.day === slot.day && item.time === slot.time && item.verified);
      const anchor = diningAnchorForSlot(previousDay, slot.time, attractions);
      const candidates = freshDining
        .filter((item) => item.name !== previousMeal?.title && item.location && anchor?.location)
        .map((restaurant) => ({ restaurant, meters: approximateDistanceMeters(anchor.location, restaurant.location) }))
        .sort((a, b) => a.meters - b.meters)
        .slice(0, MAX_DINING_REPLACEMENT_ROUTE_CHECKS);

      if (!anchor || !previousMeal || !previousCommute || !candidates.length) {
        diningFallbacks.add(key);
        refreshWarnings.push(`第 ${slot.day} 天${slot.time}无法证明新餐厅更近，已保留原安排。`);
        continue;
      }

      let best = null;
      for (const candidate of candidates) {
        if (toolStats.count >= toolStats.limit - 2) break;
        const routeArgs = {
          origin: anchor.location,
          destination: candidate.restaurant.location,
          originName: anchor.name,
          destinationName: candidate.restaurant.name,
          mode: preferredRouteMode(anchor.location, candidate.restaurant.location, {
            lessWalking: Boolean(decision.constraints.hardConstraints?.lessWalking),
          }),
        };
        const routeResult = await executeRoute(routeArgs);
        const leg = routeResult?.data?.[0];
        if (!leg?.verified || !Number.isFinite(leg.minutes)) continue;
        const route = {
          day: slot.day,
          time: slot.time,
          from: anchor.name,
          to: candidate.restaurant.name,
          mode: leg.mode ?? (routeArgs.mode === "walking" ? "步行" : "驾车"),
          minutes: leg.minutes,
          distanceMeters: Number.isFinite(leg.distanceMeters) ? leg.distanceMeters : null,
          verified: true,
        };
        const isCloser = route.minutes < previousCommute.minutes
          || (route.minutes === previousCommute.minutes
            && Number.isFinite(route.distanceMeters)
            && Number.isFinite(previousCommute.distanceMeters)
            && route.distanceMeters < previousCommute.distanceMeters);
        if (!isCloser) continue;
        if (!best
          || route.minutes < best.route.minutes
          || (route.minutes === best.route.minutes && route.distanceMeters < best.route.distanceMeters)) {
          best = { restaurant: candidate.restaurant, route };
        }
      }

      if (best) {
        diningSelections.set(key, best.restaurant.name);
        precomputedDiningRoutes.set(key, best.route);
        trace.add(
          "dining_replacement",
          "已核验更近餐厅",
          `第 ${slot.day} 天${slot.time}由“${previousMeal.title}”改为“${best.restaurant.name}”：${previousCommute.minutes} 分钟 → ${best.route.minutes} 分钟，路线来自高德真实结果。`,
          { status: "success", day: slot.day, time: slot.time, from: previousMeal.title, to: best.restaurant.name },
        );
      } else {
        diningFallbacks.add(key);
        refreshWarnings.push(`第 ${slot.day} 天${slot.time}候选在真实路线核验中均不短于原餐厅，已保留原安排，不把更远餐厅说成更近。`);
      }
    }
  }
  const buildOptions = {
    previousDays: previousPlan?.days ?? [],
    lock: adjustmentContext?.preservation ?? previousPlan?.lock ?? null,
    changedDining: freshDining,
    diningSelections,
    diningFallbacks,
    maxAttractionsPerDay: adjustmentContext?.summary?.maxAttractionsPerDay
      ?? previousPlan?.constraints?.maxAttractionsPerDay
      ?? null,
  };
  const lockedConflictDates = lockedWeatherConflictDates(
    previousPlan,
    decision.constraints,
    weather,
    adjustmentContext?.preservation
  );

  const existingIndoorCount = attractions.filter((item) => item.indoor).length;
  const datesNeedingIndoorSearch = rainyDays.filter((item) => !lockedConflictDates.includes(item.date));
  const requiresDailyIndoorBackup = Boolean(decision.constraints.hardConstraints?.dailyIndoorBackup);
  const requiresIndoorAttractions = Boolean(decision.constraints.hardConstraints?.avoidSunExposure);
  const requiresIndoorSearch = datesNeedingIndoorSearch.length > 0 || requiresDailyIndoorBackup || requiresIndoorAttractions;
  const requiredIndoorCount = requiresDailyIndoorBackup || requiresIndoorAttractions
    ? Math.max(datesNeedingIndoorSearch.length * 2, decision.constraints.days)
    : datesNeedingIndoorSearch.length * 2;
  if (requiresIndoorSearch && itineraryRefreshRequested && existingIndoorCount < requiredIndoorCount) {
    const attractionToolArgs = toolPlan.find((item) => item.tool === "poi.searchAttractions")?.arguments
      ?? { destination: decision.constraints.destination };
    const indoorArgs = { ...attractionToolArgs, destination: decision.constraints.destination, indoorOnly: true };
    const indoorResult = await executeWithRetry({
      trace,
      toolStats,
      toolId: "poi.searchAttractions",
      args: indoorArgs,
      execute: () => liveTools.searchAttractions(indoorArgs),
    });
    const indoorAttractions = uniqueAttractions(indoorResult?.data ?? []).filter((item) => item.indoor);
    if (indoorAttractions.length) attractions = uniqueAttractions([...attractions, ...indoorAttractions]);
  }

  const scheduledDaysForRouting = buildDays(
    decision.constraints,
    attractions,
    dining,
    previousPlan?.routes ?? [],
    weather,
    [],
    buildOptions
  ).days;
  const firstDayAttractions = scheduledAttractionsFromDay(scheduledDaysForRouting[0], attractions);
  const diningRouteTargets = diningRouteTargetsFromDays(scheduledDaysForRouting, attractions, dining);
  const diningCommutes = [];
  if (routeRefreshRequested) {
    const attractionScheduleChanged = !previousPlan || Boolean(adjustmentContext?.summary?.attractionsChanged);
    if (attractionScheduleChanged) {
      if (firstDayAttractions.length >= 2 && firstDayAttractions[0].location && firstDayAttractions[1].location) {
        const routeArgs = {
          origin: firstDayAttractions[0].location,
          destination: firstDayAttractions[1].location,
          originName: firstDayAttractions[0].name,
          destinationName: firstDayAttractions[1].name,
          mode: "driving",
        };
        const routeResult = await executeRoute(routeArgs);
        outputs.routes = routeResult?.data ?? null;
      } else {
        outputs.routes = [];
      }
    } else {
      outputs.routes = previousPlan?.routes ?? null;
    }

    const diningRouteCallLimit = toolStats.limit - 1;
    for (const target of diningRouteTargets) {
      const { day, time, anchor, restaurant } = target;
      const precomputed = precomputedDiningRoutes.get(`${day}-${time}`);
      if (precomputed?.to === restaurant.name) {
        insertDiningCommute(diningCommutes, target, { ...precomputed });
        continue;
      }
      const previousCommute = (previousPlan?.diningCommutes ?? []).find((item) => item.day === day && item.time === time);
      if (!shouldRefreshDiningCommute(target, previousPlan, adjustmentContext, affectedModules) && previousCommute) {
        insertDiningCommute(diningCommutes, target, { ...previousCommute });
        continue;
      }
      if (toolStats.count >= diningRouteCallLimit) {
        insertDiningCommute(diningCommutes, target, {
          day,
          time,
          from: anchor.name,
          to: restaurant.name,
          mode: preferredRouteMode(anchor.location, restaurant.location, {
            lessWalking: Boolean(decision.constraints.hardConstraints?.lessWalking),
          }) === "walking" ? "步行" : "驾车",
          minutes: null,
          distanceMeters: null,
          verified: false,
          skippedReason: "TOOL_BUDGET",
        });
        continue;
      }
      const routeArgs = {
        origin: anchor.location,
        destination: restaurant.location,
        originName: anchor.name,
        destinationName: restaurant.name,
        mode: preferredRouteMode(anchor.location, restaurant.location, {
          lessWalking: Boolean(decision.constraints.hardConstraints?.lessWalking),
        }),
      };
      const routeResult = await executeRoute(routeArgs);
      const leg = routeResult?.data?.[0];
      insertDiningCommute(diningCommutes, target, {
        day,
        time,
        from: anchor.name,
        to: restaurant.name,
        mode: leg?.mode ?? (routeArgs.mode === "walking" ? "步行" : "驾车"),
        minutes: Number.isFinite(leg?.minutes) ? leg.minutes : null,
        distanceMeters: Number.isFinite(leg?.distanceMeters) ? leg.distanceMeters : null,
        verified: Boolean(leg?.verified && Number.isFinite(leg?.minutes)),
      });
    }
    outputs.diningCommutes = diningCommutes;
    const verifiedDiningRoutes = diningCommutes.filter((item) => item.verified).length;
    trace.add(
      "dining_route",
      verifiedDiningRoutes === diningCommutes.length && diningCommutes.length >= 2 ? "逐日餐饮通勤已核验" : "餐饮通勤部分不可用",
      diningCommutes.length
        ? `所有可安排日的午餐、晚餐目标共 ${diningCommutes.length} 段；其中 ${verifiedDiningRoutes} 段为高德真实路线，未重查的锁定餐段沿用上一版已核验路线，其余缺口中标记待核验。`
        : "没有可分配的真实餐厅，未发起餐饮路线查询。",
      { status: verifiedDiningRoutes === diningCommutes.length && diningCommutes.length >= 2 ? "success" : "warning", checked: verifiedDiningRoutes, total: diningCommutes.length }
    );
  } else {
    outputs.routes = previousPlan?.routes ?? null;
    outputs.diningCommutes = previousPlan?.diningCommutes ?? null;
  }
  if (previousPlan && adjustmentContext?.needs?.attractions && freshAttractions.length === 0) {
    refreshWarnings.push("景点刷新失败，当前逐日行程保留上一版已查询结果。");
  }
  if (previousPlan && adjustmentContext?.needs?.dining && freshDining.length === 0) {
    refreshWarnings.push("餐饮刷新失败，当前逐日行程保留上一版已查询结果。");
  }
  if (routeRefreshRequested && itineraryRefreshRequested && !outputs.routes?.length && firstDayAttractions.length >= 2) {
    refreshWarnings.push("路线刷新未取得可用结果，当前页面不声称交通时间已经验证。");
  }
  const verifiedDiningCommuteCount = (outputs.diningCommutes ?? []).filter((item) => item.verified).length;
  if (routeRefreshRequested && dining.length && verifiedDiningCommuteCount < diningRouteTargets.length) {
    refreshWarnings.push(`逐日餐饮通勤仅核验 ${verifiedDiningCommuteCount} / ${diningRouteTargets.length} 段，其余餐段仍显示直线位置提示。`);
  }

  const hotelAnchor = firstDayAttractions[0] ?? null;
  const hotelRefreshRequested = !previousPlan || affectedModules.includes("hotel");
  const requestedHotelRooms = Math.max(1, Math.ceil(Number(decision.constraints.travelers || 1) / 2));
  let hotels = hotelRefreshRequested
    ? (outputs.hotels ?? []).map((hotel) => ({ ...hotel }))
    : (previousPlan?.hotels ?? []).map((hotel) => ({ ...hotel }));
  let selectedHotel = null;
  let hotelRanking = previousPlan?.hotelRanking ?? null;
  if (hotelRefreshRequested) {
    const hotelArea = decision.constraints.hotelArea;
    const reserveForHotelRetry = decision.constraints.days <= 3 ? 1 : 0;
    const hotelCallBudget = Math.max(0, toolStats.limit - toolStats.count - reserveForHotelRetry);
    const desiredCommuteChecks = decision.constraints.days <= 3 ? 2 : decision.constraints.days === 4 ? 1 : 0;
    const requiredDetailCalls = hotels.length ? 1 : 0;
    const commuteCheckLimit = Math.min(
      MAX_HOTEL_COMMUTE_CANDIDATES,
      desiredCommuteChecks,
      Math.max(0, hotelCallBudget - requiredDetailCalls)
    );
    const hotelRouteCandidates = hotels.map((hotel) => ({
      hotel,
      approximateMeters: approximateDistanceMeters(hotelAnchor?.location, hotel.location),
    })).sort((a, b) => {
      if (hotelArea) {
        const aArea = hotelMatchesArea(a.hotel, hotelArea) ? 0 : 1;
        const bArea = hotelMatchesArea(b.hotel, hotelArea) ? 0 : 1;
        if (aArea !== bArea) return aArea - bArea;
      }
      return a.approximateMeters - b.approximateMeters;
    }).slice(0, commuteCheckLimit);
    let hotelRoutesChecked = 0;
    if (hotelAnchor?.location) {
      for (const candidate of hotelRouteCandidates) {
        if (toolStats.count >= toolStats.limit - reserveForHotelRetry) break;
        const routeArgs = {
          origin: hotelAnchor.location,
          destination: candidate.hotel.location,
          originName: hotelAnchor.name,
          destinationName: candidate.hotel.name,
          mode: "driving",
        };
        const routeResult = await executeRoute(routeArgs);
        const leg = routeResult?.data?.[0];
        if (Number.isFinite(leg?.minutes)) {
          candidate.hotel.commuteMinutes = leg.minutes;
          candidate.hotel.commuteDistanceMeters = leg.distanceMeters;
          candidate.hotel.commuteMode = leg.mode ?? "驾车";
          candidate.hotel.commuteFrom = hotelAnchor.name;
          candidate.hotel.commuteVerified = true;
          hotelRoutesChecked += 1;
        }
      }
    }
    const remainingDetailBudget = Math.min(
      MAX_HOTEL_DETAIL_CANDIDATES,
      Math.max(0, toolStats.limit - toolStats.count - reserveForHotelRetry)
    );
    const detailCandidates = [...hotels]
      .filter((hotel) => hotel.providerHotelId !== null && hotel.providerHotelId !== undefined)
      .sort((a, b) => compareHotelCandidates(a, b, { hotelArea, travelers: decision.constraints.travelers }))
      .slice(0, remainingDetailBudget);
    let hotelDetailsChecked = 0;
    for (const hotel of detailCandidates) {
      if (toolStats.count >= toolStats.limit - reserveForHotelRetry) break;
      const detailArgs = {
        providerHotelId: hotel.providerHotelId,
        startDate: decision.constraints.startDate,
        checkOutDate: addDays(decision.constraints.startDate, Math.max(1, Number(decision.constraints.days) - 1)),
        rooms: requestedHotelRooms,
        travelers: Number(decision.constraints.travelers || 1),
      };
      const detailResult = await executeWithRetry({
        trace,
        toolStats,
        toolId: "hotel.detail",
        args: { hotel: hotel.name },
        execute: () => liveTools.hotelDetail(detailArgs),
      });
      if (detailResult?.data) {
        hotel.rooms = detailResult.data.rooms ?? [];
        hotel.roomCount = requestedHotelRooms;
        hotel.bookingUrl = detailResult.data.bookingUrl || hotel.bookingUrl;
        hotel.updatedAt = detailResult.data.updatedAt;
        const compliantRoom = chooseRoom(hotel, { travelers: decision.constraints.travelers });
        hotel.room = compliantRoom?.name ?? "无符合人数与房量的可售房型";
        hotel.status = compliantRoom
          ? `房型与房态已查询 · ${requestedHotelRooms} 间房可容纳 ${decision.constraints.travelers} 人`
          : hotel.rooms.length
            ? "房型已查询 · 未找到同时满足人数、房量与可售状态的房型"
            : "房型已查询 · 当前暂无可售方案";
        hotelDetailsChecked += 1;
      }
    }
    trace.add(
      "hotel_detail",
      hotelDetailsChecked ? "房型与房态已查询" : "房型与房态暂不可用",
      hotelDetailsChecked
        ? `已取得 ${hotelDetailsChecked} 家酒店的房型、含税总价与可售状态；未执行锁价或下单。`
        : "没有取得可验证的房型与房态，页面不会补写酒店价格。",
      { status: hotelDetailsChecked ? "success" : "warning", checked: hotelDetailsChecked }
    );
    hotels = hotels.sort((a, b) => compareHotelCandidates(a, b, { hotelArea, travelers: decision.constraints.travelers }));
    selectedHotel = chooseHotel(hotels, { hotelArea, travelers: decision.constraints.travelers });
    if (selectedHotel) selectedHotel.selectedRoom = chooseRoom(selectedHotel, { travelers: decision.constraints.travelers });
    if (!selectedHotel && hotels.length) {
      refreshWarnings.push("酒店候选已取得，但没有符合当前日期、人数与房量的可售房型；请调整住宿偏好后重新规划。");
    }
    if (!hotels.length) refreshWarnings.push("酒店刷新未取得可验证候选；未沿用旧日期的房态冒充本轮结果。");
    const areaMatched = hotelArea ? hotels.filter((hotel) => hotelMatchesArea(hotel, hotelArea)).length : null;
    const hasVerifiedCommute = Number.isFinite(selectedHotel?.commuteMinutes);
    hotelRanking = {
      basis: hotelArea
        ? hasVerifiedCommute
          ? "酒店区域偏好 > 首日景点驾车通勤时间"
          : areaMatched
            ? "酒店区域偏好（通勤时间暂不可用）"
            : "评分（指定区域无匹配候选）"
        : hasVerifiedCommute
          ? "首日景点驾车通勤时间"
          : "评分（通勤时间暂不可用）",
      areaPreference: hotelArea ?? null,
      areaMatched,
      anchor: hotelAnchor?.name ?? null,
      checked: hotelRoutesChecked,
      total: hotels.length,
      disclaimer: hotelArea
        ? `先比较是否属于“${hotelArea}”区域，再比较可售状态、通勤时间和评分；区域文字仅按酒店真实名称、地址和行政区匹配。`
        : hotelAnchor
          ? "按可售状态与高德真实驾车时间排序；未取得通勤时间的候选排后，评分只用于耗时相同时比较。"
          : "首日景点不可用，酒店暂时只能按评分排序。",
    };
    trace.add(
      "hotel_ranking",
      hotelArea ? "酒店按区域偏好与首日通勤排序" : hotelRoutesChecked ? "酒店按首日通勤排序" : "酒店通勤排序不可用",
      hotelRoutesChecked
        ? `以“${hotelAnchor.name}”为起点，取得 ${hotelRoutesChecked} / ${hotels.length} 家酒店的真实驾车时间；${hotelArea ? `区域优先“${hotelArea}”，区域匹配 ${areaMatched ?? 0} 家；` : ""}首选 ${selectedHotel?.name ?? "暂无"}。`
        : "没有取得首日景点到酒店的真实驾车时间，未把距离估算冒充通勤时间。",
      { status: hotelRoutesChecked ? "success" : "warning", checked: hotelRoutesChecked, total: hotels.length }
    );
    if (hotelArea && areaMatched === 0) {
      refreshWarnings.push(`酒店搜索参数已包含“${hotelArea}”，但返回候选的名称、地址和行政区均未明确匹配该区域。`);
    }
    if (hotelAnchor && hotelRoutesChecked < hotels.length) {
      refreshWarnings.push(
        hotelRoutesChecked
          ? `仅有 ${hotelRoutesChecked} / ${hotels.length} 家酒店取得真实通勤时间；其余候选排在已确认耗时之后。`
          : "酒店真实通勤时间暂不可用，当前候选顺序不能视为通勤优先。"
      );
    }
  } else {
    selectedHotel = hotels.find((hotel) => hotel.selected)
      ?? hotels.find((hotel) => hotel.name === previousPlan?.selectedHotel?.name)
      ?? null;
    if (selectedHotel || previousPlan?.selectedHotel) {
      selectedHotel = {
        ...(selectedHotel ?? previousPlan.selectedHotel),
        selectedRoom: selectedHotel?.selectedRoom ?? previousPlan?.selectedHotel?.selectedRoom ?? null,
      };
    }
  }
  const canRebuildDays = !previousPlan
    || affectedModules.includes("itinerary")
    || affectedModules.includes("routes")
    || affectedModules.includes("weather");
  const rebuilt = canRebuildDays
    ? buildDays(decision.constraints, attractions, dining, outputs.routes ?? [], weather, outputs.diningCommutes ?? [], buildOptions)
    : { days: [], weatherAdaptations: [], warnings: [] };
  refreshWarnings.push(...rebuilt.warnings);
  const lockConflicts = rebuilt.weatherAdaptations.filter((item) => item.type === "locked_weather_conflict");
  if (!canRebuildDays && (previousPlan?.lockConflicts ?? []).length) {
    refreshWarnings.push("上一版仍有锁定景点与天气冲突，等待你确认是否更换；当前版本继续保留原景点。");
  }
  if (rebuilt.weatherAdaptations.length) {
    const lockedConflict = rebuilt.weatherAdaptations.find((item) => item.type === "locked_weather_conflict");
    trace.add(
      "weather_adaptation",
      lockedConflict ? "锁定景点与雨天预报冲突" : "雨天室内适配已有依据",
      lockedConflict
        ? lockedConflict.message
        : `${rebuilt.weatherAdaptations.length} 个雨天日期已有室内切换或不可用说明。`,
      {
        status: lockedConflict ? "warning" : "success",
        adaptedDays: rebuilt.weatherAdaptations.length,
        requiresUserConfirmation: Boolean(lockedConflict),
      }
    );
  }
  const days = (rebuilt.days.length ? rebuilt.days : previousPlan?.days ?? []).map((day) => {
    const forecast = weatherByDate.get(day.date);
    const nextDay = forecast
      ? { ...day, weatherHint: `${forecast.condition} ${forecast.low}–${forecast.high}℃` }
      : { ...day };
    if (!canRebuildDays && nextDay.weatherAdaptation) {
      nextDay.weatherAdaptation = {
        ...nextDay.weatherAdaptation,
        evidenceScope: "inherited",
        sourceVersion: previousPlan?.version ?? null,
        changedThisTurn: false,
      };
    } else if (nextDay.weatherAdaptation) {
      nextDay.weatherAdaptation = {
        ...nextDay.weatherAdaptation,
        evidenceScope: "current",
        changedThisTurn: true,
      };
    }
    return nextDay;
  });
  const routes = routeRefreshRequested ? outputs.routes ?? [] : previousPlan?.routes ?? [];
  const plan = {
    id: `live-plan-${Date.now()}`,
    version: previousPlan ? (previousPlan.version ?? 1) + 1 : 1,
    title: `${decision.constraints.destination} · 真实数据 ${decision.constraints.days} 日`,
    subtitle: "天气与 POI 来自实时接口；景点营业时间、逐日午晚餐路线与雨天切换有据可查，酒店按首日通勤与房态排序",
    dataMode: "live",
    updatedAt: new Date().toISOString(),
    constraints: decision.constraints,
    weather,
    weatherUnavailable: weather.length === 0,
    weatherCoverage: {
      requestedDays: decision.constraints.days,
      returnedDays: weather.length,
      complete: weather.length >= decision.constraints.days,
    },
    weatherAdaptations: rebuilt.weatherAdaptations.map((item) => ({
      ...item,
      evidenceScope: "current",
      changedThisTurn: true,
    })),
    inheritedWeatherAdaptations: canRebuildDays
      ? []
      : (previousPlan?.weatherAdaptations ?? []).map((item) => ({
          ...item,
          evidenceScope: "inherited",
          sourceVersion: previousPlan?.version ?? null,
          changedThisTurn: false,
        })),
    days,
    attractions,
    dining,
    diningUnavailable: dining.length === 0,
    diningCommutes: outputs.diningCommutes ?? [],
    diningCommuteStatus: {
      requested: diningRouteTargets.length,
      verified: verifiedDiningCommuteCount,
      complete: diningRouteTargets.length > 0 && verifiedDiningCommuteCount === diningRouteTargets.length,
    },
    routes,
    routesUnavailable: firstDayAttractions.length >= 2 && routes.length === 0,
    hotels: hotels.map((hotel) => ({ ...hotel, selected: selectedHotel?.id === hotel.id })),
    hotelsUnavailable: hotels.length === 0,
    selectedHotel,
    hotelRanking,
    lock: previousPlan
      ? adjustmentContext.preservation
      : { dates: false, attractions: { mode: "changed" }, dining: { mode: "changed", slots: [] }, hotelPreferences: false },
    lockConflicts,
    notes: [
      "天气来自和风天气，地点和路线来自高德地图。",
      "景点营业时间和餐厅候选来自高德公开 POI；所有已安排日期的午餐、晚餐路线优先用高德核验，超出单任务额度或查询失败的路段明确标记待核验，人均消费不展示。",
      "酒店搜索、房型、含税总价和房态来自 RollingGo MCP；价格按供应商返回口径展示，系统不推算其他旅行费用。",
      "缺失字段保持暂不可用，系统不会用估算值或模型记忆补齐。",
      ...refreshWarnings,
    ],
    refreshWarnings,
  };
  plan.changes = summarizePlanChanges(previousPlan, plan);
  plan.lockAudit = auditLockedPlan({
    lock: plan.lock,
    previousPlan,
    plan,
    nextStep: lockConflicts.length ? "是否允许我更换与雨天冲突的锁定景点？" : null,
  });
  plan.checks = validateLivePlan(plan);
  plan.openingScheduleAudit = auditOpeningSchedule(plan);
  plan.checks.push({
    label: "营业时间与日程兼容",
    pass: plan.openingScheduleAudit.complete,
    detail: plan.openingScheduleAudit.complete
      ? plan.openingScheduleAudit.unknowns.length
        ? `未发现已开放时间与日程冲突；${plan.openingScheduleAudit.unknowns.length} 项营业时间仍需官方确认。`
        : `${plan.openingScheduleAudit.checks.length} 个已安排景点与餐次均落在已返回营业时间的可用交集内。`
      : `${plan.openingScheduleAudit.conflicts.length} 项已返回营业时间与日程冲突，不能作为可执行方案。`,
  });
  plan.hardConstraintAudit = auditUserHardConstraints(plan);
  plan.checks.push(...plan.hardConstraintAudit.checks.map((check) => ({
    label: `用户约束：${check.label}`,
    pass: check.pass,
    detail: check.detail,
  })));
  plan.checks.forEach((check) => trace.add("validation", check.label, check.detail, { status: check.pass ? "success" : "error" }));

  const constraintGaps = plan.hardConstraintAudit.gaps;
  const openingConflicts = plan.openingScheduleAudit.conflicts;
  const deliveryBlockers = [...constraintGaps, ...openingConflicts, ...lockConflicts];
  const confirmationAllowed = deliveryBlockers.length === 0;
  plan.deliveryStatus = confirmationAllowed ? "ready_for_confirmation" : "blocked_by_constraints";
  plan.confirmationAllowed = confirmationAllowed;
  plan.relaxationOptions = relaxationOptionsFor({ gaps: constraintGaps, lockConflicts, openingConflicts });
  const hasGap = plan.weatherUnavailable || !plan.weatherCoverage.complete || plan.hotelsUnavailable || plan.routesUnavailable || plan.diningUnavailable || !plan.days.length || refreshWarnings.length > 0 || lockConflicts.length > 0 || constraintGaps.length > 0 || openingConflicts.length > 0;
  const taskStatus = hasGap ? "部分完成" : "已完成";
  if (hasGap) trace.add("degrade", confirmationAllowed ? "真实数据不完整" : "硬约束未满足，方案不可确认", confirmationAllowed
    ? "缺失模块明确标记暂不可用，未用估算值或模型记忆补齐。"
    : `未满足或不可核验的条件：${deliveryBlockers.map((item) => item.label ?? item.type ?? "营业时间冲突").join("、")}。`, { status: "warning", confirmationAllowed });
  if (previousPlan) {
    trace.add("lock_preservation", "核验锁定内容", plan.lockAudit.checks.map((check) => `${check.key}:${check.pass ? "通过" : "失败"}`).join("；"), {
      status: plan.lockAudit.complete ? "success" : "error",
      checks: plan.lockAudit.checks,
    });
    trace.add("diff", "输出局部变化", `版本 ${plan.version}；受影响模块：${affectedModules.join("、")}；差异：${JSON.stringify(plan.changes)}`, {
      status: plan.lockAudit.complete ? "success" : "error",
      affectedModules,
      changes: plan.changes,
    });
  }
  trace.add("human_gate", confirmationAllowed ? "等待用户确认" : "等待放宽条件", confirmationAllowed
    ? "当前只是规划草稿，没有执行预订、支付或订单修改。"
    : "未满足硬约束的方案不能被确认；请选择页面给出的放宽方式后重新规划。", { status: "waiting", action: confirmationAllowed ? "confirm_draft" : "relax_constraints" });

  const conflictStep = lockConflicts.length ? "是否允许我更换与雨天冲突的锁定景点？" : null;
  const constraintNames = constraintGaps.map((check) => check.label);
  const constraintMessage = constraintNames.length
    ? `当前方案未完整落实以下用户硬约束：${constraintNames.join("、")}。`
    : null;
  const constraintStep = constraintNames.length
    ? `请从以下放宽方式中选择：${plan.relaxationOptions.join(" ")}`
    : null;

  return buildResultBase({
    state: confirmationAllowed ? "complete" : "constraint_conflict",
    taskStatus,
    message: !confirmationAllowed
      ? `当前方案无法确认：${deliveryBlockers.map((item) => item.label ?? `${item.date} ${item.time} ${item.title}`).join("、")}。未把冲突项包装成可执行方案。`
      : lockConflicts.length
      ? "已保留你锁定的景点，但新预报有雨天，需要你决定是否更换。"
      : constraintMessage ?? (hasGap ? "已完成真实数据查询，部分行程信息暂时无法验证。" : "真实数据规划已完成并通过规则校验。"),
    nextStep: !confirmationAllowed
      ? `请从以下放宽方式中选择：${plan.relaxationOptions.join(" ")}`
      : conflictStep ?? constraintStep ?? (hasGap ? "查看当前部分方案，并重试缺失的真实数据模块。" : "确认这版草稿，或继续修改需求。"),
    constraints: decision.constraints,
    plan,
    trace,
    startedAt,
    toolStats,
    modelRounds,
    usage,
    modelRequestIds,
    config,
    modelCalls,
  });
}
