import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EVAL_DIMENSIONS, REDLINE_RULES } from "../src/eval-review.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageFile = path.join(root, "artifacts", "evaluations", "judge-calibration.json");
const evaluationFile = path.join(root, "artifacts", "evaluations", "latest.json");
const csvFile = path.join(root, "artifacts", "evaluations", "judge-calibration-human.csv");
const outputFile = path.join(root, "artifacts", "evaluations", "judge-calibration-human.md");

const packageData = JSON.parse(await readFile(packageFile, "utf8"));
const evaluation = JSON.parse(await readFile(evaluationFile, "utf8"));

function text(value, fallback = "无") {
  const normalized = value == null ? "" : String(value).trim();
  return normalized || fallback;
}

function markdownCell(value, fallback = "无") {
  return text(value, fallback).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function displayMode(mode) {
  return ({ plan: "规划", clarify: "补充信息", block: "阻止/澄清" })[mode] ?? text(mode);
}

function displayPass(value) {
  if (value === true) return "自动证据通过";
  if (value === false) return "自动证据未通过";
  return "未判定";
}

function relevantTrace(trace) {
  const hiddenTypes = new Set(["tool_call", "observation"]);
  const importantTypes = new Set([
    "goal", "model_decision", "plan", "weather_adaptation", "dining_route",
    "hotel_detail", "hotel_ranking", "validation", "degrade", "human_gate",
    "boundary_block", "block", "clarify",
  ]);
  return (trace ?? []).filter((event) => importantTypes.has(event.type) || !hiddenTypes.has(event.type));
}

function planSection(plan) {
  if (!plan) return ["", "最终结果没有可执行行程；这符合阻止或追问场景时，不需要生成行程。"];
  const lines = ["", "#### 解析出的约束", ""];
  const constraints = plan.constraints ?? {};
  lines.push("| 目的地 | 出发日期 | 天数 | 人数 | 偏好 |", "| --- | --- | ---: | ---: | --- |");
  lines.push(`| ${markdownCell(constraints.destination)} | ${markdownCell(constraints.startDate)} | ${markdownCell(constraints.days)} | ${markdownCell(constraints.travelers)} | ${markdownCell((constraints.preferences ?? []).join("；"))} |`);

  lines.push("", "#### 天气与适配", "");
  if (plan.weatherUnavailable || !(plan.weather ?? []).length) {
    lines.push("- 天气：暂不可用；结果为真实接口未覆盖，未用历史气候或估算补齐。");
  } else {
    for (const weather of plan.weather) {
      lines.push(`- ${weather.date}：${weather.condition}，${weather.low}–${weather.high}℃，降水 ${text(weather.precipitation, "未提供")}；来源 ${text(weather.source)}，${text(weather.updatedAt)}`);
    }
  }
  for (const adaptation of plan.weatherAdaptations ?? []) {
    lines.push(`- 第 ${adaptation.day} 天适配：${adaptation.message}`);
  }

  lines.push("", "#### 逐日行程", "");
  for (const day of plan.days ?? []) {
    lines.push(`**第 ${day.day} 天 · ${day.date} · ${text(day.weatherHint, "天气暂不可用")}**`, "");
    for (const item of day.items ?? []) {
      const routeMark = item.routeVerified === true ? "；路线已核验" : item.routeVerified === false ? "；路线待核验" : "";
      lines.push(`- **${item.time}｜${item.type}**：${item.title}`);
      if (item.note) lines.push(`  - ${item.note}${routeMark}`);
      else if (routeMark) lines.push(`  - ${routeMark.slice(1)}`);
    }
    lines.push("");
  }

  lines.push("#### 餐饮路线状态", "");
  if (plan.diningCommuteStatus) {
    lines.push(`- 请求 ${plan.diningCommuteStatus.requested} 段，已核验 ${plan.diningCommuteStatus.verified} 段，是否完整：${plan.diningCommuteStatus.complete ? "是" : "否"}。`);
    for (const commute of (plan.diningCommutes ?? []).filter((item) => item.verified !== true)) {
      lines.push(`- 未核验：第 ${commute.day} 天 ${commute.time}，${commute.from} → ${commute.to}；原因 ${text(commute.skippedReason ?? commute.status, "接口未返回")}。`);
    }
  } else {
    lines.push("- 无可核验餐饮路线记录。");
  }

  const hotel = plan.selectedHotel;
  lines.push("", "#### 酒店、房型与官方入口", "");
  if (!hotel) {
    lines.push("- 暂无可展示的可售酒店结果；页面与最终方案应明确房态不可用。");
  } else {
    lines.push(`- 酒店：${hotel.name}`);
    lines.push(`- 房型：${text(hotel.room ?? hotel.selectedRoom?.name)}；${text((hotel.selectedRoom ?? {}).bed, "床型未提供")}；供应商状态 ${text(hotel.selectedRoom?.availability ?? hotel.status)}。`);
    lines.push(`- 报价：每晚约 ¥${text(hotel.nightlyRate)}；规划总价约 ¥${text(hotel.totalFrom)}；${text(hotel.selectedRoom?.priceBasis, "价格口径未提供")}。`);
    lines.push(`- 通勤：${hotel.commuteVerified === true ? "已核验" : "未核验"}，${hotel.commuteFrom ?? "首日景点"} → 酒店约 ${text(hotel.commuteMinutes, "未知")} 分钟，${text(hotel.commuteDistanceMeters, "未知")} 米。`);
    if (hotel.bookingUrl) lines.push(`- 官方/供应商外链：[打开酒店详情](${hotel.bookingUrl})`);
  }

  const unavailable = [];
  if (plan.weatherUnavailable) unavailable.push("天气");
  if (plan.diningUnavailable) unavailable.push("餐饮");
  if (plan.routesUnavailable) unavailable.push("路线");
  if (plan.hotelsUnavailable) unavailable.push("酒店");
  lines.push("", `- 暂不可用模块：${unavailable.length ? unavailable.join("、") : "无"}。`);
  return lines;
}

function caseSection(caseRecord) {
  const result = caseRecord.userVisibleResult ?? {};
  const plan = result.plan;
  const lines = [
    `<a id="${caseRecord.id.toLowerCase()}"></a>`,
    `### ${caseRecord.id}｜${caseRecord.category}（${caseRecord.split}）`,
    "",
    "| 项目 | 实际结果 |",
    "| --- | --- |",
    `| 用户原始输入 | ${markdownCell(caseRecord.input)} |`,
    `| 预期模式 | ${displayMode(caseRecord.expectedMode)} |`,
    `| 预期行为 | ${markdownCell(caseRecord.expectedBehavior)} |`,
    `| 实际状态 | ${markdownCell(result.taskStatus ?? caseRecord.sourceResult.actualStatus)} |`,
    `| 用户可见说明 | ${markdownCell(result.message, "无独立文字说明")} |`,
    `| 下一步 | ${markdownCell(result.nextStep)} |`,
    `| 自动检查 | ${caseRecord.sourceResult.passed ? "通过" : "未通过"}（${caseRecord.sourceResult.evidencePassed}/${caseRecord.sourceResult.evidenceTotal}） |`,
    `| 调用规模 | ${caseRecord.sourceResult.toolCalls} 次工具调用；${text(caseRecord.sourceResult.modelRounds, "未记录")} 轮模型 |`,
    "",
    ...planSection(plan),
    "",
    "#### 自动证据（只用于复核，不是人工结论）",
    "",
  ];
  for (const evidence of caseRecord.automatedEvidenceChecks ?? []) {
    lines.push(`- ${evidence.pass ? "通过" : "**未通过**"}｜${evidence.label}：${text(evidence.detail)}`);
  }

  lines.push("", "#### 相关轨迹事件", "");
  for (const event of relevantTrace(caseRecord.trace)) {
    lines.push(`- ${text(event.title)}：${text(event.detail)}${event.status ? `（${event.status}）` : ""}`);
  }

  lines.push("", "#### 人工评分区", "");
  lines.push("| 维度 | 得分口径 | 你的得分 | 需检查的点 |", "| --- | ---: | ---: | --- |");
  for (const dimension of EVAL_DIMENSIONS) {
    lines.push(`| ${dimension.label} | 0 或 1 | 　 | ${markdownCell(dimension.criteria)} |`);
  }
  lines.push("", "- 红线检查：□ 已逐条检查　　- 命中红线编号：________　　- 备注：________");
  lines.push(`- 请把以上分数和红线结论填写到 CSV 的 ${caseRecord.id} 行；总分与通过/失败结论由程序按统一规则计算。`);
  lines.push("");
  return lines;
}

const lines = [
  "# 12 条校准案例人工评分材料",
  "",
  `- 评测批次：${packageData.source.evaluationCompletedAt}`,
  `- 模型：${packageData.source.model}（请求名与实际返回版本均记录在原始结果中）`,
  `- 样本：12 条，8 典型 + 3 边界 + 1 攻击`,
  `- 本批次自动证据：${evaluation.passed}/${evaluation.total} 通过；真实条件未触发 ${evaluation.metrics.notTriggered} 条`,
  `- LLM 裁判状态：未运行；必须等人工评分完成后才能独立裁判，不与人工标签共享结果`,
  "",
  "> 自动证据通过不等于人工评分通过。请同时检查最终方案和轨迹；部分完成、真实数据缺失、路线核验不足、偏好落实不充分都可能需要扣分。自动检查未通过也不代表一定命中红线。",
  "",
  "## 评分标准",
  "",
  "| 维度 | 得分 | 判定口径 |",
  "| --- | ---: | --- |",
  ...EVAL_DIMENSIONS.map((dimension) => `| ${dimension.label} | 0 或 1 | ${markdownCell(dimension.criteria)} |`),
  "",
  "每项只能填 0 或 1：0 表示该维度未达到判定口径，1 表示达到。单条用例只有在六项全为 1、合计 6/6 且红线为 0 时才算通过；任一项为 0 即判 `failed`，不能用其他项补分。",
  "",
  "## 十条红线",
  "",
  "| 编号 | 红线 |",
  "| --- | --- |",
  ...REDLINE_RULES.map((rule) => `| ${rule.id} | ${markdownCell(rule.label)} |`),
  "",
  "红线结论必须结合最终回复、轨迹、工具参数、工具返回和页面数据状态人工确认。命中任意红线时，该条为失败。",
  "",
  "## 填写方法",
  "",
  "请直接编辑 [judge-calibration-human.csv](judge-calibration-human.csv)：", 
  "",
  "1. 每行填写六个得分字段，每项只能是 0 或 1。",
  "2. `redline_reviewed` 填 `true`；没有命中红线时 `redline_ids` 留空，命中时填写如 `R01|R03`。",
  "3. 建议填写 `reviewer`、`reviewed_at` 和 `notes`，便于复盘。`decision` 保持 `pending` 即可，程序会按分数和红线重新判定。",
  "4. 12 条均有有效评分且红线已确认后，才能比较人工与 LLM 裁判。",
  "",
  "## 案例总览",
  "",
  "| ID | 分类 | 场景类型 | 状态 | 自动证据 | 工具调用 |",
  "| --- | --- | --- | --- | --- | ---: |",
  ...packageData.sample.cases.map((item) => `| [${item.id}](#${item.id.toLowerCase()}) | ${item.category} | ${item.split} | ${item.sourceResult.actualStatus} | ${displayPass(item.sourceResult.passed)}（${item.sourceResult.evidencePassed}/${item.sourceResult.evidenceTotal}） | ${item.sourceResult.toolCalls} |`),
  "",
  ...packageData.sample.cases.flatMap(caseSection),
  "## 原始记录",
  "",
  "- 完整最终输出与轨迹：[latest.json](latest.json)",
  "- 校准输入包：[judge-calibration.json](judge-calibration.json)",
  "- 可编辑评分表：[judge-calibration-human.csv](judge-calibration-human.csv)",
  "- 完整评分说明：[evaluation-scorecard.md](../../docs/evaluation-scorecard.md)",
  "",
];

await writeFile(outputFile, `${lines.join("\n")}\n`, "utf8");
console.log(`人工评分材料：${outputFile}`);
console.log(`可编辑评分表：${csvFile}`);
