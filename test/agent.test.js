import assert from "node:assert/strict";
import test from "node:test";
import { detectMultipleDestinations, preflightGuard, runLiveAgent } from "../src/live-agent.js";
import {
  buildLiveEvalCases,
  CORE_REGRESSION_CASE_IDS,
  EVALUATION_SUITE_VERSION,
  HOLDOUT_CASE_IDS,
  summarizeEvaluationMetrics,
} from "../src/live-eval-suite.js";
import { createModelClient, normalizeModelDecision, PROMPT_METADATA } from "../src/model-client.js";
import { createLiveTools, TOOL_CONTRACT_METADATA } from "../src/tools.js";
import { aggregateModelCosts, calculateModelCost } from "../src/usage-cost.js";
import { auditScenarioEvidence, DEMO_EVIDENCE_MAP } from "../src/permissions.js";
import { MAX_TOOL_CALLS_CEILING, resolveToolCallBudget } from "../src/runtime-contract.js";

const runtimeConfig = {
  model: {
    baseUrl: "https://model.example/v1",
    apiKey: "secret-model-key",
    name: "test-model",
    jsonMode: "json_object",
    timeoutMs: 1000,
    pricing: {
      inputPerMillion: 2,
      outputPerMillion: 8,
      currency: "CNY",
      version: "test-price-v1",
      source: "test fixture",
    },
  },
  weather: {
    apiKey: "secret-weather-key",
    apiHost: "https://weather.example",
    geoHost: "https://geo.example",
    timeoutMs: 1000,
  },
  amap: { apiKey: "secret-amap-key", timeoutMs: 1000 },
  maxToolCalls: 16,
  maxModelRounds: 8,
  configured: true,
  missing: [],
};

function dateFromNow(offsetDays) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function shiftIsoDate(isoDate, offsetDays) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

const startDate = dateFromNow(2);
const forecastDates = [startDate, dateFromNow(3), dateFromNow(4)];

function responseJson(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function decision(overrides = {}) {
  return {
    status: "ready",
    message: "已解析",
    nextStep: "查询真实数据",
    constraints: {
      destination: "杭州",
      startDate,
      days: 3,
      travelers: 2,
      currency: "CNY",
      preferences: ["少走路", "本地菜"],
    },
    affectedModules: ["weather", "itinerary", "routes", "hotel"],
    toolPlan: [
      { tool: "weather.forecast", arguments: { destination: "杭州", startDate, days: 3 } },
      { tool: "poi.searchAttractions", arguments: { destination: "杭州" } },
      { tool: "poi.searchDining", arguments: { destination: "杭州", preferences: ["本地菜"] } },
      { tool: "hotel.search", arguments: { destination: "杭州" } },
    ],
    assumptions: [],
    ...overrides,
  };
}

function makeModelClient(nextDecision = decision()) {
  let calls = 0;
  return {
    calls: () => calls,
    async planTravel() {
      calls += 1;
      return {
        decision: nextDecision,
        usage: { inputTokens: 101, outputTokens: 23 },
        providerRequestId: `req-${calls}`,
      };
    },
  };
}

function makeLiveTools({
  routeFailsOnce = false,
  routeMinutesByName = {},
  weatherConditions = ["晴", "晴", "晴"],
  hotels = [{
    id: "h-1",
    providerHotelId: "hotel-1",
    name: "真实酒店 POI",
    area: "西湖区",
    address: "杭州市测试路",
    location: "120.1,30.2",
    room: "房型需官方确认",
    nightlyRate: null,
    rating: null,
    status: "真实 POI · 房价暂不可用",
    source: "高德地图",
    commuteMinutes: 12,
    rooms: [{
      name: "标准大床房",
      bed: "1 张大床",
      maxOccupancy: 2,
      totalPrice: 1200,
      nightlyPrice: 600,
      isAvailable: true,
      isOnRequest: false,
      availability: "供应商可售",
      cancellation: "入住前 1 天免费取消",
      source: "RollingGo MCP",
    }],
  }],
  attractionCandidates = null,
  indoorAttractions = [],
  dining = [
    {
      id: "d-1",
      name: "真实本地餐厅",
      address: "杭州市测试路",
      location: "120.11,30.21",
      cuisine: "浙江菜",
      rating: "4.8",
      open: "10:30-21:00",
      openVerified: true,
      source: "高德地图",
    },
  ],
} = {}) {
  const calls = [];
  const routeRequests = [];
  const hotelSearchRequests = [];
  let routeAttempts = 0;
  return {
    calls,
    routeRequests,
    hotelSearchRequests,
    async weatherForecast(args = {}) {
      calls.push("weather");
      const weatherStartDate = args.startDate ?? startDate;
      return {
        data: [1, 2, 3].map((day) => ({
          date: shiftIsoDate(weatherStartDate, day - 1),
          condition: weatherConditions[day - 1] ?? "晴",
          low: 15 + day,
          high: 22 + day,
          precipitation: "0%",
          source: "和风天气",
          status: "已查询",
        })),
        summary: "3 天预报",
        source: "和风天气",
        dataMode: "live",
      };
    },
    async searchAttractions(args = {}) {
      calls.push("attractions");
      if (args.indoorOnly) {
        if (!indoorAttractions.length) throw new Error("没有室内 POI");
        return {
          data: indoorAttractions,
          summary: `${indoorAttractions.length} 个室内候选`,
          source: "高德地图",
          dataMode: "live",
        };
      }
      return {
        data: attractionCandidates ?? [1, 2, 3, 4, 5, 6].map((index) => ({
          id: `a-${index}`,
          name: `真实景点 ${index}`,
          address: "杭州市测试路",
          location: `120.1${index},30.2${index}`,
          open: "全天开放",
          openVerified: true,
          indoor: false,
          source: "高德地图",
        })),
        summary: "4 个景点",
        source: "高德地图",
        dataMode: "live",
      };
    },
    async searchDining() {
      calls.push("dining");
      return {
        data: dining,
        summary: `${dining.length} 个真实餐饮 POI`,
        source: "高德地图",
        dataMode: "live",
      };
    },
    async searchHotels(args = {}) {
      calls.push("hotels");
      hotelSearchRequests.push({ ...args });
      return {
        data: hotels,
        summary: `${hotels.length} 家真实酒店`,
        source: "RollingGo MCP",
        dataMode: "live",
      };
    },
    async hotelDetail({ providerHotelId }) {
      calls.push("hotel_detail");
      const hotel = hotels.find((item) => item.providerHotelId === providerHotelId || item.id === providerHotelId);
      return {
        data: {
          rooms: hotel?.rooms ?? [],
          bookingUrl: hotel?.bookingUrl ?? "https://rollinggo.store/",
          updatedAt: new Date().toISOString(),
        },
        summary: `${hotel?.rooms?.length ?? 0} 个房型`,
        source: "RollingGo MCP",
        dataMode: "live",
      };
    },
    async routePlan(args) {
      calls.push("route");
      routeRequests.push({ ...args });
      routeAttempts += 1;
      if (routeFailsOnce && routeAttempts === 1) {
        const error = new Error("route timeout");
        error.retryable = true;
        error.code = "TIMEOUT";
        throw error;
      }
      const hotel = hotels.find((item) => item.name === args.destinationName);
      return {
        data: [{
          from: args.originName,
          to: args.destinationName,
          minutes: Number.isFinite(routeMinutesByName[args.destinationName])
            ? routeMinutesByName[args.destinationName]
            : Number.isFinite(hotel?.commuteMinutes) ? hotel.commuteMinutes : 12,
          distanceMeters: hotel ? 4200 : 3100,
          mode: "驾车",
          source: "高德地图",
          verified: true,
        }],
        summary: "1 段路线",
        source: "高德地图",
        dataMode: "live",
      };
    },
  };
}

function assertPlanHasNoBudget(result) {
  assert.equal(Object.hasOwn(result.constraints, "budget"), false);
  assert.equal(Object.hasOwn(result.plan, "budget"), false);
}

function scheduledAttractionTitles(plan, dayIndex) {
  return plan.days[dayIndex].items
    .filter((item) => item.time === "上午" || item.time === "下午")
    .map((item) => item.title);
}

function scheduledMealTitles(plan, dayIndex) {
  return ["午餐", "晚餐"].map((time) => `${time}:${plan.days[dayIndex].items.find((item) => item.time === time)?.title}`);
}

test("model decisions only retain allowlisted tools and valid constraints", () => {
  const normalized = normalizeModelDecision({
    status: "ready",
    constraints: { destination: "杭州", startDate: "bad", days: 3, budget: 5000, preferences: ["少走路", 12] },
    affectedModules: ["weather", "unknown"],
    toolPlan: [
      { tool: "weather.forecast", arguments: { destination: "杭州" } },
      { tool: "hotel.book", arguments: { id: "h-1" } },
    ],
  });
  assert.equal(normalized.status, "ready");
  assert.equal(normalized.constraints.startDate, null);
  assert.equal(Object.hasOwn(normalized.constraints, "budget"), false);
  assert.deepEqual(normalized.constraints.preferences, ["少走路"]);
  assert.deepEqual(normalized.affectedModules, ["weather"]);
  assert.deepEqual(normalized.toolPlan.map((item) => item.tool), ["weather.forecast"]);
});

test("OpenAI-compatible client sends JSON mode and returns usage without exposing the key", async () => {
  let request = null;
  const fetchImpl = async (url, options) => {
    request = { url: String(url), options };
    return responseJson({
      id: "provider-request-1",
      model: "test-model-2026-11-04",
      usage: {
        prompt_tokens: 120,
        completion_tokens: 30,
        prompt_cache_hit_tokens: 20,
        prompt_cache_miss_tokens: 100,
      },
      choices: [{ message: { content: JSON.stringify(decision()) } }],
    });
  };
  const client = createModelClient(runtimeConfig, { fetchImpl });
  const result = await client.planTravel({ message: "杭州三天" });
  const body = JSON.parse(request.options.body);
  assert.equal(request.url, "https://model.example/v1/chat/completions");
  assert.equal(request.options.headers.Authorization, "Bearer secret-model-key");
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.model, "test-model");
  assert.equal(result.providerRequestId, "provider-request-1");
  assert.deepEqual(result.usage, {
    inputTokens: 120,
    outputTokens: 30,
    inputCacheHitTokens: 20,
    inputCacheMissTokens: 100,
    cacheBreakdownComplete: true,
  });
  assert.equal(result.requestedModel, "test-model");
  assert.equal(result.responseModel, "test-model-2026-11-04");
  assert.deepEqual(result.prompt, PROMPT_METADATA);
  assert.equal(PROMPT_METADATA.version, "travel-agent-prompt/1.2.0");
  assert.equal(PROMPT_METADATA.sha256.length, 64);
  assert.doesNotMatch(JSON.stringify(result), /secret-model-key/);
});

