import { createHash } from "node:crypto";
import { fetchJson } from "./http-client.js";
import { createRollingGoHotelClient } from "./rollinggo-hotel-client.js";

export const TOOL_REGISTRY = [
  { id: "weather.forecast", name: "天气预报", permission: "只读", scope: "目的地与未来 10 天日期", sideEffect: "无", risk: "低", enabled: true },
  { id: "poi.searchAttractions", name: "真实景点搜索", permission: "只读", scope: "高德公开 POI 与当前位置", sideEffect: "无", risk: "低", enabled: true },
  { id: "poi.searchDining", name: "真实餐饮搜索", permission: "只读", scope: "高德公开餐厅 POI、评分、位置与营业时间", sideEffect: "无", risk: "低", enabled: true },
  { id: "hotel.search", name: "真实酒店搜索", permission: "只读", scope: "RollingGo 酒店、参考价与外部详情链接", sideEffect: "无；不锁房", risk: "低", enabled: true },
  { id: "hotel.detail", name: "房型与房态查询", permission: "只读", scope: "单一酒店的实时房型、含税总价与可售状态", sideEffect: "无；不锁价、不创建订单", risk: "低", enabled: true },
  { id: "route.plan", name: "真实路线规划", permission: "只读", scope: "已查询 POI 的坐标之间", sideEffect: "无", risk: "低", enabled: true },
  { id: "hotel.book", name: "酒店预订/支付", permission: "禁止", scope: "未注册写工具", sideEffect: "会改变真实订单", risk: "高", enabled: false },
  { id: "user.readOther", name: "读取其他用户数据", permission: "禁止", scope: "当前用户之外的数据", sideEffect: "隐私风险", risk: "高", enabled: false },
  { id: "message.send", name: "向外部联系人发送", permission: "禁止", scope: "当前用户之外的联系人", sideEffect: "产生外部消息", risk: "高", enabled: false },
];

export const TOOL_CONTRACT_VERSION = "travel-tools/1.1.0";
export const TOOL_CONTRACT_METADATA = Object.freeze({
  version: TOOL_CONTRACT_VERSION,
  sha256: createHash("sha256").update(JSON.stringify(TOOL_REGISTRY)).digest("hex"),
});

export class LiveToolError extends Error {
  constructor(message, { code = "LIVE_TOOL_ERROR", retryable = false } = {}) {
    super(message);
    this.name = "LiveToolError";
    this.code = code;
    this.retryable = retryable;
  }
}

function qweatherUrl(config, path, params) {
  const url = new URL(`${config.weather.apiHost}${path}`);
  Object.entries({ ...params, key: config.weather.apiKey }).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  return url;
}

function amapUrl(config, path, params) {
  const url = new URL(`https://restapi.amap.com${path}`);
  Object.entries({ ...params, key: config.amap.apiKey }).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  return url;
}

function assertQWeather(data) {
  if (String(data?.code) !== "200") {
    throw new LiveToolError(`和风天气返回错误代码 ${data?.code ?? "unknown"}`, {
      code: `QWEATHER_${data?.code ?? "UNKNOWN"}`,
      retryable: ["204", "429", "500"].includes(String(data?.code)),
    });
  }
}

function assertAmap(data) {
  if (String(data?.status) !== "1") {
    throw new LiveToolError(`高德地图返回错误：${data?.info || data?.infocode || "unknown"}`, {
      code: `AMAP_${data?.infocode || "UNKNOWN"}`,
      retryable: ["10001", "10021", "10029"].includes(String(data?.infocode)),
    });
  }
}

function asyncArray(value) {
  return Array.isArray(value) ? value : [];
}

const INDOOR_NAME_PATTERN = /博物馆|博物院|美术馆|科技馆|展览馆|纪念馆|文化馆|图书馆|艺术馆|水族馆|海洋馆|大剧院|剧院|室内展览/i;
const INDOOR_TYPE_PATTERN = /博物馆|展览馆|美术馆|图书馆|科技馆|文化馆|纪念馆|影剧院|体育场馆|购物中心/i;

function isIndoorPoi(poi) {
  const descriptor = `${poi.name || ""} ${poi.type || ""}`;
  return INDOOR_NAME_PATTERN.test(descriptor) || INDOOR_TYPE_PATTERN.test(String(poi.type || ""));
}

function normalizeAttraction(poi) {
  const openTime = String(poi.biz_ext?.open_time || poi.open_time || "").trim();
  return {
    id: String(poi.id || poi.name),
    name: String(poi.name || "未命名景点"),
    area: String(poi.adname || poi.cityname || ""),
    address: String(poi.address || "地址暂不可用"),
    location: typeof poi.location === "string" ? poi.location : null,
    open: openTime || "营业时间需确认",
    openVerified: Boolean(openTime),
    openSource: openTime ? "高德地图" : null,
    rating: poi.biz_ext?.rating ? String(poi.biz_ext.rating) : null,
    type: String(poi.type || "POI 类型暂缺"),
    indoor: isIndoorPoi(poi),
    indoorBasis: isIndoorPoi(poi) ? "按高德 POI 名称与类型识别，开放状态需确认" : null,
    ticket: null,
    status: "真实 POI · 票价需确认",
    source: "高德地图",
  };
}

