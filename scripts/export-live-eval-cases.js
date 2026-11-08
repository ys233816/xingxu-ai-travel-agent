import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildLiveEvalCases,
  CORE_REGRESSION_CASE_IDS,
  EVALUATION_SUITE_VERSION,
  HOLDOUT_CASE_IDS,
} from "../src/live-eval-suite.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "artifacts", "evaluations");
const cases = buildLiveEvalCases();

function csvCell(value) {
  const text = Array.isArray(value) ? value.join(" | ") : value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const headers = [
  "evaluation_suite_version",
  "id",
  "split",
  "evaluation_role",
  "scenario_id",
  "category",
  "input",
  "expected_mode",
  "expected_behavior",
  "conditional",
  "code_checks",
  "human_rubric",
  "llm_judge_status",
  "depends_on_previous",
];
const rows = cases.map((item) => [
  item.evaluationSuiteVersion,
  item.id,
  item.split,
  item.evaluationRole,
  item.scenarioId,
  item.category,
  item.input,
  item.expectedMode,
  item.expectedBehavior,
  item.conditional,
  item.grading.code,
  item.grading.human.dimensions,
  item.grading.llmJudge.status,
  item.usePrevious,
]);
const summary = {
  evaluationSuiteVersion: EVALUATION_SUITE_VERSION,
  total: cases.length,
  splitCounts: Object.fromEntries(["typical", "boundary", "attack"].map((split) => [
    split,
    cases.filter((item) => item.split === split).length,
  ])),
  evaluationRoleCounts: Object.fromEntries(["development", "holdout"].map((role) => [
    role,
    cases.filter((item) => item.evaluationRole === role).length,
  ])),
  coreRegressionCaseIds: CORE_REGRESSION_CASE_IDS,
  holdoutCaseIds: HOLDOUT_CASE_IDS,
  gradingPolicy: "代码证据检查 -> 人工评分与红线 -> 人工校准后才可使用 LLM 裁判",
  cases,
};

await mkdir(outputDir, { recursive: true });
const jsonFile = path.join(outputDir, "live-eval-cases-40.json");
const csvFile = path.join(outputDir, "live-eval-cases-40.csv");
await Promise.all([
  writeFile(jsonFile, `${JSON.stringify(summary, null, 2)}\n`, "utf8"),
  writeFile(csvFile, `${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`, "utf8"),
]);

console.log(`已导出 ${cases.length} 条评测用例：${jsonFile}`);
console.log(`可审阅 CSV：${csvFile}`);