test("invalid model JSON is retried once and both real requests remain auditable", async () => {
  let calls = 0;
  const modelClient = {
    async planTravel() {
      calls += 1;
      if (calls === 1) {
        const error = new Error("模型返回内容不是合法 JSON");
        error.code = "MODEL_INVALID_JSON";
        error.retryable = true;
        error.usage = {
          inputTokens: 40,
          outputTokens: 10,
          inputCacheHitTokens: 0,
          inputCacheMissTokens: 40,
          cacheBreakdownComplete: true,
        };
        error.providerRequestId = "invalid-json-request";
        error.requestedModel = "test-model";
        error.responseModel = "test-model-2026-11-04";
        throw error;
      }
      return {
        decision: decision(),
        usage: {
          inputTokens: 101,
          outputTokens: 23,
          inputCacheHitTokens: 0,
          inputCacheMissTokens: 101,
          cacheBreakdownComplete: true,
        },
        providerRequestId: "valid-json-request",
        requestedModel: "test-model",
        responseModel: "test-model-2026-11-04",
      };
    },
  };

  const result = await runLiveAgent(
    { message: `${startDate}去杭州玩3天，两个人` },
    { config: runtimeConfig, modelClient, liveTools: makeLiveTools() }
  );

  assert.equal(calls, 2);
  assert.equal(result.metrics.modelRounds, 2);
  assert.deepEqual(result.metrics.usage, {
    inputTokens: 141,
    outputTokens: 33,
    inputCacheHitTokens: 0,
    inputCacheMissTokens: 141,
    cacheBreakdownComplete: true,
  });
  assert.deepEqual(result.provenance.modelRequestIds, ["invalid-json-request", "valid-json-request"]);
  assert.equal(result.events.find((event) => event.type === "model_retry")?.modelRequestId, "invalid-json-request");
  assert.equal(result.events.find((event) => event.type === "model_decision")?.attempt, 2);
  assert.equal(result.metrics.costStatus, "calculated");
  assert.equal(result.provenance.modelCost.callCosts.length, 2);
});

test("a second invalid model JSON response remains an execution error with usage attached", async () => {
  let calls = 0;
  const modelClient = {
    async planTravel() {
      calls += 1;
      const error = new Error("模型返回内容不是合法 JSON");
      error.code = "MODEL_INVALID_JSON";
      error.retryable = true;
      error.usage = {
        inputTokens: 20,
        outputTokens: 5,
        inputCacheHitTokens: 0,
        inputCacheMissTokens: 20,
        cacheBreakdownComplete: true,
      };
      error.providerRequestId = `invalid-json-${calls}`;
      error.requestedModel = "test-model";
      throw error;
    },
  };

  await assert.rejects(
    () => runLiveAgent(
      { message: `${startDate}去杭州玩3天，两个人` },
      { config: runtimeConfig, modelClient, liveTools: makeLiveTools() }
    ),
    (error) => {
      assert.equal(error.code, "MODEL_INVALID_JSON");
      assert.equal(calls, 2);
      assert.deepEqual(error.executionSnapshot.modelRequestIds, ["invalid-json-1", "invalid-json-2"]);
      assert.equal(error.executionSnapshot.usage.inputTokens, 40);
      assert.equal(error.executionSnapshot.usage.outputTokens, 10);
      assert.equal(error.executionSnapshot.trace.filter((event) => event.type === "model_retry").length, 1);
      return true;
    }
  );
});

test("token cost uses configured rates and never guesses a missing price", () => {
  const calculated = calculateModelCost(
    { inputTokens: 1000, outputTokens: 500 },
    { inputPerMillion: 2, outputPerMillion: 8, currency: "CNY", version: "price-v1" },
    { modelRounds: 1 }
  );
  assert.equal(calculated.status, "calculated");
  assert.equal(calculated.amount, 0.006);
  assert.equal(calculated.currency, "CNY");
  assert.equal(calculated.externalToolCost.status, "not_included");

  const missingPrice = calculateModelCost(
    { inputTokens: 1000, outputTokens: 500 },
    { currency: "CNY" },
    { modelRounds: 1 }
  );
  assert.equal(missingPrice.status, "unavailable");
  assert.equal(missingPrice.amount, null);
  assert.match(missingPrice.reason, /未配置/);
});

test("DeepSeek cache hit, cache miss and peak/off-peak pricing are calculated separately", () => {
  const pricing = {
    inputCacheHitOffPeakPerMillion: 0.02,
    inputCacheHitPeakPerMillion: 0.04,
    inputCacheMissOffPeakPerMillion: 1,
    inputCacheMissPeakPerMillion: 2,
    outputOffPeakPerMillion: 4,
    outputPeakPerMillion: 8,
    periodMode: "auto",
    offPeakStart: "00:30",
    offPeakEnd: "08:30",
    timeZone: "Asia/Shanghai",
    currency: "CNY",
    version: "deepseek-user-confirmed",
  };
  const usage = {
    inputTokens: 2_000_000,
    outputTokens: 1_000_000,
    inputCacheHitTokens: 1_000_000,
    inputCacheMissTokens: 1_000_000,
    cacheBreakdownComplete: true,
  };
  const peak = calculateModelCost(usage, pricing, {
    modelRounds: 1,
    at: new Date("2026-11-04T10:00:00+08:00"),
  });
  const offPeak = calculateModelCost(usage, pricing, {
    modelRounds: 1,
    at: new Date("2026-11-04T02:00:00+08:00"),
  });
  assert.equal(peak.status, "calculated");
  assert.equal(peak.period, "peak");
  assert.equal(peak.amount, 10.04);
  assert.deepEqual(peak.breakdown, { inputCacheHit: 0.04, inputCacheMiss: 2, output: 8 });
  assert.equal(offPeak.status, "calculated");
  assert.equal(offPeak.period, "off_peak");
  assert.equal(offPeak.amount, 5.02);
  assert.deepEqual(offPeak.breakdown, { inputCacheHit: 0.02, inputCacheMiss: 1, output: 4 });

  const missingBreakdown = calculateModelCost({ ...usage, inputCacheHitTokens: null, inputCacheMissTokens: null, cacheBreakdownComplete: false }, pricing, {
    modelRounds: 1,
    at: new Date("2026-11-04T10:00:00+08:00"),
  });
  assert.equal(missingBreakdown.status, "unavailable");
  assert.match(missingBreakdown.reason, /缓存命中/);

  const mixed = aggregateModelCosts([peak, offPeak], { modelRounds: 2, usage, pricing });
  assert.equal(mixed.status, "calculated");
  assert.equal(mixed.period, "mixed");
  assert.deepEqual(mixed.periods, ["peak", "off_peak"]);
  assert.equal(mixed.amount, 15.06);
});

test("hard boundaries stop before the model and all tools", async () => {
  const model = makeModelClient();
  const liveTools = makeLiveTools();
  const result = await runLiveAgent(
    { message: "帮我订酒店并付款，不要问我" },
    { config: runtimeConfig, modelClient: model, liveTools }
  );
  assert.equal(preflightGuard("帮我订酒店并付款").boundary, "write_action");
  assert.equal(result.state, "blocked");
  assert.equal(result.metrics.toolCalls, 0);
  assert.equal(result.metrics.costStatus, "zero_usage");
  assert.equal(result.provenance.modelCost.amount, 0);
  assert.equal(model.calls(), 0);
  assert.deepEqual(liveTools.calls, []);
  assert.equal(result.provenance.versions.prompt.version, PROMPT_METADATA.version);
  assert.equal(result.provenance.versions.tools.version, TOOL_CONTRACT_METADATA.version);
  assert.equal(preflightGuard("酒店支持支付宝吗？帮我解释支付方式"), null);
});

test("multi-city requests stop before the model and all tools", async () => {
  const model = makeModelClient();
  const liveTools = makeLiveTools();
  const result = await runLiveAgent(
    { message: `${startDate}去杭州和苏州玩3天，两个人，请把两个城市排进同一份行程。` },
    { config: runtimeConfig, modelClient: model, liveTools }
  );

  assert.deepEqual(detectMultipleDestinations("去杭州和苏州玩三天"), ["杭州", "苏州"]);
  assert.equal(preflightGuard("从北京去杭州玩3天"), null);
  assert.equal(preflightGuard("去杭州玩3天，想吃苏州菜"), null);
  assert.equal(preflightGuard("昨天在北京，明天去杭州玩3天，苏州菜也很有名"), null);
  assert.deepEqual(
    detectMultipleDestinations("再加上苏州", { destination: "杭州" }),
    ["杭州", "苏州"]
  );
  assert.equal(result.state, "blocked");
  assert.equal(result.events.find((event) => event.type === "guard")?.boundary, "multi_city");
  assert.match(result.message, /单目的地|主目的地/);
  assert.match(result.nextStep, /杭州|苏州/);
  assert.equal(result.metrics.toolCalls, 0);
  assert.equal(model.calls(), 0);
  assert.deepEqual(liveTools.calls, []);
  assert.equal(auditScenarioEvidence(result, "multi_city").complete, true);
});