function normalizeDining(poi) {
  const openTime = String(poi.biz_ext?.open_time || poi.open_time || "").trim();
  const typeParts = String(poi.type || "").split(";").filter(Boolean);
  return {
    id: String(poi.id || poi.name),
    name: String(poi.name || "未命名餐厅"),
    address: String(poi.address || "地址暂不可用"),
    location: typeof poi.location === "string" ? poi.location : null,
    cuisine: typeParts.at(-1) || "餐厅",
    rating: poi.biz_ext?.rating ? String(poi.biz_ext.rating) : null,
    open: openTime || "营业时间需确认",
    openVerified: Boolean(openTime),
    status: "真实餐饮 POI · 营业信息来自高德",
    source: "高德地图",
  };
}

export function createLiveTools(config, { fetchImpl = fetch, hotelClient = null } = {}) {
  const rollingGo = hotelClient ?? createRollingGoHotelClient(config.rollingGo ?? {});
  async function getCityId(destination) {
    const lookupHost = config.weather.apiHost || config.weather.geoHost;
    const lookupPath = config.weather.apiHost ? "/geo/v2/city/lookup" : "/v2/city/lookup";
    const url = new URL(`${lookupHost}${lookupPath}`);
    url.searchParams.set("location", destination);
    url.searchParams.set("lang", "zh");
    url.searchParams.set("key", config.weather.apiKey);
    const data = await fetchJson(url, {}, config.weather.timeoutMs, fetchImpl);
    assertQWeather(data);
    const city = data.location?.[0];
    if (!city?.id) throw new LiveToolError("没有找到城市对应的天气位置", { code: "CITY_NOT_FOUND" });
    return city.id;
  }

  async function weatherForecast(args) {
    const destination = String(args.destination || "").trim();
    const coordinates = String(args.location || "").trim();
    const startDate = String(args.startDate || "");
    const days = Number(args.days || 0);
    if (!destination || !startDate || days < 1) throw new LiveToolError("天气查询参数不完整", { code: "INVALID_ARGUMENTS" });
    const start = new Date(`${startDate}T00:00:00+08:00`);
    const shanghaiToday = new Date().toLocaleString("en-CA", { timeZone: "Asia/Shanghai" }).slice(0, 10);
    const today = new Date(`${shanghaiToday}T00:00:00+08:00`);
    const offset = Math.round((start - today) / 86400000);
    if (Number.isNaN(offset) || offset < 0 || offset > 9) {
      throw new LiveToolError("出发日期超出现有 10 天天气预报范围，不生成具体天气", { code: "FORECAST_OUT_OF_RANGE" });
    }
    const locationId = /^[0-9.]+,[0-9.]+$/.test(coordinates) ? coordinates : await getCityId(destination);
    const data = await fetchJson(
      qweatherUrl(config, "/v7/weather/10d", { location: locationId, lang: "zh" }),
      {},
      config.weather.timeoutMs,
      fetchImpl
    );
    assertQWeather(data);
    const forecasts = asyncArray(data.daily)
      .filter((item) => item.fxDate >= startDate)
      .slice(0, days)
      .map((item) => ({
        date: item.fxDate,
        condition: item.textDay || "未知",
        low: Number(item.tempMin),
        high: Number(item.tempMax),
        precipitation: item.precip ? `${item.precip}%` : "—",
        source: "和风天气",
        updatedAt: data.updateTime || new Date().toISOString(),
        status: "已查询",
      }))
      .filter((item) => Number.isFinite(item.low) && Number.isFinite(item.high));
    if (!forecasts.length) throw new LiveToolError("天气预报没有覆盖所选日期", { code: "NO_FORECAST_DATA" });
    return { data: forecasts, summary: `和风天气返回 ${forecasts.length} 天真实预报`, source: "和风天气", dataMode: "live" };
  }

  async function searchAttractions(args) {
    const destination = String(args.destination || "").trim();
    const indoorOnly = args.indoorOnly === true;
    if (!destination) throw new LiveToolError("缺少目的地", { code: "INVALID_ARGUMENTS" });
    const data = await fetchJson(
      amapUrl(config, "/v3/place/text", {
        keywords: indoorOnly ? "博物馆|展览馆|美术馆|科技馆|纪念馆" : "景点",
        city: destination,
        citylimit: "true",
        ...(indoorOnly ? {} : { types: "110000" }),
        offset: "10",
        page: "1",
        extensions: "all",
      }),
      {}, config.amap.timeoutMs, fetchImpl
    );
    assertAmap(data);
    const attractions = asyncArray(data.pois)
      .map(normalizeAttraction)
      .filter((item) => item.location && (!indoorOnly || item.indoor));
    if (!attractions.length) {
      throw new LiveToolError(indoorOnly ? "高德未返回可识别的室内 POI" : "高德未返回可用景点 POI", { code: "NO_POI_DATA" });
    }
    return {
      data: attractions,
      summary: indoorOnly
        ? `高德返回 ${attractions.length} 个室内候选；室内属性按 POI 类型识别，开放状态需确认`
        : `高德返回 ${attractions.length} 个真实景点 POI`,
      source: "高德地图",
      dataMode: "live",
      ...(indoorOnly ? { caution: "室内属性用于天气适配，不代表场馆当天一定开放" } : {}),
    };
  }

  async function searchDining(args) {
    const destination = String(args.destination || "").trim();
    if (!destination) throw new LiveToolError("缺少目的地", { code: "INVALID_ARGUMENTS" });
    const preferences = asyncArray(args.preferences).map(String);
    const keyword = preferences.find((item) => /本地菜|杭帮菜|小吃|美食|素食|火锅|咖啡|面馆|烧烤/i.test(item)) || "餐厅";
    const data = await fetchJson(
      amapUrl(config, "/v3/place/text", {
        keywords: keyword,
        city: destination,
        citylimit: "true",
        types: "050000",
        offset: "10",
        page: "1",
        extensions: "all",
      }),
      {}, config.amap.timeoutMs, fetchImpl
    );
    assertAmap(data);
    const dining = asyncArray(data.pois)
      .map(normalizeDining)
      .filter((item) => item.location);
    if (!dining.length) throw new LiveToolError("高德未返回可用餐厅 POI", { code: "NO_DINING_DATA" });
    return {
      data: dining,
      summary: `高德返回 ${dining.length} 个真实餐饮 POI`,
      source: "高德地图",
      dataMode: "live",
      caution: "餐厅营业时间和评分来自高德公开信息，现场状态以商家为准",
    };
  }

  async function searchHotels(args) {
    const destination = String(args.destination || "").trim();
    if (!destination) throw new LiveToolError("缺少目的地", { code: "INVALID_ARGUMENTS" });
    try {
      const result = await rollingGo.searchHotels({
        destination,
        checkInDate: args.startDate,
        nights: Math.max(1, Number(args.days || 1) - 1),
        travelers: Number(args.travelers || 2),
        rooms: Math.max(1, Math.ceil(Number(args.travelers || 2) / 2)),
        originQuery: args.query,
      });
      const hotels = result.hotels.filter((item) => item.location);
      if (!hotels.length) throw new LiveToolError("RollingGo MCP 未返回可用酒店", { code: "NO_HOTEL_DATA" });
      return {
        data: hotels,
        summary: `RollingGo MCP 返回 ${hotels.length} 家真实酒店；展示价为参考价，房型与房态需继续查询`,
        source: "RollingGo MCP",
        dataMode: "live",
        nights: result.nights,
        rooms: result.rooms,
        caution: "搜索参考价不等于最终可订总价",
      };
    } catch (error) {
      throw new LiveToolError(error.message, { code: error.code, retryable: error.retryable });
    }
  }

  async function hotelDetail(args) {
    try {
      const result = await rollingGo.hotelDetail({
        hotelId: args.providerHotelId,
        checkInDate: args.startDate,
        checkOutDate: args.checkOutDate,
        rooms: args.rooms,
        travelers: args.travelers,
      });
      return {
        data: result,
        summary: `RollingGo MCP 返回 ${result.rooms.length} 个可售房型与对应房态`,
        source: "RollingGo MCP",
        dataMode: "live",
      };
    } catch (error) {
      throw new LiveToolError(error.message, { code: error.code, retryable: error.retryable });
    }
  }

  async function routePlan(args) {
    const origin = String(args.origin || "");
    const destination = String(args.destination || "");
    const mode = args.mode === "walking" ? "walking" : "driving";
    if (!/^[0-9.]+,[0-9.]+$/.test(origin) || !/^[0-9.]+,[0-9.]+$/.test(destination)) {
      throw new LiveToolError("路线参数需要真实 POI 坐标", { code: "INVALID_ARGUMENTS" });
    }
    const data = await fetchJson(
      amapUrl(config, `/v3/direction/${mode}`, { origin, destination, extensions: "base" }),
      {}, config.amap.timeoutMs, fetchImpl
    );
    assertAmap(data);
    const path = data.route?.paths?.[0];
    const duration = Number(path?.duration);
    const distance = Number(path?.distance);
    if (!path || !Number.isFinite(duration) || !Number.isFinite(distance) || duration <= 0 || distance <= 0) {
      throw new LiveToolError("高德未返回可用路线", { code: "NO_ROUTE_DATA" });
    }
    return {
      data: [{
        from: String(args.originName || "起点"),
        to: String(args.destinationName || "终点"),
        minutes: Math.max(1, Math.round(duration / 60)),
        distanceMeters: distance,
        mode: mode === "walking" ? "步行" : "驾车",
        verified: true,
        source: "高德地图",
      }],
      summary: `高德返回 1 段真实${mode === "walking" ? "步行" : "驾车"}路线`,
      source: "高德地图",
      dataMode: "live",
    };
  }

  return { weatherForecast, searchAttractions, searchDining, searchHotels, hotelDetail, routePlan };
}
