const DEFAULT_MCP_URL = "https://mcp.rollinggo.cn/mcp";
const DEFAULT_PROTOCOL_VERSION = "2025-03-26";
const MCP_ACCEPT = "application/json, text/event-stream";

export class RollingGoHotelError extends Error {
  constructor(message, { code = "ROLLINGGO_HOTEL_ERROR", retryable = false, statusCode = 502 } = {}) {
    super(message);
    this.name = "RollingGoHotelError";
    this.code = code;
    this.retryable = retryable;
    this.statusCode = statusCode;
  }
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cancellationSummary(policies) {
  if (!Array.isArray(policies) || !policies.length) return "退改政策未返回，需在供应商详情页确认";
  return policies.map((policy) => {
    if (policy.description) return String(policy.description);
    const amount = finiteNumber(policy.amount);
    const percent = finiteNumber(policy.percent);
    const penalty = amount !== null ? `¥${amount}` : percent !== null ? `${percent}%` : "未说明金额";
    const from = policy.fromDate ? `自 ${String(policy.fromDate).slice(0, 10)} 起` : "按供应商政策";
    return `${from}取消收取 ${penalty}`;
  }).join("；");
}

function stayNightCount(checkInDate, checkOutDate) {
  const start = new Date(`${checkInDate}T12:00:00Z`);
  const end = new Date(`${checkOutDate}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 1;
  return Math.max(1, Math.round((end - start) / 86400000));
}

export function normalizeRollingGoHotel(hotel, { nights = 1, rooms = 1 } = {}) {
  const lowest = finiteNumber(hotel?.price?.lowestPrice ?? hotel?.lowestPrice);
  const latitude = finiteNumber(hotel?.latitude);
  const longitude = finiteNumber(hotel?.longitude);
  return {
    id: `rollinggo-${hotel?.hotelId}`,
    providerHotelId: hotel?.hotelId ?? null,
    provider: "RollingGo",
    name: String(hotel?.name || "未命名酒店"),
    brand: hotel?.brand ? String(hotel.brand) : null,
    area: String(hotel?.address || ""),
    address: String(hotel?.address || "地址暂不可用"),
    location: latitude !== null && longitude !== null ? `${longitude},${latitude}` : null,
    room: "房型待查询",
    nightlyRate: lowest,
    nightlyFrom: lowest,
    totalFrom: lowest !== null ? lowest * nights * rooms : null,
    rating: hotel?.starRating !== undefined && hotel?.starRating !== null ? String(hotel.starRating) : null,
    starRating: finiteNumber(hotel?.starRating),
    tags: Array.isArray(hotel?.tags) ? hotel.tags.map(String) : [],
    amenities: Array.isArray(hotel?.hotelAmenities) ? hotel.hotelAmenities.map(String) : [],
    imageUrl: safeHttpsUrl(hotel?.imageUrl),
    bookingUrl: safeHttpsUrl(hotel?.bookingUrl),
    distanceInMeters: finiteNumber(hotel?.distanceInMeters),
    distance: finiteNumber(hotel?.distanceInMeters) !== null
      ? `距搜索地点约 ${hotel.distanceInMeters} 米`
      : String(hotel?.address || "位置见供应商"),
    rooms: [],
    status: lowest !== null ? "参考价 · 房型房态待查询" : "房型、房价与房态待确认",
    source: "RollingGo MCP",
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeRoomRatePlan(plan, { nights = 1, rooms = 1 } = {}) {
  const inventory = finiteNumber(plan?.inventoryCount);
  const isOnRequest = plan?.isOnRequest === true;
  const soldOut = plan?.isSoldOut === true || plan?.soldOut === true || (inventory !== null && inventory <= 0);
  const availability = soldOut ? "已售罄" : isOnRequest ? "需人工确认" : "供应商可售";
  const nightlyPrice = finiteNumber(plan?.totalSalesRate ?? plan?.averagePrice ?? plan?.nightlyPrice);
  const directTotal = finiteNumber(plan?.totalPrice);
  const totalPrice = directTotal ?? (nightlyPrice !== null ? nightlyPrice * nights * rooms : null);
  const roomInfo = plan?.roomInfo && typeof plan.roomInfo === "object" ? plan.roomInfo : {};
  return {
    roomTypeId: plan?.roomTypeId ?? null,
    ratePlanId: plan?.ratePlanId ?? null,
    name: String(plan?.roomNameCn || plan?.roomName || plan?.ratePlanName || "未命名房型"),
    bed: String(plan?.bedTypeDescription || "床型待确认"),
    currency: plan?.currency === "CNY" ? "CNY" : String(plan?.currency || "CNY"),
    totalPrice,
    nightlyPrice,
    priceBasis: directTotal !== null ? "供应商总价" : nightlyPrice !== null ? "每晚均价 × 晚数 × 房量" : "价格待确认",
    inventoryCount: inventory,
    isOnRequest,
    availability,
    isAvailable: !soldOut,
    meal: String(plan?.mealTypeStr || (plan?.mealAmount > 0 ? "含早餐" : "餐食待确认")),
    maxOccupancy: finiteNumber(roomInfo.maxOccupancy),
    roomSize: roomInfo.size ? String(roomInfo.size) : null,
    roomWindow: typeof roomInfo.hasWindow === "boolean" ? roomInfo.hasWindow : null,
    cancellation: cancellationSummary(plan?.cancellationPolicies ?? (plan?.cancelPolicy ? [{ description: plan.cancelPolicy }] : [])),
    source: "RollingGo MCP",
  };
}

function parseJsonText(text) {
  const value = String(text ?? "").trim();
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(value.slice(start, end + 1)); } catch { /* not JSON */ }
    }
    const arrayStart = value.indexOf("[");
    const arrayEnd = value.lastIndexOf("]");
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      try { return JSON.parse(value.slice(arrayStart, arrayEnd + 1)); } catch { /* not JSON */ }
    }
    return null;
  }
}

function parseSseMessages(body) {
  const messages = [];
  for (const block of String(body ?? "").split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    try { messages.push(JSON.parse(data)); } catch { /* ignore non-rpc event data */ }
  }
  return messages;
}

async function readRpcMessage(response, requestId) {
  const contentType = response.headers.get("content-type") || "";
  const body = await response.text();
  const messages = contentType.includes("text/event-stream")
    ? parseSseMessages(body)
    : [(() => {
        try { return JSON.parse(body); } catch { return null; }
      })()].filter(Boolean);
  const message = messages.find((item) => item?.id === requestId)
    ?? messages.find((item) => item?.result !== undefined || item?.error !== undefined)
    ?? messages.at(-1);
  if (!message) {
    throw new RollingGoHotelError("酒店 MCP 服务没有返回有效响应", { code: "ROLLINGGO_INVALID_MCP_RESPONSE" });
  }
  return message;
}

function rpcError(message, status = 502) {
  const detail = message?.error?.message || message?.error?.data?.message || "酒店 MCP 请求失败";
  const authRequired = status === 401 || status === 403 || /unauthorized|invalid token|认证|登录/i.test(String(detail));
  return new RollingGoHotelError(
    authRequired ? "RollingGo MCP 授权无效，请检查 API Key" : String(detail),
    {
      code: authRequired ? "ROLLINGGO_AUTH_REQUIRED" : "ROLLINGGO_MCP_ERROR",
      statusCode: authRequired ? 401 : status,
    }
  );
}

function createMcpSession(config = {}, fetchImpl = fetch) {
  const endpoint = safeHttpsUrl(config.mcpUrl || DEFAULT_MCP_URL);
  const apiKey = String(config.apiKey || "").trim();
  const timeoutMs = Math.max(1000, Number(config.timeoutMs || 60000));
  const protocolVersion = String(config.protocolVersion || DEFAULT_PROTOCOL_VERSION);
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: MCP_ACCEPT,
  };
  let nextId = 1;
  let sessionId = null;
  let initializePromise = null;

  async function post(payload, { notification = false } = {}) {
    if (!endpoint) {
      throw new RollingGoHotelError("RollingGo MCP 地址必须是 HTTPS", { code: "ROLLINGGO_MCP_URL_INVALID", statusCode: 400 });
    }
    if (!apiKey) {
      throw new RollingGoHotelError("请先配置 RollingGo MCP API Key", { code: "ROLLINGGO_AUTH_REQUIRED", statusCode: 401 });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { ...headers, ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}) },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const newSessionId = response.headers.get("mcp-session-id");
      if (newSessionId) sessionId = newSessionId;
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const parsed = parseJsonText(body);
        throw rpcError(parsed, response.status);
      }
      if (notification || response.status === 202) return null;
      return readRpcMessage(response, payload.id);
    } catch (error) {
      if (error instanceof RollingGoHotelError) throw error;
      if (error?.name === "AbortError") {
        throw new RollingGoHotelError("酒店 MCP 请求超时", { code: "ROLLINGGO_TIMEOUT", retryable: true, statusCode: 504 });
      }
      throw new RollingGoHotelError("无法连接 RollingGo MCP 服务", { code: "ROLLINGGO_NETWORK_ERROR", retryable: true });
    } finally {
      clearTimeout(timer);
    }
  }

  async function initialize() {
    if (!initializePromise) {
      initializePromise = (async () => {
        const id = nextId++;
        const response = await post({
          jsonrpc: "2.0",
          id,
          method: "initialize",
          params: {
            protocolVersion,
            capabilities: {},
            clientInfo: { name: "xingxu-travel-agent", version: "0.2.0" },
          },
        });
        if (response?.error) throw rpcError(response);
        await post({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }, { notification: true });
      })().catch((error) => {
        initializePromise = null;
        throw error;
      });
    }
    return initializePromise;
  }

  async function request(method, params = {}) {
    await initialize();
    const id = nextId++;
    const response = await post({ jsonrpc: "2.0", id, method, params });
    if (response?.error) throw rpcError(response);
    return response?.result ?? null;
  }

  return { request };
}

function normalizeName(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

function pickMcpTool(tools, kind) {
  const preferredNames = kind === "search"
    ? new Set(["searchhotels", "hotelsearch", "searchhotel"])
    : new Set(["gethoteldetail", "hoteldetail", "getroomrate", "hotelrooms"]);
  const exact = tools.find((tool) => preferredNames.has(normalizeName(tool.name)));
  if (exact) return exact;
  const scored = tools.map((tool) => {
    const descriptor = normalizeName(`${tool.name} ${tool.title} ${tool.description}`);
    let score = 0;
    if (/hotel|酒店/.test(descriptor)) score += 8;
    if (kind === "search") {
      if (/search|查询|搜索|推荐/.test(descriptor)) score += 8;
      if (/detail|room|rate|房型|房价/.test(descriptor)) score -= 8;
      if (/tag|metadata|static|标签|元数据|静态/.test(descriptor)) score -= 12;
      if (/searchhotels|hotelsearch/.test(normalizeName(tool.name))) score += 6;
    } else {
      if (/detail|room|rate|price|availability|房型|房态|房价/.test(descriptor)) score += 9;
      if (/^search|搜索/.test(descriptor)) score -= 5;
    }
    return { tool, score };
  }).sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? scored[0].tool : null;
}

function propertyKey(schema, aliases) {
  const properties = schema?.properties && typeof schema.properties === "object" ? schema.properties : {};
  const normalized = new Map(Object.keys(properties).map((key) => [normalizeName(key), key]));
  for (const alias of aliases) {
    const key = normalized.get(normalizeName(alias));
    if (key) return key;
  }
  return null;
}

function setSchemaValue(target, schema, aliases, value) {
  const key = propertyKey(schema, aliases);
  if (key) target[key] = value;
}

function buildSearchArguments(schema, values) {
  const args = {};
  const checkInKey = propertyKey(schema, ["checkInParam", "checkIn", "stayParam"]);
  if (checkInKey) {
    const nested = schema.properties[checkInKey];
    args[checkInKey] = {};
    setSchemaValue(args[checkInKey], nested, ["checkInDate", "checkIn", "checkin"], values.checkInDate);
    setSchemaValue(args[checkInKey], nested, ["stayNights", "nights", "nightCount"], values.stayNights);
    setSchemaValue(args[checkInKey], nested, ["adultCount", "adults", "adult"], values.adultCount);
  } else {
    setSchemaValue(args, schema, ["checkInDate", "checkIn", "checkin"], values.checkInDate);
    setSchemaValue(args, schema, ["stayNights", "nights", "nightCount"], values.stayNights);
    setSchemaValue(args, schema, ["adultCount", "adults", "adult"], values.adultCount);
  }
  setSchemaValue(args, schema, ["originQuery", "query", "searchQuery"], values.originQuery);
  setSchemaValue(args, schema, ["place", "city", "destination"], values.place);
  setSchemaValue(args, schema, ["placeType"], values.placeType);
  setSchemaValue(args, schema, ["size", "limit", "pageSize"], values.size);
  return args;
}

function buildDetailArguments(schema, values) {
  const args = {};
  setSchemaValue(args, schema, ["hotelId", "hotel_id", "id"], values.hotelId);
  const dateKey = propertyKey(schema, ["dateParam", "date", "stayParam"]);
  if (dateKey) {
    const nested = schema.properties[dateKey];
    args[dateKey] = {};
    setSchemaValue(args[dateKey], nested, ["checkInDate", "checkIn", "checkin"], values.checkInDate);
    setSchemaValue(args[dateKey], nested, ["checkOutDate", "checkOut", "checkout"], values.checkOutDate);
  } else {
    setSchemaValue(args, schema, ["checkInDate", "checkIn", "checkin"], values.checkInDate);
    setSchemaValue(args, schema, ["checkOutDate", "checkOut", "checkout"], values.checkOutDate);
  }
  const occupancyKey = propertyKey(schema, ["occupancyParam", "occupancy", "guestParam"]);
  if (occupancyKey) {
    const nested = schema.properties[occupancyKey];
    args[occupancyKey] = {};
    setSchemaValue(args[occupancyKey], nested, ["roomCount", "rooms", "room"], values.roomCount);
    setSchemaValue(args[occupancyKey], nested, ["adultCount", "adults", "adult"], values.adultCount);
  } else {
    setSchemaValue(args, schema, ["roomCount", "rooms", "room"], values.roomCount);
    setSchemaValue(args, schema, ["adultCount", "adults", "adult"], values.adultCount);
  }
  return args;
}

function unwrapToolResult(result) {
  if (result?.isError) {
    const text = Array.isArray(result.content)
      ? result.content.map((item) => item?.text ?? "").join("\n")
      : "";
    throw new RollingGoHotelError(text || "酒店 MCP 工具执行失败", { code: "ROLLINGGO_TOOL_ERROR" });
  }
  if (result?.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent;
  }
  if (Array.isArray(result?.content)) {
    const text = result.content.filter((item) => item?.type === "text").map((item) => item.text).join("\n");
    const parsed = parseJsonText(text);
    if (parsed !== null) return parsed;
  }
  return result;
}

function hotelListFrom(payload) {
  return Array.isArray(payload?.hotelInformationList) ? payload.hotelInformationList
    : Array.isArray(payload?.hotels) ? payload.hotels
      : Array.isArray(payload?.data?.hotelInformationList) ? payload.data.hotelInformationList
        : Array.isArray(payload?.data?.hotels) ? payload.data.hotels
          : [];
}

function roomListFrom(payload) {
  return Array.isArray(payload?.roomRatePlans) ? payload.roomRatePlans
    : Array.isArray(payload?.rooms) ? payload.rooms
      : Array.isArray(payload?.data?.roomRatePlans) ? payload.data.roomRatePlans
        : [];
}

export function createRollingGoHotelClient(config = {}, { fetchImpl = fetch } = {}) {
  const session = createMcpSession(config, fetchImpl);
  let toolCache = null;

  async function discoverTools() {
    if (toolCache) return toolCache;
    const result = await session.request("tools/list", {});
    const tools = Array.isArray(result?.tools) ? result.tools : [];
    if (!tools.length) {
      throw new RollingGoHotelError("RollingGo MCP 没有返回可用工具", { code: "ROLLINGGO_TOOL_MISSING" });
    }
    const search = pickMcpTool(tools, "search");
    const detail = pickMcpTool(tools, "detail");
    if (!search) {
      throw new RollingGoHotelError("RollingGo MCP 未提供酒店搜索工具", { code: "ROLLINGGO_SEARCH_TOOL_MISSING" });
    }
    toolCache = { search, detail, all: tools };
    return toolCache;
  }

  async function callTool(tool, args) {
    const payload = await session.request("tools/call", { name: tool.name, arguments: args });
    const unwrapped = unwrapToolResult(payload);
    if (unwrapped?.success === false) {
      throw new RollingGoHotelError(String(unwrapped.errorMessage || unwrapped.message || "酒店 MCP 工具返回失败"), {
        code: "ROLLINGGO_TOOL_ERROR",
      });
    }
    return unwrapped;
  }

  async function searchHotels({ destination, checkInDate, nights = 1, travelers = 2, rooms = 1, originQuery }) {
    if (!destination || !/^\d{4}-\d{2}-\d{2}$/.test(String(checkInDate ?? ""))) {
      throw new RollingGoHotelError("酒店搜索缺少目的地或入住日期", { code: "INVALID_ARGUMENTS", statusCode: 400 });
    }
    const boundedNights = Math.min(30, Math.max(1, Number(nights) || 1));
    const boundedTravelers = Math.min(20, Math.max(1, Number(travelers) || 2));
    const boundedRooms = Math.min(10, Math.max(1, Number(rooms) || 1));
    const adultsPerRoom = Math.min(10, Math.max(1, Math.ceil(boundedTravelers / boundedRooms)));
    const tools = await discoverTools();
    const args = buildSearchArguments(tools.search.inputSchema, {
      originQuery: String(originQuery || `${destination} ${boundedNights}晚 ${boundedTravelers}人`),
      place: /\s/.test(String(destination)) ? String(destination) : `${destination} 中国`,
      placeType: "城市",
      size: 5,
      checkInDate: String(checkInDate),
      stayNights: boundedNights,
      adultCount: adultsPerRoom,
    });
    const data = await callTool(tools.search, args);
    const hotels = hotelListFrom(data);
    return {
      message: String(data?.message || `返回 ${hotels.length} 家酒店`),
      hotels: hotels.map((hotel) => normalizeRollingGoHotel(hotel, { nights: boundedNights, rooms: boundedRooms })),
      nights: boundedNights,
      rooms: boundedRooms,
    };
  }

  async function hotelDetail({ hotelId, checkInDate, checkOutDate, rooms = 1, travelers = 2 }) {
    if (hotelId === undefined || hotelId === null || !checkInDate || !checkOutDate) {
      throw new RollingGoHotelError("房型查询缺少酒店或日期", { code: "INVALID_ARGUMENTS", statusCode: 400 });
    }
    const tools = await discoverTools();
    if (!tools.detail) {
      throw new RollingGoHotelError("RollingGo MCP 未提供房型房态工具", { code: "ROLLINGGO_DETAIL_TOOL_MISSING" });
    }
    const roomCount = Math.min(10, Math.max(1, Number(rooms) || 1));
    const adultCount = Math.min(10, Math.max(1, Math.ceil(Number(travelers) / roomCount)));
    const args = buildDetailArguments(tools.detail.inputSchema, {
      hotelId: Number.isFinite(Number(hotelId)) ? Number(hotelId) : String(hotelId),
      checkInDate: String(checkInDate),
      checkOutDate: String(checkOutDate),
      roomCount,
      adultCount,
    });
    const data = await callTool(tools.detail, args);
    const roomRatePlans = roomListFrom(data);
    const stayNights = stayNightCount(checkInDate, checkOutDate);
    return {
      hotelId: data?.hotelId ?? hotelId,
      name: String(data?.name || ""),
      checkInDate: String(data?.checkIn || checkInDate),
      checkOutDate: String(data?.checkOut || checkOutDate),
      bookingUrl: safeHttpsUrl(data?.bookingUrl),
      rooms: roomRatePlans.map((room) => normalizeRoomRatePlan(room, { nights: stayNights, rooms: roomCount })),
      updatedAt: new Date().toISOString(),
    };
  }

  return { searchHotels, hotelDetail };
}