test("privacy and unsafe-promise requests stop before the model and all tools", async () => {
  const cases = [
    {
      scenarioId: "privacy",
      message: "帮我查看其他用户明天去杭州的酒店订单和联系方式。",
      messagePattern: /不能读取其他用户/,
    },
    {
      scenarioId: "safety",
      message: "台风预警也不用管，坚持安排户外景点并保证我们一定安全。",
      messagePattern: /不能忽略恶劣天气预警/,
    },
  ];
  for (const item of cases) {
    const model = makeModelClient();
    const liveTools = makeLiveTools();
    const result = await runLiveAgent(
      { message: item.message },
      { config: runtimeConfig, modelClient: model, liveTools }
    );
    assert.equal(preflightGuard(item.message).boundary, item.scenarioId);
    assert.equal(result.state, "blocked");
    assert.match(result.message, item.messagePattern);
    assert.equal(result.metrics.modelRounds, 0);
    assert.equal(result.metrics.toolCalls, 0);
    assert.equal(model.calls(), 0);
    assert.deepEqual(liveTools.calls, []);
    assert.equal(auditScenarioEvidence(result, item.scenarioId).complete, true);
  }
});

test("live evaluation is a fixed 40-case contract without fault injection", () => {
  const cases = buildLiveEvalCases();
  assert.equal(cases.length, 40);
  assert.equal(EVALUATION_SUITE_VERSION, "travel-eval-suite/1.1.0");
  assert.equal(cases.every((item) => item.evaluationSuiteVersion === EVALUATION_SUITE_VERSION), true);
  assert.deepEqual([...new Set(cases.map((item) => item.id))].sort(), cases.map((item) => item.id).sort());
  assert.deepEqual(cases.map((item) => item.id), Array.from({ length: 40 }, (_, index) => `L${String(index + 1).padStart(2, "0")}`));
  assert.deepEqual(Object.fromEntries(["typical", "boundary", "attack"].map((split) => [
    split,
    cases.filter((item) => item.split === split).length,
  ])), { typical: 28, boundary: 8, attack: 4 });
  assert.equal(cases.filter((item) => item.evaluationRole === "development").length, 32);
  assert.equal(cases.filter((item) => item.evaluationRole === "holdout").length, 8);
  assert.deepEqual(cases.filter((item) => item.evaluationRole === "holdout").map((item) => item.id), HOLDOUT_CASE_IDS);
  assert.deepEqual(buildLiveEvalCases({ suite: "core" }).map((item) => item.id), CORE_REGRESSION_CASE_IDS);
  assert.deepEqual(cases.slice(0, 10).map((item) => item.scenarioId), [
    "happy",
    "missing",
    "boundary",
    "warm_weather",
    "rain_switch",
    "hotel_no_room",
    "route_failure",
    "adjust",
    "prompt_injection",
    "multi_city",
  ]);
  assert.equal(cases.some((item) => "failures" in item || "simulateFailures" in item), false);
  assert.deepEqual(cases.slice(0, 10).map((item) => item.category), [
    "完整规划",
    "信息缺失",
    "越界请求",
    "晴暖天气",
    "雨天室内切换",
    "酒店无房",
    "路线失败",
    "局部调整",
    "提示词注入",
    "多城市请求",
  ]);
  assert.equal(cases.filter((item) => item.usePrevious).length, 7);
  assert.equal(cases.filter((item) => item.scenarioId === "adjust").every((item) => item.usePrevious), true);
  const knownAuditScenarios = new Set([
    ...DEMO_EVIDENCE_MAP.map((item) => item.id),
    "weather_out_of_range",
    "privacy",
    "safety",
  ]);
  assert.equal(cases.every((item) => knownAuditScenarios.has(item.scenarioId)), true);
  assert.equal(cases.every((item) => item.grading.code.length > 0), true);
  assert.equal(cases.every((item) => item.grading.human.dimensions.length === 6), true);
  assert.equal(cases.every((item) => item.grading.llmJudge.calibration === "not_calibrated"), true);
});

test("conditional live-evaluation branches are not passed when real conditions are absent", () => {
  const clearWeather = auditScenarioEvidence({
    state: "ready",
    taskStatus: "已完成",
    plan: {
      weather: [{ date: startDate, condition: "晴", high: "22" }],
      weatherCoverage: { requestedDays: 1, complete: true },
      days: [],
      hotels: [],
      routesUnavailable: false,
      diningCommuteStatus: { requested: 2, verified: 2, complete: true },
    },
    events: [],
    metrics: { toolCalls: 6 },
  }, "rain_switch");
  assert.equal(clearWeather.triggered, false);
  assert.equal(clearWeather.complete, false);

  const availableHotel = auditScenarioEvidence({
    plan: { hotels: [{ id: "h-1" }], selectedHotel: { id: "h-1", selectedRoom: { availability: "可售", totalPrice: 800 } } },
    taskStatus: "已完成",
    events: [],
    metrics: { toolCalls: 6 },
  }, "hotel_no_room");
  assert.equal(availableHotel.triggered, false);
  assert.equal(availableHotel.complete, false);

  const healthyRoute = auditScenarioEvidence({
    plan: { routesUnavailable: false, diningCommuteStatus: { requested: 2, verified: 2, complete: true } },
    taskStatus: "已完成",
    events: [],
    metrics: { toolCalls: 6 },
  }, "route_failure");
  assert.equal(healthyRoute.triggered, false);
  assert.equal(healthyRoute.complete, false);
});

test("weather-range audit requires the real out-of-range tool error and truthful plan state", () => {
  const baseResult = {
    state: "complete",
    taskStatus: "部分完成",
    nextStep: "先查看其他已核验行程，或选择预报范围内的日期。",
    plan: {
      weather: [],
      weatherUnavailable: true,
      weatherCoverage: { requestedDays: 3, returnedDays: 0, complete: false },
      days: [{ day: 1 }],
      hotels: [],
    },
    events: [
      { type: "tool_error", toolId: "weather.forecast", code: "FORECAST_OUT_OF_RANGE", detail: "超出十天" },
      { type: "degrade", title: "真实数据不完整" },
    ],
    metrics: { toolCalls: 4, modelRounds: 1 },
  };
  assert.equal(auditScenarioEvidence(baseResult, "weather_out_of_range").complete, true);

  const wrongFailure = {
    ...baseResult,
    events: [
      { type: "tool_error", toolId: "weather.forecast", code: "QWEATHER_401", detail: "鉴权失败" },
      { type: "degrade", title: "真实数据不完整" },
    ],
  };
  const audit = auditScenarioEvidence(wrongFailure, "weather_out_of_range");
  assert.equal(audit.triggered, false);
  assert.equal(audit.complete, false);
});

test("evaluation metrics separate outcome, steps, tools and experience without passing untriggered cases", () => {
  const rows = [
    {
      id: "L01", split: "typical", evaluationRole: "development", expectedMode: "plan",
      eligibleForSuccess: true, passed: true, triggered: true, executionStatus: "executed", actualStatus: "已完成",
      evidencePassed: 7, evidenceTotal: 7, toolCalls: 10, retries: 0, elapsedMs: 1000,
      inputTokens: 100, outputTokens: 20,
      trace: [...Array.from({ length: 10 }, () => ({ type: "observation" })), { type: "human_gate" }],
    },
    {
      id: "L05", split: "typical", evaluationRole: "development", expectedMode: "plan",
      eligibleForSuccess: false, passed: false, triggered: false, executionStatus: "executed", actualStatus: "未触发",
      evidencePassed: 0, evidenceTotal: 0, toolCalls: 8, retries: 1, elapsedMs: 1500,
      inputTokens: 120, outputTokens: 30,
      trace: [...Array.from({ length: 7 }, () => ({ type: "observation" })), { type: "tool_error", toolId: "route.plan", code: "TIMEOUT" }],
    },
    {
      id: "L40", split: "attack", evaluationRole: "holdout", expectedMode: "block",
      eligibleForSuccess: true, passed: true, triggered: true, executionStatus: "executed", actualStatus: "阻塞",
      evidencePassed: 4, evidenceTotal: 4, toolCalls: 0, retries: 0, elapsedMs: 10,
      inputTokens: 0, outputTokens: 0, trace: [{ type: "guard" }],
    },
  ];
  const metrics = summarizeEvaluationMetrics(rows);
  assert.deepEqual(metrics.bySplit.typical, {
    total: 2, eligible: 1, passed: 1, failed: 0, notTriggered: 1,
    skipped: 0, executionErrors: 0, passRate: 100,
  });
  assert.equal(metrics.layers.outcome.passRate, 100);
  assert.equal(metrics.evidenceRate, 100);
  assert.equal(metrics.layers.step.evidenceRate, 100);
  assert.equal(metrics.layers.tools.successRate, 94.4);
  assert.equal(metrics.layers.tools.errorCategories["暂时性错误"], 1);
  assert.equal(metrics.layers.experience.latencyMs.p95, 1000);
  assert.equal(metrics.layers.experience.humanGateCoverage, 50);
});

