import { createRequire } from "node:module";
import assert from "node:assert/strict";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/17330/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const artifacts = path.resolve("artifacts");
const baseUrl = process.env.AGENT_BASE_URL || "http://127.0.0.1:4173";
const runRealPlan = process.env.VISUAL_REAL_PLAN === "true";

const browser = await chromium.launch({ headless: true, executablePath: edge });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => errors.push(`page: ${error.message}`));

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.waitForSelector("#runtimeFlag");
async function openScenario() {
  await page.locator(".scenario-section").evaluate((node) => { node.open = true; });
}
const evaluationUiCount = await page.locator("#evalButton, #evalDialog").count();
assert.equal(evaluationUiCount, 0, "网页中不应保留评测入口或评测弹窗");
await page.screenshot({ path: path.join(artifacts, "agent-desktop.png"), fullPage: true, animations: "disabled" });

const desktop = await page.evaluate(() => ({
  title: document.querySelector("#outputTitle")?.textContent,
  runtimeFlag: document.querySelector("#runtimeFlag")?.textContent,
  eventCount: document.querySelectorAll(".trace-event").length,
  toolMetric: document.querySelector("#toolCallMetric")?.textContent,
  taskStatus: document.querySelector("#taskStatus")?.textContent,
  bodyScrollWidth: document.body.scrollWidth,
  viewportWidth: window.innerWidth,
}));

