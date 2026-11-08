import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dimensionScoreField, EVAL_DIMENSIONS, createManualReviewTemplate } from "../src/eval-review.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evaluationPath = path.join(root, "artifacts", "evaluations", "latest.json");
const remediationPath = path.join(root, "artifacts", "evaluations", "L10-after-fix.json");
const outputDir = path.join(root, "artifacts", "evaluations");

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(review) {
  const headers = [
    "case_id",
    "category",
    "input",
    "source_status",
    "source_passed",
    "source_evidence",
    "redline_candidates",
    ...EVAL_DIMENSIONS.map(dimensionScoreField),
    "dimension_total_0_6",
    "redline_reviewed",
    "redline_ids",
    "decision",
    "reviewer",
    "reviewed_at",
    "notes",
  ];
  const rows = review.cases.map((item) => [
    item.id,
    item.category,
    item.input,
    item.sourceResult.actualStatus,
    item.sourceResult.passed,
    `${item.sourceResult.evidencePassed}/${item.sourceResult.evidenceTotal}`,
    item.reviewHints.redlineCandidateIds.join("|"),
    ...EVAL_DIMENSIONS.map((dimension) => ""),
    "",
    "",
    "",
    "pending",
    "",
    "",
    "",
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function toMarkdown(review) {
  const dimensionTable = [
    "| 维度 | 得分 | 判定口径 |",
    "| --- | ---: | --- |",
    ...EVAL_DIMENSIONS.map((item) => `| ${item.label} | 0 或 1 | ${item.criteria} |`),
  ].join("\n");
  const caseSections = review.cases.map((item) => {
    const evidence = item.automatedEvidenceChecks.length
      ? item.automatedEvidenceChecks.map((check) => `- ${check.pass ? "通过" : "未通过"}：${check.label} — ${check.detail}`).join("\n")
      : "- 真实条件未触发，无可评分证据。";
    const remediation = item.remediationEvidence
      ? `\n- 后续定向复测：${item.remediationEvidence.summary}（${item.remediationEvidence.sourceFile}）`
      : "";
    return `## ${item.id} · ${item.category}

输入：${item.input}

- 原始状态：${item.sourceResult.actualStatus}
- 自动证据：${item.sourceResult.evidencePassed}/${item.sourceResult.evidenceTotal}
- 工具调用：${item.sourceResult.toolCalls}
- 待复核红线：${item.reviewHints.redlineCandidateIds.join("、") || "无规则预警"}${remediation}

${evidence}

人工评分：需求 __/1；事实 __/1；可行性 __/1；权限 __/1；数据状态 __/1；可执行性 __/1；红线确认 __。六项全为 1 且红线为 0 才通过。`;
  }).join("\n\n");
  return `# 人工评分复核包

原始评测完成时间：${review.sourceCompletedAt ?? "未知"}

当前门禁：${review.suiteGate.status}。必须把评分和红线结论填入 \`manual-review.csv\`，再执行 \`npm run eval:review:finalize\`。

${dimensionTable}

${caseSections}
`;
}

const source = await readJson(evaluationPath);
let remediation = null;
try {
  const raw = await readJson(remediationPath);
  remediation = {
    caseId: raw.case?.id,
    passed: Boolean(raw.audit?.complete),
    sourceFile: "L10-after-fix.json",
    summary: raw.audit?.complete ? "定向复测通过，待全量回归后替换源记录" : "定向复测未通过",
  };
} catch {
  remediation = null;
}

const review = createManualReviewTemplate(source, { remediations: remediation ? [remediation] : [] });
const jsonFile = path.join(outputDir, "manual-review.json");
const csvFile = path.join(outputDir, "manual-review.csv");
const markdownFile = path.join(outputDir, "manual-review.md");
await mkdir(outputDir, { recursive: true });
await Promise.all([
  writeFile(jsonFile, `${JSON.stringify(review, null, 2)}\n`, "utf8"),
  writeFile(csvFile, toCsv(review), "utf8"),
  writeFile(markdownFile, toMarkdown(review), "utf8"),
]);

console.log(`人工评分模板已生成：${jsonFile}`);
console.log(`可直接填写的评分表：${csvFile}`);
console.log(`逐案复核包：${markdownFile}`);
console.log("人工字段保持空白；未完成评分和红线确认时，发布门禁保持 pending_human_review。 ");