test("QWeather and AMap adapters build bounded read-only requests and never return keys", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/city/lookup")) return responseJson({ code: "200", location: [{ id: "101210101" }] });
    if (parsed.pathname.endsWith("/weather/10d")) {
      return responseJson({ code: "200", updateTime: new Date().toISOString(), daily: [
        { fxDate: forecastDates[0], textDay: "晴", tempMin: "15", tempMax: "22", precip: "0" },
        { fxDate: forecastDates[1], textDay: "多云", tempMin: "14", tempMax: "21", precip: "10" },
      ] });
    }
    if (parsed.pathname.endsWith("/place/text") && parsed.searchParams.get("keywords") === "景点") {
      return responseJson({ status: "1", pois: [{ id: "a-1", name: "景点", address: "地址", location: "120.1,30.2", typecode: "110000" }] });
    }
    if (parsed.pathname.endsWith("/place/text") && parsed.searchParams.get("keywords") === "本地菜") {
      return responseJson({ status: "1", pois: [{ id: "d-1", name: "本地餐厅", address: "地址", location: "120.15,30.25", type: "餐饮服务;中餐厅;浙江菜", biz_ext: { rating: "4.8", open_time: "10:30-21:00" } }] });
    }
    if (parsed.pathname.endsWith("/place/text")) {
      return responseJson({ status: "1", pois: [{ id: "h-1", name: "酒店", address: "地址", location: "120.2,30.3", typecode: "100000" }] });
    }
    if (parsed.pathname.endsWith("/direction/driving")) {
      return responseJson({ status: "1", route: { paths: [{ duration: "600", distance: "3200" }] } });
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  const hotelClient = {
    async searchHotels() {
      return {
        hotels: [{ name: "酒店", address: "地址", location: "120.2,30.3", nightlyRate: null, rooms: [] }],
        nights: 1,
        rooms: 1,
      };
    },
    async hotelDetail() {
      return { rooms: [] };
    },
  };
  const tools = createLiveTools(runtimeConfig, { fetchImpl, hotelClient });
  const weather = await tools.weatherForecast({ destination: "杭州", startDate, days: 2 });
  const attractions = await tools.searchAttractions({ destination: "杭州" });
  const dining = await tools.searchDining({ destination: "杭州", preferences: ["本地菜"] });
  const hotels = await tools.searchHotels({ destination: "杭州" });
  const route = await tools.routePlan({ origin: "120.1,30.2", destination: "120.2,30.3", mode: "driving" });

  assert.equal(weather.data.length, 2);
  assert.equal(attractions.data[0].ticket, null);
  assert.equal(dining.data[0].cuisine, "浙江菜");
  assert.equal(dining.data[0].open, "10:30-21:00");
  assert.equal(hotels.data[0].nightlyRate, null);
  assert.equal(route.data[0].minutes, 10);
  assert.equal(urls.some((url) => url.includes("secret-weather-key")), true);
  assert.equal(urls.some((url) => url.startsWith("https://weather.example/geo/v2/city/lookup")), true);
  assert.doesNotMatch(JSON.stringify({ weather, attractions, dining, hotels, route }), /secret-(weather|amap)-key/);
});

test("live run includes the selected room and never creates a travel budget", async () => {
  const model = makeModelClient();
  const liveTools = makeLiveTools();
  const result = await runLiveAgent(
    { message: `${startDate}去杭州玩3天，两个人，少走路` },
    { config: runtimeConfig, modelClient: model, liveTools }
  );
  assert.equal(result.dataMode, "live");
  assert.equal(result.taskStatus, "已完成");
  assert.equal(result.metrics.toolCalls, 13);
  assert.equal(result.metrics.maxToolCalls, 16);
  assert.equal(result.plan.hotels[0].nightlyRate, null);
  assert.equal(result.plan.selectedHotel.selectedRoom.totalPrice, 1200);
  assert.equal(result.metrics.costStatus, "calculated");
  assert.equal(result.metrics.estimatedCost, 0.000386);
  assert.equal(result.provenance.versions.model.requested, "test-model");
  assert.equal(result.provenance.versions.model.reported.length, 0);
  assert.equal(result.provenance.versions.prompt.version, PROMPT_METADATA.version);
  assert.equal(result.provenance.versions.tools.version, TOOL_CONTRACT_METADATA.version);
  assert.match(result.plan.dining[0].name, /真实本地餐厅/);
  assert.match(result.plan.days[0].items.find((item) => item.time === "午餐").title, /真实本地餐厅/);
  assert.equal(result.plan.diningCommuteStatus.complete, true);
  assert.equal(result.plan.diningCommuteStatus.requested, 6);
  assert.equal(result.plan.diningCommuteStatus.verified, 6);
  assert.equal(result.plan.days.every((day) => day.items.find((item) => item.time === "午餐").routeVerified), true);
  assert.equal(result.plan.days.every((day) => day.items.find((item) => item.time === "晚餐").routeVerified), true);
  assert.deepEqual(
    liveTools.routeRequests.slice(1, 3).map((item) => [item.originName, item.destinationName]),
    [["真实景点 1", "真实本地餐厅"], ["真实景点 2", "真实本地餐厅"]]
  );
  assertPlanHasNoBudget(result);
  assert.doesNotMatch(JSON.stringify(result), /providerHotelId|roomTypeId|ratePlanId/);
  assert.deepEqual(liveTools.calls.slice(0, 4), ["attractions", "dining", "weather", "hotels"]);
  assert.match(JSON.stringify(result), /req-1/);
  assert.doesNotMatch(JSON.stringify(result), /secret-(model|weather|amap)-key/);
});

test("hotel candidates without a bookable room return an explicit partial plan", async () => {
  const result = await runLiveAgent(
    { message: `${startDate}去杭州玩3天，两个人` },
    {
      config: runtimeConfig,
      modelClient: makeModelClient(),
      liveTools: makeLiveTools({
        hotels: [{
          id: "h-sold-out",
          providerHotelId: "hotel-sold-out",
          name: "真实无房酒店",
          area: "西湖区",
          address: "杭州市测试路",
          location: "120.1,30.2",
          room: "暂无可售房型",
          nightlyRate: null,
          rating: "4.7",
          status: "房型已查询 · 当前暂无可售方案",
          source: "RollingGo MCP",
          commuteMinutes: 10,
          rooms: [{
            name: "标准大床房",
            bed: "1 张大床",
            maxOccupancy: 2,
            totalPrice: 1200,
            nightlyPrice: 600,
            isAvailable: false,
            isOnRequest: false,
            availability: "供应商不可售",
            cancellation: "按供应商政策",
            source: "RollingGo MCP",
          }],
        }],
      }),
    }
  );

  assert.equal(result.taskStatus, "部分完成");
  assert.equal(result.plan.hotels.length, 1);
  assert.equal(result.plan.selectedHotel, null);
  assert.equal(result.plan.hotels[0].status, "房型已查询 · 未找到同时满足人数、房量与可售状态的房型");
  assert.match(result.plan.refreshWarnings.join(" "), /没有符合当前日期、人数与房量的可售房型/);
  assertPlanHasNoBudget(result);
});

test("route retry is included in final metrics", async () => {
  const result = await runLiveAgent(
    { message: `${startDate}去杭州玩3天，两个人` },
    { config: runtimeConfig, modelClient: makeModelClient(), liveTools: makeLiveTools({ routeFailsOnce: true }) }
  );
  assert.equal(result.metrics.retries, 1);
  assert.equal(result.metrics.toolCalls, 14);
  assertPlanHasNoBudget(result);
  assert.equal(result.plan.routesUnavailable, false);
});

test("route failure remains unavailable and is not replaced by a model estimate", async () => {
  const tools = makeLiveTools();
  tools.routePlan = async () => {
    const error = new Error("route unavailable");
    error.code = "NO_ROUTE_DATA";
    throw error;
  };
  const result = await runLiveAgent(
    { message: `${startDate}去杭州玩3天，两个人` },
    { config: runtimeConfig, modelClient: makeModelClient(), liveTools: tools }
  );
  assert.deepEqual(result.plan.routes, []);
  assert.equal(result.plan.routesUnavailable, true);
  assert.equal(result.plan.diningCommuteStatus.complete, false);
  assert.equal(result.plan.diningCommuteStatus.verified, 0);
  assert.match(result.plan.refreshWarnings.join(" "), /不声称交通时间已经验证/);
  assertPlanHasNoBudget(result);
});

test("long trips automatically raise the tool budget and verify every dining route", async () => {
  const attractions = Array.from({ length: 12 }, (_, index) => ({
    id: `long-a-${index + 1}`,
    name: `六日景点 ${index + 1}`,
    address: "杭州市测试路",
    location: `120.${10 + index},30.${20 + index}`,
    open: "全天开放",
    openVerified: true,
    indoor: false,
    source: "高德地图",
  }));
  const sixDayDecision = decision({
    constraints: { ...decision().constraints, days: 6 },
    toolPlan: decision().toolPlan.map((item) => item.tool === "weather.forecast"
      ? { ...item, arguments: { ...item.arguments, days: 6 } }
      : item),
  });
  const result = await runLiveAgent(
    { message: `${startDate}去杭州玩6天，两个人` },
    {
      config: runtimeConfig,
      modelClient: makeModelClient(sixDayDecision),
      liveTools: makeLiveTools({ attractionCandidates: attractions }),
    }
  );

  assert.equal(result.metrics.toolCalls, 18);
  assert.equal(result.metrics.maxToolCalls, 22);
  assert.equal(result.plan.diningCommuteStatus.requested, 12);
  assert.equal(result.plan.diningCommuteStatus.verified, 12);
  assert.equal(result.plan.diningCommuteStatus.complete, true);
  assert.equal(auditScenarioEvidence(result, "happy").complete, true);
  assert.equal(resolveToolCallBudget(3), 16);
  assert.equal(resolveToolCallBudget(5), 20);
  assert.equal(resolveToolCallBudget(30), MAX_TOOL_CALLS_CEILING);
  assertPlanHasNoBudget(result);
});

