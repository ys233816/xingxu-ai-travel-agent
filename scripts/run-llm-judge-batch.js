import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRuntimeConfig, loadLocalEnv } from "../src/config.js";
import { prepareLlmJudgeBatch, runLlmJudgeBatch } from "../src/llm-judge.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "artifacts", "evaluations");
const evaluationFile = path.join(outputDir, "latest.json");
const calibrationFile = path.join(outputDir, "judge-calibration-result.json");
const resultFile = path.join(outputDir, "llm-judge-40-result.json");

loadLocalEnv(root);
if (!process.argv.includes("--confirm-costs")) {
  console.error("40 条 LLM 裁判会产生模型费用。确认后追加 --confirm-costs。");
  process.exitCode = 2;
  process.exit(2);
}

let evaluation;
let calibrationResult;
try {
  [evaluation, calibrationResult] = await Promise.all([
    readFile(evaluationFile, "utf8").then(JSON.parse),
    readFile(calibrationFile, "utf8").then(JSON.parse),
  ]);
} catch (error) {
  console.error(`缺少批量评测输入：${error.message}`);
  process.exitCode = 2;
  process.exit(2);
}

const config = getRuntimeConfig();
let prepared;
try {
  prepared = prepareLlmJudgeBatch(evaluation, calibrationResult);
} catch (error) {
  console.error(`批量裁判门禁拒绝执行：${error.message}`);
  if (error.details) console.error(JSON.stringify(error.details, null, 2));
  process.exitCode = 2;
  process.exit(2);
}

console.log(`校准门禁：通过（决策 ${(prepared.calibration.passAgreement * 100).toFixed(1)}%，红线 ${(prepared.calibration.redlineAgreement * 100).toFixed(1)}%）`);
console.log(`可评分 ${prepared.eligible} 条，未评估 ${prepared.notEvaluated} 条，预计 ${prepared.plannedJudgeCalls} 次逻辑裁判调用。`);
const run = await runLlmJudgeBatch(evaluation, calibrationResult, config, {
  onProgress({ completed, total, caseId, kind }) {
    if (completed === total || completed % 14 === 0) {
      console.log(`[${completed}/${total}] ${caseId} · ${kind}`);
    }
  },
});

await mkdir(outputDir, { recursive: true });
await writeFile(resultFile, `${JSON.stringify(run, null, 2)}\n`, "utf8");
console.log(`机评通过/失败：${run.summary.passed}/${run.summary.failed}`);
console.log(`未评估：${run.summary.notEvaluated}`);
console.log(run.judge.cost.status === "calculated"
  ? `裁判模型 Token 成本：${run.judge.cost.amount} ${run.judge.cost.currency}`
  : `裁判模型 Token 成本：不可计算（${run.judge.cost.reason ?? "用量或价格不完整"}）`);
console.log(`结果文件：${resultFile}`);
console.log("生成可读报告：npm run judge:report");
