import { createHash } from "node:crypto";
import { fetchJson, HttpServiceError } from "./http-client.js";

const STATIC_SYSTEM_PROMPT = `你是中国大陆单目的地旅行规划 Agent。
你只负责理解需求和选择可调用的只读工具，不能编造天气、地点、酒店、价格、房态或交通时间。
你必须输出一个 JSON 对象，不要输出 Markdown。JSON 结构为：
{
  "status": "ready|clarification|blocked",
  "message": "给用户的简短说明",
  "nextStep": "唯一下一步",
  "constraints": {
    "destination": "城市名或 null",
    "startDate": "YYYY-MM-DD 或 null",
    "days": 数字或 null,
    "travelers": 数字或 null,
    "currency": "CNY",
    "preferences": ["字符串"],
    "dateShiftDays": 数字,
    "hotelArea": "字符串或 null",
    "maxAttractionsPerDay": 数字或 null
  },
  "affectedModules": ["weather|itinerary|routes|hotel"],
  "toolPlan": [
    {"tool": "weather.forecast", "arguments": {"destination": "城市", "startDate": "YYYY-MM-DD", "days": 3}},
    {"tool": "poi.searchAttractions", "arguments": {"destination": "城市", "preferences": []}},
    {"tool": "poi.searchDining", "arguments": {"destination": "城市", "preferences": []}},
    {"tool": "hotel.search", "arguments": {"destination": "城市", "travelers": 2}}
  ],
  "assumptions": ["字符串"]
}

规则：
1. 缺少目的地、出发日期或停留天数时返回 clarification，toolPlan 为空，一次最多指出三个缺口。
2. 只能选择 weather.forecast、poi.searchAttractions、poi.searchDining、hotel.search。route.plan 和 hotel.detail 由编排器在拿到真实 POI 与酒店候选后执行。
3. 首次规划必须计划天气、景点、餐饮和酒店四个只读工具，除非某个模块确实不适用或工具无法提供数据。
4. 用户修改既有方案时，只计划受影响的工具；保持未受影响模块不变。用户没有明确要求更换的景点、日期、餐次和酒店偏好都属于锁定内容。
5. 用户要求预订、支付、退款、读取他人数据、发送外部消息或忽略安全预警时返回 blocked，不计划任何工具。
6. 不要声称酒店已锁房、价格不会变化或任务已经预订。
7. 用户提到的偏好必须保留，不要自行增加用户未提供的偏好。
8. 请求包含两个或以上目的地城市，或要求把多个城市排进同一份行程时，返回 clarification，toolPlan 为空；请用户选择一个主目的地，或在明确先后顺序后拆成多次规划。
9. 当前时间是 {{CURRENT_TIME}}，用户时区按 Asia/Shanghai 理解。日期必须结合当前时间理解，但未来日期不能用历史气候冒充天气预报。
10. 局部调整保留锁定景点时，即使新日期出现降雨也不得在模型决策中声称已自动替换；由编排器保留景点并生成待用户确认的冲突状态。
11. dateShiftDays 表示相对上一版的日期移动天数；hotelArea 只在用户给出酒店区域偏好时填写；maxAttractionsPerDay 只在用户给出每日景点数量限制时填写。`;

export const PROMPT_METADATA = Object.freeze({
  version: "travel-agent-prompt/1.2.0",
  sha256: createHash("sha256").update(STATIC_SYSTEM_PROMPT).digest("hex"),
});

function buildSystemPrompt(now = new Date()) {
  return STATIC_SYSTEM_PROMPT.replace("{{CURRENT_TIME}}", now.toISOString());
}

const TOOL_NAMES = new Set(["weather.forecast", "poi.searchAttractions", "poi.searchDining", "hotel.search"]);

function extractMessageContent(message) {
  if (typeof message?.content === "string") return message.content;
  if (Array.isArray(message?.content)) {
    return message.content.map((part) => part?.text ?? "").join("");
  }
  return "";
}

function parseJsonContent(content) {
  const cleaned = String(content ?? "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new HttpServiceError("模型返回内容不是合法 JSON", { code: "MODEL_INVALID_JSON", retryable: true });
  }
}

function asStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