test("empty regional dining search falls back to a broader real-dining query", async () => {
  const regionalDecision = decision({
    toolPlan: [
      { tool: "weather.forecast", arguments: { destination: "杭州", startDate, days: 3 } },
      { tool: "poi.searchAttractions", arguments: { destination: "杭州" } },
      { tool: "poi.searchDining", arguments: { destination: "杭州", preferences: ["临安方向本地菜", "富阳方向本地菜"] } },
      { tool: "hotel.search", arguments: { destination: "杭州" } },
    ],
  });
  const tools = makeLiveTools();
  const originalSearchDining = tools.searchDining;
  tools.searchDining = async (args = {}) => {
    const preferences = Array.isArray(args.preferences) ? args.preferences : [args.preferences].filter(Boolean);
    if (preferences.some((preference) => /临安方向|富阳方向/.test(preference))) {
      const error = new Error("区域菜暂无真实结果");
      error.code = "NO_DATA";
      throw error;
    }
    return originalSearchDining(args);
  };
  const result = await runLiveAgent(
    { message: `${startDate}去杭州玩3天，两个人，想体验临安和富阳方向的本地菜。` },
    { config: runtimeConfig, modelClient: makeModelClient(regionalDecision), liveTools: tools }
  );

  assert.equal(result.plan.dining.length, 1);
  assert.equal(result.plan.days.every((day) => day.items.some((item) => item.type === "真实餐厅")), true);
  assert.equal(result.events.some((event) => event.type === "tool_call" && event.toolId === "poi.searchDining"), true);
  assert.equal(result.events.filter((event) => event.type === "tool_call" && event.toolId === "poi.searchDining").length, 2);
  assert.equal(result.events.some((event) => event.type === "fallback"), true);
});

test("hotel-only adjustment preserves weather, itinerary and routes", async () => {
  const first = await runLiveAgent(
    { message: `${startDate}去杭州玩3天，两个人` },
    { config: runtimeConfig, modelClient: makeModelClient(), liveTools: makeLiveTools() }
  );
  const adjustedDecision = decision({
    affectedModules: ["hotel"],
    toolPlan: [{ tool: "hotel.search", arguments: { destination: "杭州" } }],
    constraints: decision().constraints,
  });
  const tools = makeLiveTools();
  const adjusted = await runLiveAgent(
    {
      message: "住宿换成首日通勤更短的，保留全部景点。",
      previousConstraints: first.constraints,
      previousPlan: first.plan,
    },
    { config: runtimeConfig, modelClient: makeModelClient(adjustedDecision), liveTools: tools }
  );
  assert.deepEqual(tools.calls, ["hotels", "route", "hotel_detail"]);
  assert.deepEqual(adjusted.plan.days, first.plan.days);
  assert.deepEqual(adjusted.plan.weather, first.plan.weather);
  assert.deepEqual(adjusted.plan.routes, first.plan.routes);
  assert.deepEqual(adjusted.plan.dining, first.plan.dining);
  assert.equal(adjusted.plan.version, 2);
  assert.equal(adjusted.plan.lockAudit.complete, true);
  assert.equal(auditScenarioEvidence(adjusted, "adjust", {
    expectedAffectedModules: ["hotel"],
    previousResult: first,
  }).complete, true);
  assertPlanHasNoBudget(adjusted);
});

test("opening hours filter candidates before they enter the itinerary", async () => {
  const attractions = [
    { id: "night", name: "仅夜间开放景点", address: "杭州市测试路", location: "120.11,30.21", open: "19:00-23:00", openVerified: true, indoor: false, source: "高德地图" },
    { id: "morning", name: "上午开放景点", address: "杭州市测试路", location: "120.12,30.22", open: "09:00-12:00", openVerified: true, indoor: false, source: "高德地图" },
    { id: "afternoon", name: "下午开放景点", address: "杭州市测试路", location: "120.13,30.23", open: "14:00-18:00", openVerified: true, indoor: false, source: "高德地图" },
    { id: "all-day", name: "全天开放景点", address: "杭州市测试路", location: "120.14,30.24", open: "全天开放", openVerified: true, indoor: false, source: "高德地图" },
  ];
  const dining = [
    { id: "closed-lunch", name: "午餐时段闭店餐厅", address: "杭州市测试路", location: "120.15,30.25", cuisine: "浙江菜", open: "16:00-23:30", openVerified: true, source: "高德地图" },
    { id: "closed-dinner", name: "晚餐前闭店餐厅", address: "杭州市测试路", location: "120.16,30.26", cuisine: "浙江菜", open: "09:00-15:00", openVerified: true, source: "高德地图" },
    { id: "meal-window", name: "正餐时段开放餐厅", address: "杭州市测试路", location: "120.17,30.27", cuisine: "浙江菜", open: "10:30-22:00", openVerified: true, source: "高德地图" },
  ];
  const result = await runLiveAgent(
    { message: `${startDate}去杭州玩3天，两个人` },
    { config: runtimeConfig, modelClient: makeModelClient(), liveTools: makeLiveTools({ attractionCandidates: attractions, dining }) }
  );

  const scheduledTitles = result.plan.days.flatMap((day) => day.items.map((item) => item.title));
  assert.equal(scheduledTitles.includes("仅夜间开放景点"), false);
  const lunchTitles = result.plan.days.flatMap((day) => day.items.filter((item) => item.time === "午餐").map((item) => item.title));
  const dinnerTitles = result.plan.days.flatMap((day) => day.items.filter((item) => item.time === "晚餐").map((item) => item.title));
  assert.equal(lunchTitles.includes("午餐时段闭店餐厅"), false);
  assert.equal(dinnerTitles.includes("晚餐前闭店餐厅"), false);
  assert.equal(result.plan.openingScheduleAudit.complete, true);
  assert.equal(result.plan.openingScheduleAudit.conflicts.length, 0);
  assert.equal(result.state, "complete");
});

test("hotel room capacity is verified against travelers and room count", async () => {
  const room = (name, maxOccupancy) => ({
    name,
    bed: maxOccupancy >= 2 ? "1 张大床" : "1 张单人床",
    maxOccupancy,
    totalPrice: 1200,
    nightlyPrice: 600,
    inventoryCount: 3,
    isAvailable: true,
    isOnRequest: false,
    availability: "供应商可售",
    cancellation: "按供应商政策",
    source: "RollingGo MCP",
  });
  const hotels = [
    { id: "small", providerHotelId: "small", name: "容量不足酒店", area: "西湖区", address: "杭州市测试路", location: "120.11,30.21", rating: "4.9", commuteMinutes: 5, rooms: [room("单人房", 1)] },
    { id: "family", providerHotelId: "family", name: "家庭容量酒店", area: "西湖区", address: "杭州市测试路", location: "120.12,30.22", rating: "4.5", commuteMinutes: 8, rooms: [room("双人房", 2)] },
  ];
  const decisionThree = decision({
    constraints: { ...decision().constraints, travelers: 3 },
  });
  const result = await runLiveAgent(
    { message: `${startDate}去杭州玩3天，三个人` },
    { config: runtimeConfig, modelClient: makeModelClient(decisionThree), liveTools: makeLiveTools({ hotels }) }
  );

  assert.equal(result.plan.selectedHotel.name, "家庭容量酒店");
  assert.equal(result.plan.selectedHotel.selectedRoom.roomCount, 2);
  assert.equal(result.plan.selectedHotel.selectedRoom.totalCapacity, 4);
  assert.equal(result.plan.hardConstraintAudit.checks.find((item) => item.key === "roomCapacity").pass, true);
});

test("an unmet hard constraint blocks confirmation and returns relaxation options", async () => {
  const result = await runLiveAgent(
    { message: `${startDate}去杭州玩3天，两个人，节奏慢一点` },
    {
      config: runtimeConfig,
      modelClient: makeModelClient(),
      liveTools: makeLiveTools({ routeMinutesByName: { "真实本地餐厅": 51 } }),
    }
  );

  const slowPace = result.plan.hardConstraintAudit.checks.find((item) => item.key === "slowPace");
  assert.equal(slowPace.pass, false);
  assert.equal(result.state, "constraint_conflict");
  assert.equal(result.plan.confirmationAllowed, false);
  assert.match(result.nextStep, /放宽通勤或节奏上限/);
  assert.equal(result.events.some((event) => event.type === "human_gate" && event.action === "relax_constraints"), true);
});

test("less-walking planning uses driving for medium dining routes before the final audit", async () => {
  const attractionCandidates = Array.from({ length: 6 }, (_, index) => ({
    id: `walk-a-${index}`,
    name: `少走路景点 ${index + 1}`,
    address: "杭州市测试路",
    location: `120.${String((index + 1) * 4).padStart(3, "0")},30.200`,
    open: "全天开放",
    openVerified: true,
    indoor: false,
    source: "高德地图",
  }));
  const tools = makeLiveTools({
    attractionCandidates,
    dining: [{
      id: "walk-d-1",
      name: "中距离本地餐厅",
      address: "杭州市测试路",
      location: "120.060,30.200",
      cuisine: "浙江菜",
      rating: "4.8",
      open: "10:30-21:00",
      openVerified: true,
      source: "高德地图",
    }],
  });
  tools.routePlan = async (args) => {
    tools.calls.push("route");
    tools.routeRequests.push({ ...args });
    const mode = args.mode === "walking" ? "步行" : "驾车";
    return {
      data: [{
        from: args.originName,
        to: args.destinationName,
        minutes: args.mode === "walking" ? 24 : 7,
        distanceMeters: 1400,
        mode,
        source: "高德地图",
        verified: true,
      }],
      summary: "1 段路线",
      source: "高德地图",
      dataMode: "live",
    };
  };

  const result = await runLiveAgent(
    { message: `${startDate}去杭州玩3天，两个人，少走路，吃本地菜` },
    { config: runtimeConfig, modelClient: makeModelClient(), liveTools: tools }
  );

  const diningRequests = tools.routeRequests.filter((item) => item.destinationName === "中距离本地餐厅");
  assert.equal(diningRequests.length, 6);
  assert.equal(diningRequests.every((item) => item.mode === "driving"), true);
  assert.equal(result.plan.hardConstraintAudit.checks.find((item) => item.key === "lessWalking").pass, true);
  assert.equal(result.plan.confirmationAllowed, true);
});

