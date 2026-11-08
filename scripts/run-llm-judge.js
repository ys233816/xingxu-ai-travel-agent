import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRuntimeConfig, loadLocalEnv } from "../src/config.js";
import { compareJudgeCalibration, runJudgeCalibration } from "../src/llm-judge.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "artifacts", "evaluations");
const readyFile = path.join(outputDir, "judge-calibration-ready.json");
const resultFile = path.join(outputDir, "judge-calibration-result.json");

loadLocalEnv(root);
if (!process.argv.includes("--confirm-costs")) {
  console.error("LLM 裁判会调用模型产生费用。确认后追加 --confirm-costs。");
  process.exitCode = 2;
  process.exit(2);
}

let packageData;
try {
  packageData = JSON.parse(await readFile(readyFile, "utf8"));
} catch {
  console.error(`缺少人工评分就绪文件：${readyFile}`);
  process.exitCode = 2;
  process.exit(2);
}

const config = getRuntimeConfig();
const run = await runJudgeCalibration(packageData, config, {
  onProgress({ completed, total, caseId, kind }) {
    if (completed === total || completed % 7 === 0) console.log(`[${completed}/${total}] ${caseId} · ${kind}`);
  },
});
const calibration = compareJudgeCalibration(run);
const output = {
  ...run,
  calibration,
  usagePolicy: calibration.canScale
    ? "一致率达标，可在持续人工抽检下进入批量 LLM 评分。"
    : "一致率未达标，不得把 LLM 裁判结果作为批量评测结论。",
};
await writeFile(resultFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");

console.log(`通过/失败一致率：${(calibration.passAgreement * 100).toFixed(1)}%（门槛 85%）`);
console.log(`红线一致率：${(calibration.redlineAgreement * 100).toFixed(1)}%（门槛 100%）`);
console.log(`结论：${calibration.status}；${output.usagePolicy}`);
console.log(run.judge.cost.status === "calculated"
  ? `裁判模型 Token 成本：${run.judge.cost.amount} ${run.judge.cost.currency}`
  : `裁判模型 Token 成本：不可计算（${run.judge.cost.reason ?? "用量或价格不完整"}）`);
console.log(`结果文件：${resultFile}`);