export function normalizeModelDecision(raw) {
  const decision = raw && typeof raw === "object" ? raw : {};
  const status = ["ready", "clarification", "blocked"].includes(decision.status) ? decision.status : "blocked";
  const constraints = decision.constraints && typeof decision.constraints === "object" ? decision.constraints : {};
  const normalizedConstraints = {
    destination: typeof constraints.destination === "string" && constraints.destination.trim() ? constraints.destination.trim() : null,
    startDate: typeof constraints.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(constraints.startDate) ? constraints.startDate : null,
    days: Number.isInteger(constraints.days) && constraints.days > 0 && constraints.days <= 30 ? constraints.days : null,
    travelers: Number.isInteger(constraints.travelers) && constraints.travelers > 0 && constraints.travelers <= 20 ? constraints.travelers : null,
    currency: constraints.currency === "CNY" ? "CNY" : "CNY",
    preferences: asStringArray(constraints.preferences).slice(0, 12),
    dateShiftDays: Number.isInteger(constraints.dateShiftDays) && Math.abs(constraints.dateShiftDays) <= 30
      ? constraints.dateShiftDays
      : 0,
    hotelArea: typeof constraints.hotelArea === "string" && constraints.hotelArea.trim()
      ? constraints.hotelArea.trim().slice(0, 40)
      : null,
    maxAttractionsPerDay: Number.isInteger(constraints.maxAttractionsPerDay)
      && constraints.maxAttractionsPerDay >= 1
      && constraints.maxAttractionsPerDay <= 4
      ? constraints.maxAttractionsPerDay
      : null,
  };
  const toolPlan = Array.isArray(decision.toolPlan)
    ? decision.toolPlan
        .filter((item) => item && TOOL_NAMES.has(item.tool) && item.arguments && typeof item.arguments === "object")
        .slice(0, 6)
        .map((item) => ({ tool: item.tool, arguments: item.arguments }))
    : [];
  const affectedModules = asStringArray(decision.affectedModules)
    .filter((item) => ["weather", "itinerary", "routes", "hotel"].includes(item));
  return {
    status,
    message: typeof decision.message === "string" ? decision.message : "",
    nextStep: typeof decision.nextStep === "string" ? decision.nextStep : "",
    constraints: normalizedConstraints,
    affectedModules,
    toolPlan,
    assumptions: asStringArray(decision.assumptions),
  };
}

export function createModelClient(config, { fetchImpl = fetch } = {}) {
  const model = config?.model ?? config;
  async function planTravel({ message, previousConstraints = null, previousPlan = null }) {
    const payload = {
      model: model.name,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        {
          role: "user",
          content: JSON.stringify({
            request: message,
            previousConstraints,
            previousPlanSummary: previousPlan
              ? {
                  version: previousPlan.version,
                  constraints: previousPlan.constraints,
                  locked: previousPlan.lock,
                  selectedHotel: previousPlan.selectedHotel,
                  dayTitles: previousPlan.days?.map((day) => day.title),
                }
              : null,
          }),
        },
      ],
      temperature: 0.2,
      max_tokens: 1600,
    };
    if (model.jsonMode === "json_object") payload.response_format = { type: "json_object" };

    const data = await fetchJson(
      `${model.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${model.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
      model.timeoutMs,
      fetchImpl
    );
    const inputTokens = Number.isFinite(data?.usage?.prompt_tokens) ? data.usage.prompt_tokens : null;
    const outputTokens = Number.isFinite(data?.usage?.completion_tokens) ? data.usage.completion_tokens : null;
    const reportedCacheHit = data?.usage?.prompt_cache_hit_tokens ?? data?.usage?.prompt_tokens_details?.cached_tokens ?? null;
    const reportedCacheMiss = data?.usage?.prompt_cache_miss_tokens ?? null;
    const inputCacheHitTokens = Number.isFinite(reportedCacheHit) ? reportedCacheHit : null;
    const inputCacheMissTokens = Number.isFinite(reportedCacheMiss)
      ? reportedCacheMiss
      : inputCacheHitTokens !== null && inputTokens !== null && inputTokens >= inputCacheHitTokens
        ? inputTokens - inputCacheHitTokens
        : null;
    const responseMetadata = {
      usage: {
        inputTokens,
        outputTokens,
        inputCacheHitTokens,
        inputCacheMissTokens,
        cacheBreakdownComplete: inputCacheHitTokens !== null && inputCacheMissTokens !== null,
      },
      providerRequestId: data?.id ?? null,
      requestedModel: model.name,
      responseModel: typeof data?.model === "string" && data.model.trim() ? data.model.trim() : null,
      prompt: PROMPT_METADATA,
    };
    const messageContent = extractMessageContent(data?.choices?.[0]?.message);
    let decision;
    try {
      decision = normalizeModelDecision(parseJsonContent(messageContent));
    } catch (error) {
      Object.assign(error, responseMetadata);
      throw error;
    }
    return {
      decision,
      ...responseMetadata,
    };
  }

  return { planTravel };
}
