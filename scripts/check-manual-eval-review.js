import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { csvRowsToObjects, parseCsv } from "../src/csv.js";
import { dimensionScoreField, EVAL_DIMENSIONS, evaluateReviewGate } from "../src/eval-review.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reviewFile = path.join(root, "artifacts", "evaluations", "manual-review.json");
const scoreFile = path.join(root, "artifacts", "evaluations", "manual-review.csv");
const resultFile = path.join(root, "artifacts", "evaluations", "manual-review-result.json");

function parseBoolean(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return null;
}

function parseScore(value) {
  if (String(value ?? "").trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseRedlineIds(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return [];
  return [...new Set(normalized.split(/[|,;，；\s]+/).filter(Boolean).map((item) => item.toUpperCase()))];
}

const review = JSON.parse(await readFile(reviewFile, "utf8"));
const records = csvRowsToObjects(parseCsv(await readFile(scoreFile, "utf8")));
const recordById = new Map(records.map((record) => [record.case_id, record]));

for (const item of review.cases) {
  const record = recordById.get(item.id);
  if (!record) continue;
  item.humanReview = {
    reviewer: String(record.reviewer ?? "").trim() || null,
    reviewedAt: String(record.reviewed_at ?? "").trim() || null,
    scores: Object.fromEntries(EVAL_DIMENSIONS.map((dimension) => [
      dimension.id,
      parseScore(record[dimensionScoreField(dimension)]),
    ])),
    redlineReviewed: parseBoolean(record.redline_reviewed),
    redlineIds: parseBoolean(record.redline_reviewed) === true ? parseRedlineIds(record.redline_ids) : null,
    notes: String(record.notes ?? "").trim(),
    decision: "pending",
  };
}

const gate = evaluateReviewGate(review);
const resultById = new Map(gate.results.map((item) => [item.id, item]));
for (const item of review.cases) item.humanReview.decision = resultById.get(item.id)?.status ?? "pending";
review.suiteGate = {
  ...gate,
  humanReviewCompleted: gate.reviewedCases,
};

await writeFile(resultFile, `${JSON.stringify(review, null, 2)}\n`, "utf8");
console.log(`门禁状态：${gate.status}`);
console.log(`已复核：${gate.reviewedCases}/${gate.totalCases}；通过：${gate.passedCases}；失败：${gate.failedCases}；未触发：${gate.notEvaluatedCases}；红线错误：${gate.redlineErrors ?? "待确认"}`);
console.log(`结果文件：${resultFile}`);
if (gate.status !== "passed") process.exitCode = 2;
