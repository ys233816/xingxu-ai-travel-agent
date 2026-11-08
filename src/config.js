import fs from "node:fs";
import path from "node:path";
import { MAX_ATTEMPTS_PER_TOOL, MAX_MODEL_ROUNDS, MAX_TOOL_CALLS } from "./runtime-contract.js";

let localEnvLoaded = false;

function parseEnvValue(raw) {
  const value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function normalizeUrl(value, fallback = "") {
  const raw = String(value || fallback).trim();
  if (!raw) return "";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/$/, "");
}

function optionalNonNegativeNumber(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function optionalClockTime(value) {
  const normalized = String(value ?? "").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(normalized) ? normalized : null;
}

export function loadLocalEnv(root = process.cwd()) {
  if (localEnvLoaded) return;
  localEnvLoaded = true;
  const file = path.join(root, ".env.local");
  if (!fs.existsSync(file)) return;
  const content = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = parseEnvValue(match[2]);
  }
}

export function getRuntimeConfig({ requireSecrets = true } = {}) {
  loadLocalEnv();
  const config = {
    model: {
      baseUrl: normalizeUrl(process.env.MODEL_BASE_URL, "https://api.openai.com/v1"),
      apiKey: process.env.MODEL_API_KEY || "",
      name: process.env.MODEL_NAME || "",
      jsonMode: process.env.MODEL_JSON_MODE || "json_object",
      timeoutMs: Number(process.env.MODEL_TIMEOUT_MS || 45000),
      pricing: {
        inputPerMillion: optionalNonNegativeNumber(process.env.MODEL_INPUT_PRICE_PER_MILLION),
        outputPerMillion: optionalNonNegativeNumber(process.env.MODEL_OUTPUT_PRICE_PER_MILLION),
        inputCacheHitOffPeakPerMillion: optionalNonNegativeNumber(process.env.MODEL_INPUT_CACHE_HIT_OFF_PEAK_PRICE_PER_MILLION),
        inputCacheHitPeakPerMillion: optionalNonNegativeNumber(process.env.MODEL_INPUT_CACHE_HIT_PEAK_PRICE_PER_MILLION),
        inputCacheMissOffPeakPerMillion: optionalNonNegativeNumber(process.env.MODEL_INPUT_CACHE_MISS_OFF_PEAK_PRICE_PER_MILLION),
        inputCacheMissPeakPerMillion: optionalNonNegativeNumber(process.env.MODEL_INPUT_CACHE_MISS_PEAK_PRICE_PER_MILLION),
        outputOffPeakPerMillion: optionalNonNegativeNumber(process.env.MODEL_OUTPUT_OFF_PEAK_PRICE_PER_MILLION),
        outputPeakPerMillion: optionalNonNegativeNumber(process.env.MODEL_OUTPUT_PEAK_PRICE_PER_MILLION),
        periodMode: ["auto", "peak", "off_peak"].includes(process.env.MODEL_PRICE_PERIOD)
          ? process.env.MODEL_PRICE_PERIOD
          : "auto",
        offPeakStart: optionalClockTime(process.env.MODEL_OFF_PEAK_START),
        offPeakEnd: optionalClockTime(process.env.MODEL_OFF_PEAK_END),
        timeZone: process.env.MODEL_PRICE_TIMEZONE || "Asia/Shanghai",
        currency: /^[A-Z]{3}$/.test(process.env.MODEL_PRICE_CURRENCY || "") ? process.env.MODEL_PRICE_CURRENCY : "CNY",
        version: process.env.MODEL_PRICE_VERSION || null,
        source: process.env.MODEL_PRICE_SOURCE || null,
      },
    },
    weather: {
      apiKey: process.env.QWEATHER_API_KEY || "",
      apiHost: normalizeUrl(process.env.QWEATHER_API_HOST),
      geoHost: normalizeUrl(process.env.QWEATHER_GEO_HOST, "https://geoapi.qweather.com"),
      timeoutMs: Number(process.env.QWEATHER_TIMEOUT_MS || 12000),
    },
    amap: {
      apiKey: process.env.AMAP_API_KEY || "",
      timeoutMs: Number(process.env.AMAP_TIMEOUT_MS || 12000),
      routeSpacingMs: Number(process.env.AMAP_ROUTE_SPACING_MS || 450),
      routeRetryDelayMs: Number(process.env.AMAP_ROUTE_RETRY_DELAY_MS || 1200),
    },
    rollingGo: {
      apiKey: process.env.ROLLINGGO_API_KEY || "",
      mcpUrl: normalizeUrl(process.env.ROLLINGGO_MCP_URL, "https://mcp.rollinggo.cn/mcp"),
      protocolVersion: process.env.ROLLINGGO_MCP_PROTOCOL_VERSION || "2025-03-26",
      timeoutMs: Number(process.env.ROLLINGGO_TIMEOUT_MS || 60000),
    },
    maxToolCalls: MAX_TOOL_CALLS,
    maxAttemptsPerTool: MAX_ATTEMPTS_PER_TOOL,
    maxModelRounds: MAX_MODEL_ROUNDS,
  };

  const missing = [];
  if (!config.model.apiKey) missing.push("MODEL_API_KEY");
  if (!config.model.name) missing.push("MODEL_NAME");
  if (!config.weather.apiKey) missing.push("QWEATHER_API_KEY");
  if (!config.weather.apiHost) missing.push("QWEATHER_API_HOST");
  if (!config.amap.apiKey) missing.push("AMAP_API_KEY");
  if (!config.rollingGo.apiKey) missing.push("ROLLINGGO_API_KEY");
  if (requireSecrets && missing.length) {
    const error = new Error(`缺少真实服务配置：${missing.join("、")}`);
    error.code = "CONFIG_MISSING";
    error.missing = missing;
    error.statusCode = 503;
    throw error;
  }
  return { ...config, missing, configured: missing.length === 0 };
}

export function describeRuntime() {
  const config = getRuntimeConfig({ requireSecrets: false });
  return {
    configured: config.configured,
    missing: config.missing,
    mode: "live",
    providers: {
      model: new URL(config.model.baseUrl).host,
      weather: config.weather.apiHost || null,
      map: "restapi.amap.com",
      hotel: new URL(config.rollingGo.mcpUrl).host,
    },
  };
}
