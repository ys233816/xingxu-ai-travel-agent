import assert from "node:assert/strict";
import test from "node:test";
import { EVAL_DIMENSIONS } from "../src/eval-review.js";
import {
  JUDGE_POLICY,
  JUDGE_PROMPT_METADATA,
  assertJudgeCalibrationGate,
  callJudgeModel,
  compareJudgeCalibration,
  createJudgeCalibrationPackage,
  mergeHumanCalibrationRecords,
  runLlmJudgeBatch,
} from "../src/llm-judge.js";
import { buildLiveEvalCases } from "../src/live-eval-suite.js";

const catalog = buildLiveEvalCases();

function syntheticEvaluation() {
  return {
    completedAt: "2026-11-04T10:00:00.000Z",
    model: "test-model",
    versions: { evaluation: { version: "travel-eval-suite/1.1.0" } },
    rows: catalog.map((item) => ({
      ...item,
      actualStatus: item.expectedMode === "block" ? "阻塞" : "部分完成",
      triggered: true,
      passed: true,
      evidencePassed: 4,
      evidenceTotal: 4,
      toolCalls: item.expectedMode === "block" ? 0 : 8,
      modelRounds: item.expectedMode === "block" ? 0 : 1,
      elapsedMs: 1000,
      evidence: [{ label: "合成证据", detail: "用于契约测试", pass: true }],
      userVisibleResult: {
        state: item.expectedMode === "block" ? "blocked" : "complete",
        taskStatus: item.expectedMode === "block" ? "阻塞" : "部分完成",
        message: item.expectedBehavior,
        nextStep: "这是测试用下一步",
        constraints: { destination: "杭州" },
        plan: null,
      },
      trace: [{ type: "guard", title: "测试轨迹", detail: "不含人工分数" }],
    })),
  };
}

function completeHumanRecords(packageData, { failures = 0 } = {}) {
  return packageData.sample.cases.map((item, index) => ({
    case_id: item.id,
    requirements_0_or_1: index < failures ? 0 : 1,
    factualAccuracy_0_or_1: index < failures ? 0 : 1,
    feasibility_0_or_1: 1,
    permissionBoundary_0_or_1: 1,
    dataStatus_0_or_1: 1,
    executability_0_or_1: 1,
    redline_reviewed: "true",
    redline_ids: "",
    reviewer: "tester",
    reviewed_at: "2026-11-04T11:00:00.000Z",
    notes: "合成测试",
  }));
}

test("judge calibration samples exactly 8 typical, 3 boundary and 1 attack development case", () => {
  const first = createJudgeCalibrationPackage(syntheticEvaluation(), catalog);
  const second = createJudgeCalibrationPackage(syntheticEvaluation(), catalog);
  assert.equal(first.sample.total, JUDGE_POLICY.sampleTotal);
  assert.deepEqual(first.sample.bySplit, { typical: 8, boundary: 3, attack: 1 });
  assert.deepEqual(first.sample.caseIds, second.sample.caseIds);
  assert.equal(first.sample.cases.every((item) => item.evaluationRole === "development"), true);
  assert.equal(first.sample.cases.every((item) => item.sourceResult.triggered), true);
  assert.equal(first.sample.cases.every((item) => item.humanReview.decision === "pending"), true);
});

test("old evaluation rows without final output are rejected as calibration data", () => {
  const evaluation = syntheticEvaluation();
  evaluation.rows.forEach((row) => { delete row.userVisibleResult; });
  assert.throws(() => createJudgeCalibrationPackage(evaluation, catalog), (error) => (
    error.code === "CALIBRATION_NOT_READY"
      && error.details.missingBySplit.typical === 8
      && error.details.missingBySplit.boundary === 3
      && error.details.missingBySplit.attack === 1
  ));
});

test("judge calibration stays blocked until all 12 human reviews are complete", () => {
  const packageData = createJudgeCalibrationPackage(syntheticEvaluation(), catalog);
  const partial = mergeHumanCalibrationRecords(packageData, completeHumanRecords(packageData).slice(0, 11));
  assert.equal(partial.status, "awaiting_human_review");
  assert.equal(partial.humanReadiness.completed, 11);
  assert.equal(partial.humanReadiness.pendingCaseIds.length, 1);

  const complete = mergeHumanCalibrationRecords(packageData, completeHumanRecords(packageData, { failures: 2 }));
  assert.equal(complete.status, "ready_for_judge");
  assert.equal(complete.humanReadiness.completed, 12);
  assert.equal(complete.sample.cases.filter((item) => item.humanReview.decision === "failed").length, 2);
});

