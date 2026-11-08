import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runLiveAgent } from "./src/live-agent.js";
import { TOOL_REGISTRY } from "./src/tools.js";
import { PERMISSION_CONTRACT, DEMO_EVIDENCE_MAP, auditScenarioEvidence } from "./src/permissions.js";
import { describeRuntime, loadLocalEnv } from "./src/config.js";
import { RUNTIME_LIMITS } from "./src/runtime-contract.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadLocalEnv(__dirname);
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number(process.env.PORT ?? 4173);
const HOST = process.env.HOST ?? "127.0.0.1";
const PLAN_SESSION_TTL_MS = 30 * 60 * 1000;
const planSessions = new Map();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function executionErrorMessage(error) {
  if (error.code === "CONFIG_MISSING") return error.message;
  const messages = {
    NETWORK_ERROR: "无法连接真实数据服务，请检查网络、接口地址或安全设置后重试。",
    TIMEOUT: "真实数据服务响应超时，请稍后重试。",
    RATE_LIMITED: "真实数据服务当前触发限流，请稍后重试。",
    MODEL_INVALID_JSON: "模型两次都没有返回可解析的规划结果，请稍后重试。",
    ROLLINGGO_AUTH_REQUIRED: "RollingGo API Key 无效或已过期，请更新配置。",
    PLAN_SESSION_EXPIRED: "上一版方案已过期或服务已重启，请先重新生成方案。",
  };
  return messages[error.code] ?? "规划任务执行失败，请稍后重试；已完成的查询不会回退到 Mock 或估算数据。";
}

function rememberPlan(result) {
  if (!result.plan) return;
  planSessions.set(result.runId, { plan: result.plan, constraints: result.constraints, createdAt: Date.now() });
  while (planSessions.size > 50) planSessions.delete(planSessions.keys().next().value);
}

function loadPlan(runId) {
  if (!runId) return null;
  const session = planSessions.get(String(runId));
  if (!session) return null;
  if (Date.now() - session.createdAt > PLAN_SESSION_TTL_MS) {
    planSessions.delete(String(runId));
    return null;
  }
  return session;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveStatic(response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const relative = requested.replace(/^\/+/, "");
  const filePath = path.resolve(PUBLIC_DIR, relative);
  const relativeCheck = path.relative(PUBLIC_DIR, filePath);
  if (relativeCheck.startsWith("..") || path.isAbsolute(relativeCheck)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const type = MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
    response.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data: https:; connect-src 'self'",
    });
    response.end(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    throw error;
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);

  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      const runtime = describeRuntime();
      return sendJson(response, 200, { ok: true, mode: "live", version: "0.2.0", runtime });
    }

    if (request.method === "GET" && url.pathname === "/api/tools") {
      return sendJson(response, 200, {
        tools: TOOL_REGISTRY,
        contract: PERMISSION_CONTRACT,
        evidenceMap: DEMO_EVIDENCE_MAP,
        ...RUNTIME_LIMITS,
      });
    }

    if (request.method === "POST" && url.pathname === "/api/plan") {
      const body = await readJson(request);
      const previous = loadPlan(body.previousRunId);
      if (body.previousRunId && !previous) {
        return sendJson(response, 409, {
          error: "上一版方案已过期或服务已重启，请先重新生成方案。",
          code: "PLAN_SESSION_EXPIRED",
        });
      }
      const result = await runLiveAgent({
        message: body.message,
        previousConstraints: previous?.constraints ?? null,
        previousPlan: previous?.plan ?? null,
      });
      rememberPlan(result);
      return sendJson(response, 200, {
        ...result,
        scenarioId: body.scenarioId ?? null,
        evidenceAudit: auditScenarioEvidence(result, body.scenarioId),
      });
    }

    if (request.method === "GET") return serveStatic(response, decodeURIComponent(url.pathname));
    return sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
  } catch (error) {
    const status = error.statusCode ?? (error.message === "REQUEST_TOO_LARGE" ? 413 : 500);
    sendJson(response, status, {
      error: status === 413 ? "请求内容过大" : executionErrorMessage(error),
      code: error.code ?? "AGENT_EXECUTION_ERROR",
      missing: error.missing,
      detail: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Xingxu Agent Studio running at http://${HOST}:${PORT}`);
});