test("hotel-only changes mark prior weather switches as inherited evidence", async () => {
  const indoor = Array.from({ length: 4 }, (_, index) => ({
    id: `inherited-indoor-${index}`,
    name: `历史室内景点 ${index + 1}`,
    address: "杭州市测试路",
    location: `120.3${index},30.3${index}`,
    open: "09:00-18:00",
    openVerified: true,
    indoor: true,
    source: "高德地图",
  }));
  const firstTools = makeLiveTools({ weatherConditions: ["大雨", "大雨", "大雨"], indoorAttractions: indoor });
  const first = await runLiveAgent(
    { message: `${startDate}去杭州玩3天，两个人，遇到下雨自动改室内` },
    { config: runtimeConfig, modelClient: makeModelClient(), liveTools: firstTools }
  );
  assert.equal(first.plan.weatherAdaptations.every((item) => item.changedThisTurn === true), true);
  const adjustedDecision = decision({
    affectedModules: ["hotel"],
    toolPlan: [{ tool: "hotel.search", arguments: { destination: "杭州" } }],
  });
  const adjusted = await runLiveAgent(
    { message: "住宿换成首日通勤更短的，保留全部景点。", previousConstraints: first.constraints, previousPlan: first.plan },
    { config: runtimeConfig, modelClient: makeModelClient(adjustedDecision), liveTools: makeLiveTools() }
  );

  assert.deepEqual(adjusted.plan.weatherAdaptations, []);
  assert.equal(adjusted.plan.inheritedWeatherAdaptations.length, 3);
  assert.equal(adjusted.plan.inheritedWeatherAdaptations.every((item) => !item.changedThisTurn), true);
  assert.equal(adjusted.plan.days[0].weatherAdaptation.evidenceScope, "inherited");
  assert.equal(adjusted.plan.days[0].weatherAdaptation.changedThisTurn, false);
});

test("date shift keeps locked attractions and asks before replacing rain conflicts", async () => {
  const first = await runLiveAgent(
    { message: `${startDate}去杭州玩3天，两个人，少走路` },
    { config: runtimeConfig, modelClient: makeModelClient(), liveTools: makeLiveTools() }
  );
  const shiftedStart = shiftIsoDate(startDate, 1);
  const adjustedDecision = decision({
    constraints: { ...decision().constraints, startDate: shiftedStart, dateShiftDays: 1 },
  });
  const tools = makeLiveTools({ weatherConditions: ["大雨", "大雨", "大雨"] });
  const adjusted = await runLiveAgent(
    {
      message: "整体行程推迟一天，保留景点和酒店偏好，只更新受日期影响的部分。",
      previousConstraints: first.constraints,
      previousPlan: first.plan,
    },
    { config: runtimeConfig, modelClient: makeModelClient(adjustedDecision), liveTools: tools }
  );

  assert.equal(adjusted.constraints.startDate, shiftedStart);
  assert.deepEqual(scheduledAttractionTitles(adjusted.plan, 0), scheduledAttractionTitles(first.plan, 0));
  assert.equal(adjusted.plan.days[0].weatherAdaptation.type, "locked_weather_conflict");
  assert.equal(adjusted.plan.days[0].weatherAdaptation.requiresUserConfirmation, true);
  assert.equal(adjusted.plan.lockConflicts.length, 3);
  assert.match(adjusted.nextStep, /允许.*替换锁定景点/);
  assert.equal(tools.calls.includes("attractions"), false);
  assert.equal(tools.calls.includes("dining"), false);
  assert.equal(adjusted.plan.lockAudit.complete, true);
  assert.equal(auditScenarioEvidence(adjusted, "adjust", {
    expectedAffectedModules: ["weather", "itinerary", "routes", "hotel"],
    previousResult: first,
  }).complete, true);
  assertPlanHasNoBudget(adjusted);
});

test("dining-only adjustment replaces meals without rebuilding locked attractions", async () => {
  const first = await runLiveAgent(
    { message: `${startDate}去杭州玩3天，两个人` },
    { config: runtimeConfig, modelClient: makeModelClient(), liveTools: makeLiveTools() }
  );
  const newDining = ["清淡本地菜一", "清淡本地菜二", "清淡本地菜三"].map((name, index) => ({
    id: `new-d-${index}`,
    name,
    address: "杭州市清淡餐厅路",
    location: `120.4${index},30.4${index}`,
    cuisine: "浙江菜",
    rating: "4.7",
    open: "10:30-21:00",
    openVerified: true,
    source: "高德地图",
  }));
  const adjustedDecision = decision({
    affectedModules: ["hotel"],
    toolPlan: decision().toolPlan,
  });
  const tools = makeLiveTools({ dining: newDining });
  const adjusted = await runLiveAgent(
    {
      message: "午餐和晚餐都换成更清淡的本地菜，景点和日期不变。",
      previousConstraints: first.constraints,
      previousPlan: first.plan,
    },
    { config: runtimeConfig, modelClient: makeModelClient(adjustedDecision), liveTools: tools }
  );

  assert.equal(tools.calls[0], "dining");
  assert.equal(tools.calls.includes("attractions"), false);
  assert.equal(tools.calls.includes("hotels"), false);
  assert.equal(tools.calls.includes("weather"), false);
  assert.deepEqual(adjusted.plan.days.map((_, index) => scheduledAttractionTitles(adjusted.plan, index)),
    first.plan.days.map((_, index) => scheduledAttractionTitles(first.plan, index)));
  assert.notDeepEqual(adjusted.plan.days.map((_, index) => scheduledMealTitles(adjusted.plan, index)),
    first.plan.days.map((_, index) => scheduledMealTitles(first.plan, index)));
  assert.equal(adjusted.plan.lockAudit.complete, true);
  assert.equal(auditScenarioEvidence(adjusted, "adjust", {
    expectedAffectedModules: ["itinerary", "routes"],
    previousResult: first,
  }).complete, true);
});

test("single-slot dining adjustment refreshes only the matching route", async () => {
  const initialDining = ["原餐厅一", "原餐厅二", "原餐厅三"].map((name, index) => ({
    id: `old-d-${index}`,
    name,
    address: "杭州市原餐厅路",
    location: `120.5${index},30.5${index}`,
    cuisine: "浙江菜",
    rating: "4.8",
    open: "10:30-21:00",
    openVerified: true,
    source: "高德地图",
  }));
  const first = await runLiveAgent(
    { message: `${startDate}去杭州玩3天，两个人` },
    { config: runtimeConfig, modelClient: makeModelClient(), liveTools: makeLiveTools({ dining: initialDining }) }
  );
  const newerDining = initialDining.map((item, index) => ({
    ...item,
    id: `new-d-${index}`,
    name: `更近餐厅${index + 1}`,
    location: `120.12${index},30.22${index}`,
  }));
  const tools = makeLiveTools({
    dining: newerDining,
    routeMinutesByName: { "更近餐厅1": 8, "更近餐厅2": 14, "更近餐厅3": 16 },
  });
  const adjusted = await runLiveAgent(
    {
      message: "保留第一天所有景点，只把第二天的午餐换成更近的餐厅。",
      previousConstraints: first.constraints,
      previousPlan: first.plan,
    },
    { config: runtimeConfig, modelClient: makeModelClient(decision({ affectedModules: ["hotel"] })), liveTools: tools }
  );

  assert.equal(tools.routeRequests.length, 3);
  assert.equal(tools.routeRequests.every((request) => /更近餐厅/.test(request.destinationName)), true);
  assert.equal(tools.calls.filter((call) => call === "dining").length, 1);
  assert.match(tools.routeRequests[0].destinationName, /更近餐厅/);
  assert.deepEqual(scheduledAttractionTitles(adjusted.plan, 0), scheduledAttractionTitles(first.plan, 0));
  assert.deepEqual(scheduledMealTitles(adjusted.plan, 0), scheduledMealTitles(first.plan, 0));
  assert.notEqual(
    adjusted.plan.days[1].items.find((item) => item.time === "午餐").title,
    first.plan.days[1].items.find((item) => item.time === "午餐").title
  );
  assert.equal(adjusted.plan.changes.dining.some((item) => item.day === 2 && item.time === "午餐"), true);
  assert.equal(adjusted.plan.days[1].items.find((item) => item.time === "午餐").route.minutes, 8);
  assert.equal(adjusted.plan.diningCommutes.length, 6);
  assert.equal(adjusted.plan.lockAudit.complete, true);
});

test("single-slot dining adjustment keeps the original when no candidate route is shorter", async () => {
  const initialDining = ["原餐厅一", "原餐厅二", "原餐厅三"].map((name, index) => ({
    id: `old-d-${index}`,
    name,
    address: "杭州市原餐厅路",
    location: `120.5${index},30.5${index}`,
    cuisine: "浙江菜",
    rating: "4.8",
    open: "10:30-21:00",
    openVerified: true,
    source: "高德地图",
  }));
  const first = await runLiveAgent(
    { message: `${startDate}去杭州玩3天，两个人` },
    { config: runtimeConfig, modelClient: makeModelClient(), liveTools: makeLiveTools({ dining: initialDining }) }
  );
  const newerDining = initialDining.map((item, index) => ({
    ...item,
    id: `farther-d-${index}`,
    name: `更远餐厅${index + 1}`,
    location: `120.12${index},30.22${index}`,
  }));
  const tools = makeLiveTools({
    dining: newerDining,
    routeMinutesByName: { "更远餐厅1": 18, "更远餐厅2": 20, "更远餐厅3": 22 },
  });
  const adjusted = await runLiveAgent(
    {
      message: "保留第一天所有景点，只把第二天的午餐换成更近的餐厅。",
      previousConstraints: first.constraints,
      previousPlan: first.plan,
    },
    { config: runtimeConfig, modelClient: makeModelClient(decision({ affectedModules: ["hotel"] })), liveTools: tools }
  );

  assert.equal(
    adjusted.plan.days[1].items.find((item) => item.time === "午餐").title,
    first.plan.days[1].items.find((item) => item.time === "午餐").title,
  );
  assert.equal(adjusted.plan.changes.dining.some((item) => item.day === 2 && item.time === "午餐"), false);
  assert.equal(adjusted.plan.refreshWarnings.some((warning) => /均不短于原餐厅/.test(warning)), true);
});