let realPlan = null;
let realPlanMobile = null;
if (runRealPlan) {
  await openScenario();
  await page.click('[data-scenario="happy"]');
  await page.waitForFunction(() => document.querySelector("#planVersion")?.textContent !== "v0", null, { timeout: 120000 });
  await page.waitForSelector(".hotel-card");
  realPlan = await page.evaluate(() => ({
    roomRows: document.querySelectorAll(".room-row").length,
    hasRoomUnavailable: Boolean(document.querySelector(".room-empty")),
    hotelCards: document.querySelectorAll(".hotel-card").length,
    selectedHotel: document.querySelector(".hotel-card.is-selected .hotel-name-row strong")?.textContent ?? null,
    selectedRoom: document.querySelector(".room-row.is-selected-room .room-name-line strong")?.textContent ?? null,
    selectedRoomPrice: document.querySelector(".room-row.is-selected-room .room-price strong")?.textContent ?? null,
    diningCards: document.querySelectorAll(".dining-card").length,
    lunchTitle: [...document.querySelectorAll(".itinerary-item")].find((item) => item.textContent.includes("午餐"))?.querySelector(".itinerary-title")?.textContent ?? null,
    dinnerTitle: [...document.querySelectorAll(".itinerary-item")].find((item) => item.textContent.includes("晚餐"))?.querySelector(".itinerary-title")?.textContent ?? null,
    attractionOpenVisible: [...document.querySelectorAll(".itinerary-note")].some((item) => item.textContent.includes("开放：")),
    diningRouteProofs: document.querySelectorAll(".itinerary-route-proof").length,
    hasBudgetSection: Boolean(document.querySelector(".budget-box, .budget-line, [data-budget-section]")),
    detailLinks: document.querySelectorAll(".hotel-detail-link[href^='https://']").length,
    horizontalOverflow: document.body.scrollWidth > window.innerWidth,
  }));
  assert.ok(realPlan.hotelCards > 0, "真实规划应展示酒店候选");
  assert.ok(realPlan.roomRows > 0 || realPlan.hasRoomUnavailable, "真实规划应展示房型或明确的暂不可用房态");
  assert.ok(realPlan.diningCards > 0, "真实规划应展示餐饮候选");
  assert.match(realPlan.lunchTitle ?? "", /真实餐厅|暂无匹配/, "午餐应来自真实餐饮结果或明确待补充");
  assert.match(realPlan.dinnerTitle ?? "", /真实餐厅|暂无匹配/, "晚餐应来自真实餐饮结果或明确待补充");
  assert.equal(realPlan.attractionOpenVisible, true, "逐日行程应展示景点营业时间状态");
  assert.ok(realPlan.diningRouteProofs >= 6, "三天行程每天的午餐与晚餐都应展示已核验的真实路线");
  if (realPlan.selectedRoom) assert.ok(realPlan.selectedRoomPrice, "选中房型应展示供应商价格");
  assert.equal(realPlan.hasBudgetSection, false, "页面不应再出现预算汇总区域");
  assert.equal(realPlan.horizontalOverflow, false, "桌面端方案不应横向溢出");
  await page.screenshot({ path: path.join(artifacts, "agent-real-plan-desktop.png"), fullPage: true, animations: "disabled" });
  await page.locator(".hotel-list").scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(artifacts, "agent-real-hotel-desktop.png"), fullPage: true, animations: "disabled" });
  if (await page.locator(".hotel-card.is-selected").count()) {
    await page.locator(".hotel-card.is-selected").screenshot({ path: path.join(artifacts, "agent-selected-hotel-desktop.png"), animations: "disabled" });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  realPlanMobile = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    roomRows: document.querySelectorAll(".room-row").length,
    clippedRoomNames: [...document.querySelectorAll(".room-name-line strong")].some((node) => node.scrollWidth > node.clientWidth),
    hasBudgetSection: Boolean(document.querySelector(".budget-box, .budget-line, [data-budget-section]")),
  }));
  assert.equal(realPlanMobile.hasBudgetSection, false, "移动端页面不应出现预算汇总区域");
  assert.equal(realPlanMobile.bodyScrollWidth > realPlanMobile.viewportWidth, false, "移动端方案不应横向溢出");
  assert.equal(realPlanMobile.clippedRoomNames, false, "移动端房型名称不应被截断");
  await page.screenshot({ path: path.join(artifacts, "agent-real-plan-mobile.png"), fullPage: true, animations: "disabled" });
  await page.locator(".hotel-list").scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(artifacts, "agent-real-hotel-mobile.png"), fullPage: true, animations: "disabled" });
  if (await page.locator(".hotel-card.is-selected").count()) {
    await page.locator(".hotel-card.is-selected").screenshot({ path: path.join(artifacts, "agent-selected-hotel-mobile.png"), animations: "disabled" });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

await page.click("#toolMapButton");
await page.waitForSelector("#toolTableBody tr");
const toolRows = await page.locator("#toolTableBody tr").count();
const contractCards = await page.locator("#permissionContractGrid .permission-contract-card").count();
const evidenceRows = await page.locator("#evidenceMapList .evidence-map-row").count();
assert.equal(evidenceRows, 10, "工具地图应展示 10 条固定证据映射");
await page.screenshot({ path: path.join(artifacts, "tool-map.png"), fullPage: true, animations: "disabled" });
await page.locator(".evidence-map-section").screenshot({ path: path.join(artifacts, "evidence-map.png"), animations: "disabled" });
await page.click('[data-close-dialog="toolMapDialog"]');

await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: path.join(artifacts, "agent-mobile-initial.png"), fullPage: true, animations: "disabled" });
const initialMobile = await page.evaluate(() => ({
  bodyScrollWidth: document.body.scrollWidth,
  viewportWidth: window.innerWidth,
  panelColumns: getComputedStyle(document.querySelector(".workspace")).gridTemplateColumns,
}));
assert.equal(initialMobile.bodyScrollWidth > initialMobile.viewportWidth, false, "移动端首屏不应横向溢出");
await page.setViewportSize({ width: 1440, height: 1000 });

await openScenario();
await page.click('[data-scenario="boundary"]');
await page.waitForFunction(() => document.querySelector("#planState")?.textContent.includes("拦截"), null, { timeout: 15000 });
const blocked = await page.evaluate(() => ({
  taskStatus: document.querySelector("#taskStatus")?.textContent,
  planState: document.querySelector("#planState")?.textContent,
  toolMetric: document.querySelector("#toolCallMetric")?.textContent,
  evidenceAudit: document.querySelector(".trace-evidence-head strong")?.textContent,
}));

await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: path.join(artifacts, "agent-mobile.png"), fullPage: true, animations: "disabled" });
const mobile = await page.evaluate(() => ({
  bodyScrollWidth: document.body.scrollWidth,
  viewportWidth: window.innerWidth,
  panelColumns: getComputedStyle(document.querySelector(".workspace")).gridTemplateColumns,
}));
assert.equal(mobile.bodyScrollWidth > mobile.viewportWidth, false, "移动端页面不应横向溢出");
assert.deepEqual(errors, [], "页面不应出现控制台或运行时错误");

console.log(JSON.stringify({ desktop, initialMobile, realPlan, realPlanMobile, toolRows, contractCards, evidenceRows, blocked, evaluationUiCount, mobile, errors }, null, 2));
await browser.close();