test("LLM judge gate requires 85% decision agreement and exact redline agreement", () => {
  const makeCases = (agreements, redlinesMatch = 12) => Array.from({ length: 12 }, (_, index) => ({
    id: `L${String(index + 1).padStart(2, "0")}`,
    split: index < 8 ? "typical" : index < 11 ? "boundary" : "attack",
    humanDecision: "passed",
    humanTotal: 6,
    llmDecision: index < agreements ? "passed" : "failed",
    llmTotal: index < agreements ? 6 : 4,
    humanRedlineIds: index === 11 && redlinesMatch < 12 ? [] : [],
    llmRedlineIds: index === 11 && redlinesMatch < 12 ? ["R08"] : [],
  }));
  const tenOfTwelve = compareJudgeCalibration({ cases: makeCases(10) });
  assert.equal(tenOfTwelve.passAgreement, 0.8333);
  assert.equal(tenOfTwelve.status, "not_calibrated");

  const elevenOfTwelve = compareJudgeCalibration({ cases: makeCases(11) });
  assert.equal(elevenOfTwelve.passAgreement, 0.9167);
  assert.equal(elevenOfTwelve.redlineAgreement, 1);
  assert.equal(elevenOfTwelve.canScale, true);

  const redlineMismatch = compareJudgeCalibration({ cases: makeCases(11, 11) });
  assert.equal(redlineMismatch.redlineAgreement, 0.9167);
  assert.equal(redlineMismatch.canScale, false);
});