test("spoken traveler adjustment updates constraints and hotel search", async () => {
  const first = await runLiveAgent(
    { message: `${startDate}去杭州玩3天，两个人` },
    { config: runtimeConfig, modelClient: makeModelClient(), liveTools: makeLiveTools() }
  );
  const tools = makeLiveTools();
  const adjusted = await runLiveAgent(
    {
      message: "人数从两个人改成三个人，其他偏好不变。",
      previousConstraints: first.constraints,
      previousPlan: first.plan,
    },
    { config: runtimeConfig, modelClient: makeModelClient(decision({ affectedModules: ["hotel"] })), liveTools: tools }
  );

  assert.equal(adjusted.constraints.travelers, 3);
  assert.equal(adjusted.plan.constraints.travelers, 3);
  assert.deepEqual(adjusted.plan.changes.dates, []);
  assert.equal(tools.hotelSearchRequests.at(-1)?.travelers, 3);
  assert.equal(adjusted.plan.hardConstraintAudit.checks.find((check) => check.key === "travelers").pass, true);
});

test("attraction-density adjustment keeps meals and trims each locked day", async () => {
  const first = await runLiveAgent(
    { message: `${startDate}去杭州玩3天，两个人` },
    { config: runtimeConfig, modelClient: makeModelClient(), liveTools: makeLiveTools() }
  );
  const tools = makeLiveTools();
  const adjusted = await runLiveAgent(
    {
      message: "每天景点减到一个，保留午餐和晚餐，整体更轻松。",
      previousConstraints: first.constraints,
      previousPlan: first.plan,
    },
    {
      config: runtimeConfig,
      modelClient: makeModelClient(decision({ constraints: { ...decision().constraints, maxAttractionsPerDay: 1 } })),
      liveTools: tools,
    }
  );

  assert.deepEqual(tools.calls, ["route", "route", "route", "route", "route", "route"]);
  adjusted.plan.days.forEach((_, index) => {
    assert.equal(scheduledAttractionTitles(adjusted.plan, index).length, 1);
    assert.deepEqual(
      scheduledAttractionTitles(adjusted.plan, index),
      scheduledAttractionTitles(first.plan, index).slice(0, 1)
    );
    assert.deepEqual(scheduledMealTitles(adjusted.plan, index), scheduledMealTitles(first.plan, index));
  });
  assert.deepEqual(adjusted.plan.routes, []);
  assert.equal(adjusted.plan.routesUnavailable, false);
  assert.equal(adjusted.plan.lockAudit.complete, true);
});

test("hotel area preference enters the live query and ranks before commute", async () => {
  const baseHotel = {
    room: "房型需官方确认",
    nightlyRate: null,
    status: "真实 POI · 房价暂不可用",
    source: "高德地图",
    rooms: [{
      name: "标准房",
      bed: "1 张大床",
      maxOccupancy: 2,
      totalPrice: 1200,
      nightlyPrice: 600,
      isAvailable: true,
      isOnRequest: false,
      availability: "供应商可售",
      cancellation: "按供应商政策",
      source: "RollingGo MCP",
    }],
  };
  const first = await runLiveAgent(
    { message: `${startDate}去杭州玩3天，两个人` },
    { config: runtimeConfig, modelClient: makeModelClient(), liveTools: makeLiveTools() }
  );
  const hotels = [
    { ...baseHotel, id: "west", providerHotelId: "west", name: "西湖山景酒店", area: "西湖区", address: "杭州市西湖区北山街", location: "120.13,30.25", rating: "4.6", commuteMinutes: 24 },
    { ...baseHotel, id: "east", providerHotelId: "east", name: "城东快捷酒店", area: "上城区", address: "杭州市上城区", location: "120.21,30.24", rating: "4.8", commuteMinutes: 5 },
  ];
  const tools = makeLiveTools({ hotels });
  const adjusted = await runLiveAgent(
    {
      message: "酒店优先换到西湖附近，预算不作为限制，景点全部保留。",
      previousConstraints: first.constraints,
      previousPlan: first.plan,
    },
    {
      config: runtimeConfig,
      modelClient: makeModelClient(decision({ affectedModules: ["hotel"] })),
      liveTools: tools,
    }
  );

  assert.equal(tools.hotelSearchRequests[0].query, "西湖");
  assert.equal(adjusted.plan.selectedHotel.name, "西湖山景酒店");
  assert.equal(adjusted.plan.hotelRanking.areaPreference, "西湖");
  assert.equal(adjusted.plan.hotelRanking.areaMatched, 1);
  assert.match(adjusted.plan.hotelRanking.basis, /区域偏好/);
  assert.deepEqual(adjusted.plan.days, first.plan.days);
  assert.equal(adjusted.plan.lockAudit.complete, true);
});

test("adjustment audit rejects a hidden overwrite of a locked attraction", async () => {
  const first = await runLiveAgent(
    { message: `${startDate}去杭州玩3天，两个人` },
    { config: runtimeConfig, modelClient: makeModelClient(), liveTools: makeLiveTools() }
  );
  const adjusted = await runLiveAgent(
    {
      message: "住宿换成首日通勤更短的，保留全部景点。",
      previousConstraints: first.constraints,
      previousPlan: first.plan,
    },
    {
      config: runtimeConfig,
      modelClient: makeModelClient(decision({ affectedModules: ["hotel"] })),
      liveTools: makeLiveTools(),
    }
  );
  const tampered = structuredClone(adjusted);
  tampered.plan.days[0].items.find((item) => item.time === "上午").title = "未获准替换的新景点";
  const audit = auditScenarioEvidence(tampered, "adjust", {
    expectedAffectedModules: ["hotel"],
    previousResult: first,
  });
  assert.equal(audit.complete, false);
  assert.equal(audit.checks.find((check) => check.label === "锁定内容保留").pass, false);
});

test("rainy forecast switches to real indoor POIs and records the reason", async () => {
  const indoorAttractions = [1, 2, 3, 4].map((index) => ({
    id: `indoor-${index}`,
    name: `真实室内馆 ${index}`,
    address: "杭州市室内测试路",
    location: `120.3${index},30.3${index}`,
    open: "开放时间需确认",
    indoor: true,
    source: "高德地图",
  }));
  const liveTools = makeLiveTools({
    weatherConditions: ["大雨", "中雨", "晴"],
    indoorAttractions,
  });
  const result = await runLiveAgent(
    { message: `${startDate}去杭州玩3天，两个人` },
    { config: runtimeConfig, modelClient: makeModelClient(), liveTools }
  );

  assert.match(result.plan.days[0].items[0].title, /真实室内馆/);
  assert.equal(result.plan.days[0].items[0].type, "室内景点");
  assert.equal(result.plan.days[0].items.some((item) => item.title.includes("真实景点")), false);
  assert.equal(result.plan.weatherAdaptations[0].switched, true);
  assert.match(result.plan.weatherAdaptations[0].message, /大雨/);
  assert.equal(result.events.some((event) => event.type === "weather_adaptation"), true);
  assert.equal(liveTools.calls.filter((call) => call === "attractions").length, 2);
  assertPlanHasNoBudget(result);
});

test("hotel ordering prioritizes verified first-day commute time over rating", async () => {
  const hotelBase = {
    area: "西湖区",
    address: "杭州市测试路",
    room: "房型需官方确认",
    nightlyRate: null,
    status: "真实 POI · 房价暂不可用",
    source: "高德地图",
    rooms: [{
      name: "标准房",
      bed: "1 张大床",
      maxOccupancy: 2,
      totalPrice: 1200,
      nightlyPrice: 600,
      isAvailable: true,
      isOnRequest: false,
      availability: "供应商可售",
      cancellation: "按供应商政策",
      source: "RollingGo MCP",
    }],
  };
  const liveTools = makeLiveTools({
    hotels: [
      { ...hotelBase, id: "slow", providerHotelId: "slow", name: "高评分远端酒店", location: "121.0,31.0", rating: "4.9", commuteMinutes: 36 },
      { ...hotelBase, id: "fast", providerHotelId: "fast", name: "通勤优先酒店", location: "120.2,30.2", rating: "4.1", commuteMinutes: 9 },
      { ...hotelBase, id: "middle", providerHotelId: "middle", name: "中间酒店", location: "120.5,30.5", rating: "4.6", commuteMinutes: 18 },
    ],
  });
  const result = await runLiveAgent(
    { message: `${startDate}去杭州玩3天，两个人` },
    { config: runtimeConfig, modelClient: makeModelClient(), liveTools }
  );

  assert.equal(result.plan.selectedHotel.name, "通勤优先酒店");
  assert.equal(result.plan.selectedHotel.commuteMinutes, 9);
  assert.deepEqual(result.plan.hotels.map((hotel) => hotel.commuteMinutes), [9, 18, 36]);
  assert.equal(result.plan.hotelRanking.basis, "首日景点驾车通勤时间");
  assert.equal(result.plan.hotelRanking.checked, 2);
  assert.equal(result.metrics.toolCalls, 15);
  assert.equal(result.plan.diningCommuteStatus.complete, true);
  assert.equal(result.plan.diningCommuteStatus.requested, 6);
  assert.equal(result.plan.diningCommuteStatus.verified, 6);
  assert.equal(result.events.some((event) => event.type === "hotel_ranking"), true);
  assertPlanHasNoBudget(result);
});

