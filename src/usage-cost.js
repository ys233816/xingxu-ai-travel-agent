function clockMinutes(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value ?? ""));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function resolvePricePeriod(pricing = {}, at = new Date()) {
  if (pricing.periodMode === "peak" || pricing.periodMode === "off_peak") return pricing.periodMode;
  const start = clockMinutes(pricing.offPeakStart);
  const end = clockMinutes(pricing.offPeakEnd);
  if (start === null || end === null) return null;
  let pieces;
  try {
    pieces = new Intl.DateTimeFormat("en-GB", {
      timeZone: pricing.timeZone || "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
  } catch {
    return null;
  }
  const hour = Number(pieces.find((item) => item.type === "hour")?.value);
  const minute = Number(pieces.find((item) => item.type === "minute")?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  const current = hour * 60 + minute;
  const inOffPeak = start < end
    ? current >= start && current < end
    : current >= start || current < end;
  return inOffPeak ? "off_peak" : "peak";
}

export function calculateModelCost(usage = {}, pricing = {}, { modelRounds = 0, at = new Date() } = {}) {
  const inputTokens = Number.isFinite(usage.inputTokens) ? usage.inputTokens : null;
  const outputTokens = Number.isFinite(usage.outputTokens) ? usage.outputTokens : null;
  const inputPerMillion = Number.isFinite(pricing.inputPerMillion) ? pricing.inputPerMillion : null;
  const outputPerMillion = Number.isFinite(pricing.outputPerMillion) ? pricing.outputPerMillion : null;
  const currency = typeof pricing.currency === "string" && pricing.currency ? pricing.currency : "CNY";
  const period = resolvePricePeriod(pricing, at);
  const pricingMetadata = {
    inputPerMillion,
    outputPerMillion,
    currency,
    inputCacheHitOffPeakPerMillion: pricing.inputCacheHitOffPeakPerMillion ?? null,
    inputCacheHitPeakPerMillion: pricing.inputCacheHitPeakPerMillion ?? null,
    inputCacheMissOffPeakPerMillion: pricing.inputCacheMissOffPeakPerMillion ?? null,
    inputCacheMissPeakPerMillion: pricing.inputCacheMissPeakPerMillion ?? null,
    outputOffPeakPerMillion: pricing.outputOffPeakPerMillion ?? null,
    outputPeakPerMillion: pricing.outputPeakPerMillion ?? null,
    periodMode: pricing.periodMode ?? "auto",
    period,
    offPeakStart: pricing.offPeakStart ?? null,
    offPeakEnd: pricing.offPeakEnd ?? null,
    timeZone: pricing.timeZone ?? "Asia/Shanghai",
    version: pricing.version ?? null,
    source: pricing.source ?? null,
  };

  if (modelRounds === 0) {
    return {
      status: "zero_usage",
      amount: 0,
      currency,
      basis: "本轮未调用模型",
      period,
      usage: { inputTokens: 0, outputTokens: 0 },
      pricing: pricingMetadata,
      externalToolCost: { status: "not_included", reason: "未配置天气、地图与酒店接口的按次计费信息" },
    };
  }
  if (inputTokens === null || outputTokens === null) {
    return {
      status: "unavailable",
      amount: null,
      currency,
      reason: "模型供应商未返回完整 Token 用量",
      period,
      usage: { inputTokens, outputTokens },
      pricing: pricingMetadata,
      externalToolCost: { status: "not_included", reason: "未配置天气、地图与酒店接口的按次计费信息" },
    };
  }
  const cacheHitRate = period === "off_peak"
    ? pricing.inputCacheHitOffPeakPerMillion
    : pricing.inputCacheHitPeakPerMillion;
  const cacheMissRate = period === "off_peak"
    ? pricing.inputCacheMissOffPeakPerMillion
    : pricing.inputCacheMissPeakPerMillion;
  const tieredOutputRate = period === "off_peak" ? pricing.outputOffPeakPerMillion : pricing.outputPeakPerMillion;
  const tieredRatesConfigured = [cacheHitRate, cacheMissRate, tieredOutputRate].every(Number.isFinite);
  const cacheBreakdownComplete = usage.cacheBreakdownComplete === true
    && Number.isFinite(usage.inputCacheHitTokens)
    && Number.isFinite(usage.inputCacheMissTokens);

  if (tieredRatesConfigured) {
    if (!period) {
      return {
        status: "unavailable",
        amount: null,
        currency,
        reason: "未配置有效的空闲时段或时区，无法确定高峰/空闲单价",
        usage,
        pricing: pricingMetadata,
        externalToolCost: { status: "not_included", reason: "未配置天气、地图与酒店接口的按次计费信息" },
      };
    }
    if (!cacheBreakdownComplete) {
      return {
        status: "unavailable",
        amount: null,
        currency,
        reason: "供应商未返回缓存命中/未命中 Token 拆分",
        period,
        usage,
        pricing: pricingMetadata,
        externalToolCost: { status: "not_included", reason: "未配置天气、地图与酒店接口的按次计费信息" },
      };
    }
    const cacheHitAmount = (usage.inputCacheHitTokens / 1_000_000) * cacheHitRate;
    const cacheMissAmount = (usage.inputCacheMissTokens / 1_000_000) * cacheMissRate;
    const outputAmount = (outputTokens / 1_000_000) * tieredOutputRate;
    return {
      status: "calculated",
      amount: Number((cacheHitAmount + cacheMissAmount + outputAmount).toFixed(8)),
      currency,
      period,
      basis: "缓存命中输入 × 命中单价 + 缓存未命中输入 × 未命中单价 + 输出 × 输出单价",
      usage,
      breakdown: {
        inputCacheHit: Number(cacheHitAmount.toFixed(8)),
        inputCacheMiss: Number(cacheMissAmount.toFixed(8)),
        output: Number(outputAmount.toFixed(8)),
      },
      pricing: pricingMetadata,
      externalToolCost: { status: "not_included", reason: "未配置天气、地图与酒店接口的按次计费信息" },
    };
  }

  if (inputPerMillion === null || outputPerMillion === null) {
    return {
      status: "unavailable",
      amount: null,
      currency,
      reason: "未配置模型输入/输出 Token 单价",
      period,
      usage: { inputTokens, outputTokens },
      pricing: pricingMetadata,
      externalToolCost: { status: "not_included", reason: "未配置天气、地图与酒店接口的按次计费信息" },
    };
  }

  const inputAmount = (inputTokens / 1_000_000) * inputPerMillion;
  const outputAmount = (outputTokens / 1_000_000) * outputPerMillion;
  return {
    status: "calculated",
    amount: Number((inputAmount + outputAmount).toFixed(8)),
    currency,
    period,
    basis: "输入 Token × 输入单价 + 输出 Token × 输出单价",
    usage: { inputTokens, outputTokens },
    breakdown: {
      input: Number(inputAmount.toFixed(8)),
      output: Number(outputAmount.toFixed(8)),
    },
    pricing: pricingMetadata,
    externalToolCost: { status: "not_included", reason: "未配置天气、地图与酒店接口的按次计费信息" },
  };
}

export function aggregateModelCosts(callCosts, { modelRounds = 0, usage = {}, pricing = {} } = {}) {
  if (modelRounds === 0) return calculateModelCost(usage, pricing, { modelRounds: 0 });
  if (!Array.isArray(callCosts) || callCosts.length !== modelRounds) {
    return {
      status: "unavailable",
      amount: null,
      currency: pricing.currency ?? "CNY",
      reason: "模型调用成本记录不完整",
      usage,
      callCosts,
      pricing,
      externalToolCost: { status: "not_included", reason: "未配置天气、地图与酒店接口的按次计费信息" },
    };
  }
  const unavailable = callCosts.filter((cost) => cost.status !== "calculated");
  if (unavailable.length) {
    return {
      status: "unavailable",
      amount: null,
      currency: pricing.currency ?? "CNY",
      reason: unavailable.map((cost) => cost.reason).filter(Boolean).join("；") || "模型调用成本不完整",
      usage,
      periods: [...new Set(callCosts.map((cost) => cost.period).filter(Boolean))],
      callCosts,
      pricing,
      externalToolCost: { status: "not_included", reason: "未配置天气、地图与酒店接口的按次计费信息" },
    };
  }
  const breakdown = callCosts.reduce((sum, cost) => ({
    inputCacheHit: Number(((sum.inputCacheHit ?? 0) + (cost.breakdown?.inputCacheHit ?? 0)).toFixed(8)),
    inputCacheMiss: Number(((sum.inputCacheMiss ?? 0) + (cost.breakdown?.inputCacheMiss ?? 0)).toFixed(8)),
    input: Number(((sum.input ?? 0) + (cost.breakdown?.input ?? 0)).toFixed(8)),
    output: Number(((sum.output ?? 0) + (cost.breakdown?.output ?? 0)).toFixed(8)),
  }), {});
  const periods = [...new Set(callCosts.map((cost) => cost.period).filter(Boolean))];
  return {
    status: "calculated",
    amount: Number(callCosts.reduce((sum, cost) => sum + cost.amount, 0).toFixed(8)),
    currency: pricing.currency ?? "CNY",
    period: periods.length === 1 ? periods[0] : "mixed",
    periods,
    basis: "逐次模型调用按请求时段计价后求和",
    usage,
    breakdown: Object.fromEntries(Object.entries(breakdown).filter(([, value]) => value !== 0)),
    callCosts,
    pricing,
    externalToolCost: { status: "not_included", reason: "未配置天气、地图与酒店接口的按次计费信息" },
  };
}