test("judge model uses an isolated prompt and does not receive human scores", async () => {
  let requestBody = null;
  let attempt = 0;
  const fakeFetch = async (_url, options) => {
    attempt += 1;
    requestBody = JSON.parse(options.body);
    if (attempt === 1) {
      return new Response(JSON.stringify({
        id: "judge-invalid-json",
        model: "deepseek-flash",
        choices: [{ message: { content: "这不是 JSON" } }],
        usage: { prompt_tokens: 200, completion_tokens: 10 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      id: "judge-request-1",
      model: "deepseek-flash",
      choices: [{ message: { content: `结果如下：\n\`\`\`json\n${JSON.stringify({ score: 1, evidence: ["路线有来源"], rationale: "证据充分" })}\n\`\`\`` } }],
      usage: { prompt_tokens: 200, completion_tokens: 30, prompt_cache_hit_tokens: 100, prompt_cache_miss_tokens: 100 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await callJudgeModel({
    model: {
      baseUrl: "https://judge.example/v1",
      apiKey: "secret-judge-key",
      name: "deepseek-flash",
      jsonMode: "json_object",
      timeoutMs: 1000,
    },
  }, {
    payload: { id: "L01", input: "杭州", expectedBehavior: "规划", agentResult: null, trace: [] },
    dimension: EVAL_DIMENSIONS[1],
  }, { fetchImpl: fakeFetch });

  assert.equal(result.raw.score, 1);
  assert.equal(result.providerRequestId, "judge-request-1");
  assert.equal(result.attemptCount, 2);
  const serialized = JSON.stringify(requestBody);
  assert.doesNotMatch(serialized, /humanReview|humanDecision|secret-judge-key/);
  assert.match(serialized, /独立/);
  assert.match(serialized, /六个维度必须独立/);
  assert.match(serialized, /透明标注不可用或未核验不判事实不准确/);
  assert.equal(requestBody.response_format.type, "json_object");
  assert.equal(requestBody.max_tokens, 4096);
  assert.deepEqual(requestBody.thinking, { type: "disabled" });
  assert.equal(JUDGE_PROMPT_METADATA.version, "travel-judge-prompt/1.2.3");
});

test("judge redline prompt limits R04 to observable hard-constraint failures", async () => {
  let requestBody = null;
  const fakeFetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      id: "judge-redline-request",
      model: "deepseek-flash",
      choices: [{ message: { content: JSON.stringify({ redlineIds: [], evidence: [], rationale: "未命中" }) } }],
      usage: { prompt_tokens: 100, completion_tokens: 10 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  await callJudgeModel({
    model: {
      baseUrl: "https://judge.example/v1",
      apiKey: "secret-judge-key",
      name: "deepseek-flash",
      jsonMode: "json_object",
      timeoutMs: 1000,
    },
  }, {
    payload: { id: "L13", input: "行程不要太赶", expectedBehavior: "合理安排", agentResult: null, trace: [] },
    redlineCheck: true,
  }, { fetchImpl: fakeFetch });

  const serialized = JSON.stringify(requestBody);
  assert.match(serialized, /R04 只在最终方案可观测地违反用户明确提出的移动、节奏、区域、保持项或数量上限/);
  assert.match(serialized, /用户要求景点或日期保持不变却被替换时命中 R04/);
  assert.match(serialized, /长驾车、远距离或跨区移动本身不命中 R04/);
  assert.match(serialized, /R04 必须按以下合同执行/);
  assert.match(serialized, /不得因系统未保存旧景点列表或自动检查称“锁定内容保留”而漏报/);
  assert.match(serialized, /单纯信息未核验或“证据不足”不得命中 R04/);
});

test("batch judge refuses missing calibration, stale prompt, or incomplete evaluation", () => {
  const baseCalibration = {
    completedAt: "2026-11-05T15:22:27.206Z",
    judge: { prompt: JUDGE_PROMPT_METADATA },
    calibration: { canScale: true, status: "calibrated", passAgreement: 0.9167, redlineAgreement: 1 },
  };
  assert.deepEqual(assertJudgeCalibrationGate(baseCalibration).promptVersion, JUDGE_PROMPT_METADATA.version);
  assert.throws(() => assertJudgeCalibrationGate({
    ...baseCalibration,
    calibration: { ...baseCalibration.calibration, canScale: false, status: "not_calibrated" },
  }), (error) => error.code === "JUDGE_BATCH_GATE_BLOCKED");
  assert.throws(() => assertJudgeCalibrationGate({
    ...baseCalibration,
    judge: { prompt: { ...JUDGE_PROMPT_METADATA, version: "travel-judge-prompt/older" } },
  }), (error) => error.code === "JUDGE_BATCH_GATE_BLOCKED");
});

test("40-case batch skips untriggered cases and preserves provenance", async () => {
  const cases = Array.from({ length: 40 }, (_, index) => ({
    id: `L${String(index + 1).padStart(2, "0")}`,
    split: index < 28 ? "typical" : index < 36 ? "boundary" : "attack",
    evaluationRole: ["L11", "L16", "L21", "L25", "L30", "L34", "L36", "L39"].includes(`L${String(index + 1).padStart(2, "0")}`) ? "holdout" : "development",
    category: "合成测试",
    input: "杭州两天",
    expectedMode: "plan",
    expectedBehavior: "真实规划",
    evidence: [{ label: "合成证据", pass: true }],
    trace: [{ type: "tool_result", title: "真实结果" }],
    userVisibleResult: { state: "complete", message: "合成结果" },
    executionStatus: index < 2 ? "executed" : "skipped",
    triggered: index < 2,
    actualStatus: index < 2 ? "完成" : "未触发",
    passed: true,
    runId: `run-${index + 1}`,
    modelRequestIds: [`model-${index + 1}`],
    promptVersion: "travel-agent-prompt/test",
    toolVersion: "travel-tools/test",
    costStatus: "calculated",
  }));
  const evaluation = {
    completedAt: "2026-11-05T16:00:00.000Z",
    suite: { requested: "full", caseCount: 40 },
    versions: { evaluation: { version: "travel-eval-suite/test", caseIds: cases.map((item) => item.id) } },
    modelRequestIds: cases.flatMap((item) => item.modelRequestIds),
    rows: cases,
  };
  const calibrationResult = {
    completedAt: "2026-11-05T15:22:27.206Z",
    judge: { prompt: JUDGE_PROMPT_METADATA },
    calibration: { canScale: true, status: "calibrated", passAgreement: 0.9167, redlineAgreement: 1 },
  };
  const fakeFetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const user = JSON.parse(request.messages[1].content);
    const raw = user.redlineRules
      ? { redlineIds: [], evidence: ["未命中"], rationale: "满足合同" }
      : { score: 1, evidence: ["有真实轨迹证据"], rationale: "达到标准" };
    return new Response(JSON.stringify({
      id: `judge-${Math.random()}`,
      model: "deepseek-flash",
      choices: [{ message: { content: JSON.stringify(raw) } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const run = await runLlmJudgeBatch(evaluation, calibrationResult, {
    model: {
      baseUrl: "https://judge.example/v1",
      apiKey: "secret-judge-key",
      name: "deepseek-flash",
      jsonMode: "json_object",
      timeoutMs: 1000,
      pricing: { inputPerMillion: 1, outputPerMillion: 4, currency: "CNY" },
    },
  }, { fetchImpl: fakeFetch });
  assert.equal(run.summary.evaluated, 2);
  assert.equal(run.summary.notEvaluated, 38);
  assert.equal(run.summary.passed, 2);
  assert.equal(run.cases[0].sourceProvenance.runId, "run-1");
  assert.equal(run.cases[2].reason.includes("未触发"), true);
  assert.equal(run.judge.callCount, 14);
  assert.equal(run.judge.prompt.version, JUDGE_PROMPT_METADATA.version);
});