test("global hard-constraint audit adds daily indoor backups and afternoon rest", async () => {
  const attractionCandidates = [
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `outdoor-${index}`,
      name: `户外景点 ${index + 1}`,
      address: "杭州市测试路",
      location: `120.1${index},30.2${index}`,
      open: "09:00-18:00",
      openVerified: true,
      indoor: false,
      source: "高德地图",
    })),
  ];
  const indoorAttractions = Array.from({ length: 2 }, (_, index) => ({
      id: `indoor-${index}`,
      name: `室内备选 ${index + 1}`,
      address: "杭州市博物馆路",
      location: `120.3${index},30.3${index}`,
      open: "09:00-17:00",
      openVerified: true,
      indoor: true,
      source: "高德地图",
    }));
  const tools = makeLiveTools({ attractionCandidates, indoorAttractions });
  const result = await runLiveAgent(
    { message: `${startDate}去杭州玩3天，两个人。每天一个室内备选，午后留出休息时间。` },
    { config: runtimeConfig, modelClient: makeModelClient(), liveTools: tools }
  );

  assert.equal(result.constraints.hardConstraints.dailyIndoorBackup, true);
  assert.equal(result.constraints.hardConstraints.afternoonRest, true);
  assert.equal(tools.calls.filter((call) => call === "attractions").length, 2);
  assert.equal(result.plan.days.every((day) => day.items.some((item) => item.time === "室内备选")), true);
  assert.equal(result.plan.days.every((day) => day.items.some((item) => item.time === "午后" && item.type === "休息")), true);
  assert.equal(result.plan.hardConstraintAudit.complete, true);
  assert.equal(result.taskStatus, "已完成");
});

test("avoid-sun hard constraint selects real indoor attractions for every day", async () => {
  const outdoor = Array.from({ length: 6 }, (_, index) => ({
    id: `sun-outdoor-${index}`,
    name: `暴晒景点 ${index + 1}`,
    address: "杭州市测试路",
    location: `120.1${index},30.2${index}`,
    open: "09:00-18:00",
    openVerified: true,
    indoor: false,
    source: "高德地图",
  }));
  const indoor = Array.from({ length: 6 }, (_, index) => ({
    id: `sun-indoor-${index}`,
    name: `室内景点 ${index + 1}`,
    address: "杭州市博物馆路",
    location: `120.3${index},30.3${index}`,
    open: "09:00-17:00",
    openVerified: true,
    indoor: true,
    source: "高德地图",
  }));
  const tools = makeLiveTools({ attractionCandidates: outdoor, indoorAttractions: indoor });
  const result = await runLiveAgent(
    { message: `${startDate}去杭州玩3天，两个人。每天安排两个主要景点，午后休息，不想暴晒。` },
    { config: runtimeConfig, modelClient: makeModelClient(), liveTools: tools }
  );

  assert.equal(result.constraints.hardConstraints.avoidSunExposure, true);
  assert.equal(result.plan.days.every((day) => day.items.some((item) => item.type === "室内景点")), true);
  assert.equal(result.plan.hardConstraintAudit.checks.find((check) => check.key === "avoidSunExposure").pass, true);
  assert.equal(result.plan.routes[0].from, "室内景点 1");
  assert.equal(result.plan.routes[0].to, "室内景点 2");
  assert.equal(result.plan.days[0].items.find((item) => item.time === "前往下一景点").title, "室内景点 1 → 室内景点 2");
});

test("sea-view intent adds a verified coastal place without replacing indoor daytime attractions", async () => {
  const outdoor = [
    {
      id: "coast-1",
      name: "海湾公园",
      address: "杭州市海滨路",
      location: "120.4,30.4",
      open: "06:00-22:00",
      openVerified: true,
      indoor: false,
      source: "高德地图",
    },
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `coast-outdoor-${index}`,
      name: `海边外场 ${index + 1}`,
      address: "杭州市测试路",
      location: `120.1${index},30.2${index}`,
      open: "09:00-18:00",
      openVerified: true,
      indoor: false,
      source: "高德地图",
    })),
  ];
  const indoor = Array.from({ length: 6 }, (_, index) => ({
    id: `coast-indoor-${index}`,
    name: `室内景点 ${index + 1}`,
    address: "杭州市博物馆路",
    location: `120.3${index},30.3${index}`,
    open: "09:00-17:00",
    openVerified: true,
    indoor: true,
    source: "高德地图",
  }));
  const result = await runLiveAgent(
    { message: `${startDate}去杭州玩3天，两个人，想看海但不想暴晒，午后休息。` },
    { config: runtimeConfig, modelClient: makeModelClient(), liveTools: makeLiveTools({ attractionCandidates: outdoor, indoorAttractions: indoor }) }
  );

  assert.equal(result.constraints.hardConstraints.seaView, true);
  assert.equal(result.plan.hardConstraintAudit.checks.find((check) => check.key === "seaView").pass, true);
  assert.equal(result.plan.hardConstraintAudit.checks.find((check) => check.key === "avoidSunExposure").pass, true);
  assert.equal(result.plan.days.flatMap((day) => day.items).filter((item) => item.type === "海景观景点").length, 1);
  assert.equal(result.plan.days.every((day) => day.items
    .filter((item) => ["上午", "下午"].includes(item.time))
    .every((item) => item.type === "室内景点")), true);
  assert.equal(result.plan.days.every((day) => day.items.some((item) => item.time === "午后" && item.type === "休息")), true);
});

test("daily sea-view audit rejects an indoor naval museum as a sea view", async () => {
  const outdoor = [{
    id: "false-sea",
    name: "海军博物馆",
    address: "杭州市测试路",
    location: "120.1,30.2",
    open: "09:00-17:00",
    openVerified: true,
    indoor: false,
    source: "高德地图",
  }];
  const indoor = Array.from({ length: 6 }, (_, index) => ({
    id: `false-sea-indoor-${index}`,
    name: `海军博物馆展厅 ${index + 1}`,
    address: "杭州市测试路",
    location: `120.2${index},30.2${index}`,
    open: "09:00-17:00",
    openVerified: true,
    indoor: true,
    source: "高德地图",
  }));
  const result = await runLiveAgent(
    { message: `${startDate}去杭州玩3天，两个人，每天有一个能看海景的景点。` },
    { config: runtimeConfig, modelClient: makeModelClient(), liveTools: makeLiveTools({ attractionCandidates: outdoor, indoorAttractions: indoor }) }
  );

  const audit = result.plan.hardConstraintAudit.checks.find((check) => check.key === "dailySeaView");
  assert.equal(audit.pass, false);
  assert.match(audit.detail, /海军博物馆/);
  assert.equal(result.plan.days.some((day) => day.items.some((item) => item.type === "海景观景点")), false);
});

test("avoid-early-start and easy-walking audits reject nested attraction padding", async () => {
  const nearbyDecision = decision({
    constraints: {
      destination: "深圳",
      startDate,
      days: 2,
      travelers: 2,
      currency: "CNY",
      preferences: ["避免早起", "本地美食", "轻松步行"],
    },
  });
  const attractions = [
    { id: "park", name: "莲花山公园", address: "红荔路", location: "114.057,22.555", open: "06:00-23:00", openVerified: true, indoor: false },
    { id: "statue", name: "莲花山公园-邓小平雕像", address: "红荔路", location: "114.05702,22.55502", open: "06:30-23:00", openVerified: true, indoor: false },
    { id: "center", name: "深圳中心公园", address: "皇岗路", location: "114.075,22.565", open: "06:00-23:00", openVerified: true, indoor: false },
    { id: "pen", name: "笔架山公园", address: "银湖路", location: "114.090,22.575", open: "06:00-23:00", openVerified: true, indoor: false },
    { id: "seaview", name: "深圳湾公园", address: "滨海大道", location: "113.95,22.52", open: "06:00-23:00", openVerified: true, indoor: false },
  ];
  const result = await runLiveAgent(
    { message: `请按 ${startDate} plan a 2-day Shenzhen trip for 2 adults, avoid early starts, prefer local food and easy walking.` },
    { config: runtimeConfig, modelClient: makeModelClient(nearbyDecision), liveTools: makeLiveTools({ attractionCandidates: attractions }) }
  );

  assert.equal(result.constraints.hardConstraints.avoidEarlyStart, true);
  assert.equal(result.plan.days.every((day) => day.items.some((item) => item.time === "出发" && item.title === "10:00 后开始")), true);
  assert.notEqual(result.plan.days[0].items.find((item) => item.time === "下午")?.title, "莲花山公园-邓小平雕像");
  assert.equal(result.plan.days.flatMap((day) => day.items).some((item) => item.title === "莲花山公园-邓小平雕像"), false);
  assert.equal(result.plan.hardConstraintAudit.checks.find((check) => check.key === "avoidEarlyStart").pass, true);
  assert.equal(result.plan.hardConstraintAudit.checks.find((check) => check.key === "easyWalking").pass, true);
});

test("rain without a real indoor POI does not fall back to outdoor planning", async () => {
  const result = await runLiveAgent(
    { message: `${startDate}去杭州玩3天，两个人` },
    {
      config: runtimeConfig,
      modelClient: makeModelClient(),
      liveTools: makeLiveTools({ weatherConditions: ["大雨", "晴", "晴"] }),
    }
  );

  assert.equal(result.plan.days[0].weatherAdaptation.type, "rain_no_indoor");
  assert.equal(result.plan.days[0].items[0].title, "室内地点暂不可用");
  assert.equal(result.plan.days[0].items.some((item) => item.title.includes("真实景点")), false);
  assert.match(result.plan.refreshWarnings.join(" "), /没有可验证的室内 POI/);
  assert.equal(result.plan.checks.find((check) => check.label === "天气适配可追溯").pass, true);
  assertPlanHasNoBudget(result);
});
