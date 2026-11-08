import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { csvRowsToObjects, parseCsv } from "../src/csv.js";
import { mergeHumanCalibrationRecords } from "../src/llm-judge.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "artifacts", "evaluations");
const packageFile = path.join(outputDir, "judge-calibration.json");
const humanCsvFile = path.join(outputDir, "judge-calibration-human.csv");
const readyFile = path.join(outputDir, "judge-calibration-ready.json");

const packageData = JSON.parse(await readFile(packageFile, "utf8"));
const records = csvRowsToObjects(parseCsv(await readFile(humanCsvFile, "utf8")));
const reviewed = mergeHumanCalibrationRecords(packageData, records);
await writeFile(packageFile, `${JSON.stringify(reviewed, null, 2)}\n`, "utf8");

console.log(`人工校准评分：${reviewed.humanReadiness.completed}/${reviewed.humanReadiness.total}`);
if (reviewed.status !== "ready_for_judge") {
  console.error(`仍需完成：${reviewed.humanReadiness.pendingCaseIds.join("、")}`);
  process.exitCode = 2;
} else {
  await writeFile(readyFile, `${JSON.stringify(reviewed, null, 2)}\n`, "utf8");
  console.log(`校准样本已就绪，禁止跳过付费确认：npm run judge:run -- --confirm-costs`);
  console.log(`就绪文件：${readyFile}`);
}
