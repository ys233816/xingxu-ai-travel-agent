import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EVAL_DIMENSIONS } from "../src/eval-review.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resultFile = path.join(root, "artifacts", "evaluations", "llm-judge-40-result.json");
const reportFile = path.join(root, "artifacts", "evaluations", "llm-judge-40-report.md");
const result = JSON.parse(await readFile(resultFile, "utf8"));

const decisionLabel = { passed: "通过", failed: "失败" };
const dimensionHeaders = EVAL_DIMENSIONS.map((item) => item.label).join(" | ");
const dimensionDividers = EVAL_DIMENSIONS.map(() => "---").join(" | ");

function countBy(items, key) {
  return items.reduce((counts, item) => {
    const value = key(item);
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

const scored = result.cases.filter((item) => item.judgeStatus === "evaluated");
const redlineCounts = countBy(scored.flatMap((item) => item.redlineIds), (id) => id);
const lines = [
  "# 40 条 LLM 裁判结果",
  "",
  `生成时间：${result.completedAt}`,
  "",
  "## 门禁与可追溯信息",
  "",
  `- 12 条人工金标校准：决策一致率 ${(result.calibration.passAgreement * 100).toFixed(1)}%，红线一致率 ${(result.calibration.redlineAgreement * 100).toFixed(1)}%。`,
  `- 裁判 Prompt：\`${result.judge.prompt.version}\`，指纹 \`${result.judge.prompt.sha256}\`。`,
  `- 裁判模型：请求 \`${result.judge.requestedModel}\`；供应商返回 ${result.judge.reportedModels.length ? result.judge.reportedModels.map((item) => `\`${item}\``).join("、") : "未报告具体版本"}。`,
  `- Agent 评测集：\`${result.sourceEvaluation.versions?.evaluation?.version ?? "未记录"}\`；Agent Prompt：${(result.sourceEvaluation.versions?.prompt ?? []).map((item) => `\`${item}\``).join("、") || "未记录"}；工具契约：${(result.sourceEvaluation.versions?.tools ?? []).map((item) => `\`${item}\``).join("、") || "未记录"}。`,
  `- 逻辑裁判调用：${result.judge.callCount} 次；API 尝试：${result.judge.apiAttemptCount} 次；裁判 Token 成本：${result.judge.cost.status === "calculated" ? `${result.judge.cost.amount} ${result.judge.cost.currency}` : "不可计算"}。`,
  "",
  "## 覆盖与结论",
  "",
  `- 总用例：${result.summary.total}；已机评：${result.summary.evaluated}；通过：${result.summary.passed}；失败：${result.summary.failed}；未评估：${result.summary.notEvaluated}。`,
  `- 命中红线的已评用例：${result.summary.redlineCases}；红线分布：${Object.keys(redlineCounts).length ? Object.entries(redlineCounts).map(([id, count]) => `${id} × ${count}`).join("，") : "无"}。`,
  "",
  "| 分层 | 总数 | 已评 | 通过 | 失败 | 未评估 |",
  "| --- | ---: | ---: | ---: | ---: | ---: |",
  ...Object.entries(result.summary.bySplit).map(([split, summary]) => `| ${split} | ${summary.total} | ${summary.evaluated} | ${summary.passed} | ${summary.failed} | ${summary.notEvaluated} |`),
  "",
  "## 逐条结果",
  "",
  `| 用例 | 分层 | 角色 | ${dimensionHeaders} | 总分 | 结论 | 红线 | 评测状态 |`,
  `| --- | --- | --- | ${dimensionDividers} | ---: | --- | --- | --- |`,
  ...result.cases.map((item) => {
    if (item.judgeStatus !== "evaluated") {
      return `| ${item.id} | ${item.split} | ${item.evaluationRole} | ${EVAL_DIMENSIONS.map(() => "—").join(" | ")} | — | 未评估 | — | ${item.reason} |`;
    }
    const dimensionScores = EVAL_DIMENSIONS.map((dimension) => item.scores[dimension.id]).join(" | ");
    return `| ${item.id} | ${item.split} | ${item.evaluationRole} | ${dimensionScores} | ${item.total}/6 | ${decisionLabel[item.decision]} | ${item.redlineIds.join("、") || "无"} | 已评 |`;
  }),
  "",
  "## 限制",
  "",
  "- 规划器与裁判均为 DeepSeek，虽使用独立 Prompt 和独立请求，仍可能存在同模型相关偏差；不能把机评等同人工真值。",
  "- 12 条人工金标允许 1 条通过/失败分歧（实际 11/12 一致），但红线判断必须保持 12/12 一致。",
  "- 未触发或不完整的用例保留为 `not_evaluated`，不从期望行为、Mock 或故障注入补分。",
  "- 外部天气、地图与酒店接口的调用费用没有统一单价，不计入模型 Token 成本。",
  "",
];

await writeFile(reportFile, `${lines.join("\n")}\n`, "utf8");
console.log(`报告文件：${reportFile}`);
