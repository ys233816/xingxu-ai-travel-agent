import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { csvRowsToObjects, parseCsv } from "../src/csv.js";
import { dimensionScoreField, EVAL_DIMENSIONS } from "../src/eval-review.js";
import { createJudgeCalibrationPackage, mergeHumanCalibrationRecords } from "../src/llm-judge.js";
import { buildLiveEvalCases } from "../src/live-eval-suite.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evaluationFile = path.join(root, "artifacts", "evaluations", "latest.json");
const outputDir = path.join(root, "artifacts", "evaluations");
const packageFile = path.join(outputDir, "judge-calibration.json");
const blockedFile = path.join(outputDir, "judge-calibration-blocked.json");
const humanCsvFile = path.join(outputDir, "judge-calibration-human.csv");

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function humanCsv(packageData) {
  const headers = [
    "case_id",
    "split",
    "category",
    "input",
    "source_status",
    ...EVAL_DIMENSIONS.map(dimensionScoreField),
    "dimension_total_0_6",
    "redline_reviewed",
    "redline_ids",
    "reviewer",
    "reviewed_at",
    "notes",
    "decision",
  ];
  const rows = packageData.sample.cases.map((item) => [
    item.id,
    item.split,
    item.category,
    item.input,
    item.sourceResult.actualStatus,
    ...EVAL_DIMENSIONS.map((dimension) => ""),
    "",
    "",
    "",
    "",
    "",
    "",
    "pending",
  ]);
  return `${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

await mkdir(outputDir, { recursive: true });
let evaluation;
try {
  evaluation = JSON.parse(await readFile(evaluationFile, "utf8"));
} catch {
  console.error(`未找到真实评测结果：${evaluationFile}`);
  process.exitCode = 2;
  process.exit(2);
}

try {
  let packageData = createJudgeCalibrationPackage(evaluation, buildLiveEvalCases());
  let previousPackage = null;
  try {
    previousPackage = JSON.parse(await readFile(packageFile, "utf8"));
  } catch {
    previousPackage = null;
  }
  if (previousPackage?.source?.evaluationCompletedAt
    && previousPackage.source.evaluationCompletedAt !== packageData.source.evaluationCompletedAt) {
    const error = new Error("评测批次已变化，禁止复用上一批次的人工评分。");
    error.details = {
      previousEvaluationCompletedAt: previousPackage.source.evaluationCompletedAt,
      currentEvaluationCompletedAt: packageData.source.evaluationCompletedAt,
      nextAction: "保留旧校准文件另存为历史记录，再重新生成当前批次样本。",
    };
    throw error;
  }
  try {
    const rows = parseCsv(await readFile(humanCsvFile, "utf8"));
    const headers = new Set(rows[0] ?? []);
    const requiredHeaders = EVAL_DIMENSIONS.map(dimensionScoreField);
    if (!requiredHeaders.every((header) => headers.has(header))) {
      throw new Error("人工评分表字段已从加权分改为 0/1，需要重新生成空白模板。");
    }
    const records = csvRowsToObjects(rows);
    packageData = mergeHumanCalibrationRecords(packageData, records);
  } catch {
    await writeFile(humanCsvFile, humanCsv(packageData), "utf8");
    packageData = mergeHumanCalibrationRecords(packageData, []);
  }
  await writeFile(packageFile, `${JSON.stringify(packageData, null, 2)}\n`, "utf8");
  console.log(`已建立 ${packageData.sample.total} 条分层校准样本：${packageData.sample.caseIds.join("、")}`);
  console.log(`人工评分表：${humanCsvFile}`);
  console.log(packageData.status === "ready_for_judge"
    ? "人工评分已完整，可执行下一步 judge:review。"
    : `人工评分待完成：${packageData.humanReadiness.pendingCaseIds.join("、")}。`);
} catch (error) {
  const blocked = {
    schemaVersion: 1,
    status: "blocked",
    checkedAt: new Date().toISOString(),
    reason: error.message,
    details: error.details ?? null,
    nextAction: error.details?.nextAction ?? "先运行完整 40 条真实评测；不把旧 10 条缺少最终输出或未触发的记录拼成校准集。",
  };
  await writeFile(blockedFile, `${JSON.stringify(blocked, null, 2)}\n`, "utf8");
  console.error(`LLM 裁判校准未就绪：${error.message}`);
  console.error(`阻断记录：${blockedFile}`);
  process.exitCode = 2;
}
