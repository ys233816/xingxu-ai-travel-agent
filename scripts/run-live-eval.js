import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRuntimeConfig, loadLocalEnv } from "../src/config.js";
import { buildLiveEvalCases, runLiveEvaluation } from "../src/live-eval-suite.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadLocalEnv(root);
getRuntimeConfig();

const suiteArgIndex = process.argv.indexOf("--suite");
const suite = suiteArgIndex >= 0 ? process.argv[suiteArgIndex + 1] : "full";
const caseIdsArgIndex = process.argv.indexOf("--case-ids");
const caseIds = caseIdsArgIndex >= 0
  ? String(process.argv[caseIdsArgIndex + 1] ?? "").split(",").map((item) => item.trim()).filter(Boolean)
  : null;
if (!["full", "core", "development", "calibration"].includes(suite)) {
  console.error("未知评测集。可选项：full、core、development、calibration；留出集只随完整集合运行。");
  process.exitCode = 2;
}

if (!process.argv.includes("--confirm-costs")) {
  console.error("真实评测会产生模型与外部接口费用。确认后请追加 --confirm-costs。");
  process.exitCode = 2;
} else if (!process.exitCode) {
  const requestedIds = caseIds ? new Set(caseIds) : null;
  const cases = buildLiveEvalCases({ suite }).filter((item) => !requestedIds || requestedIds.has(item.id));
  if (!cases.length) {
    console.error("--case-ids 没有匹配到当前评测集中的用例。");
    process.exitCode = 2;
  } else {
    console.log(`开始执行 ${cases.length} 条真实评测（${suite}${caseIds ? `；定向 ${caseIds.join(",")}` : ""}）。`);
    if (caseIds) {
      const missingIds = caseIds.filter((id) => !cases.some((item) => item.id === id));
      if (missingIds.length) console.log(`未匹配：${missingIds.join(",")}`);
    }

    const evaluation = await runLiveEvaluation({
    suite,
    caseIds,
    onProgress({ phase, completed, total, row }) {
      if (phase !== "case_completed") return;
      const result = row.triggered === false
        ? `未触发：${row.triggerReason}`
        : `${row.actualStatus}，证据 ${row.evidencePassed}/${row.evidenceTotal}`;
      console.log(`[${completed}/${total}] ${row.id} ${row.category} · ${result}`);
    },
    });

  const outputDir = path.join(root, "artifacts", "evaluations");
  await mkdir(outputDir, { recursive: true });
  const stamp = evaluation.completedAt.replace(/[:.]/g, "-");
  const resultFile = path.join(outputDir, `live-eval-${stamp}.json`);
  const latestFile = path.join(outputDir, "latest.json");
  const serialized = `${JSON.stringify(evaluation, null, 2)}\n`;
  await Promise.all([
    writeFile(resultFile, serialized, "utf8"),
    writeFile(latestFile, serialized, "utf8"),
  ]);

  console.log("");
  console.log(`通过：${evaluation.passed}/${evaluation.total}`);
  console.log(`失败：${evaluation.metrics.failedCases}`);
  console.log(`真实条件未触发：${evaluation.metrics.notTriggered}`);
  for (const [split, summary] of Object.entries(evaluation.metrics.bySplit)) {
    console.log(`${split}：${summary.passed}/${summary.eligible} 通过，未触发 ${summary.notTriggered}；有效用例通过率 ${summary.passRate ?? "不适用"}%`);
  }
  console.log(`工具重试：${evaluation.metrics.retryCount}`);
  console.log(`步骤证据通过：${evaluation.metrics.layers.step.evidenceRate ?? "不适用"}%`);
  console.log(`工具业务成功观察：${evaluation.metrics.layers.tools.successRate ?? "不适用"}%`);
  console.log(`任务时延 P50/P95：${evaluation.metrics.layers.experience.latencyMs.p50 ?? "不适用"} / ${evaluation.metrics.layers.experience.latencyMs.p95 ?? "不适用"} ms`);
  console.log(`Prompt 版本：${evaluation.versions.prompt.join("、") || "未记录"}`);
  console.log(`模型请求名：${evaluation.versions.modelRequested.join("、") || "未记录"}`);
  console.log(`模型实际版本：${evaluation.versions.modelReported.join("、") || "供应商未返回"}`);
  console.log(`工具版本：${evaluation.versions.tools.join("、") || "未记录"}`);
  console.log(evaluation.costs.model.status === "complete"
    ? `模型 Token 成本合计：${evaluation.costs.model.total} ${evaluation.costs.model.currency}`
    : `模型 Token 成本：未完整计算（${evaluation.costs.model.unavailableTasks} 条缺少价格或用量）`);
  console.log("外部天气、地图与酒店接口费用未配置按次价格，未计入上述成本。");
    console.log(`结果文件：${resultFile}`);
  }
}
