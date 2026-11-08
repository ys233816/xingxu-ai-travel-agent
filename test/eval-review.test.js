import assert from "node:assert/strict";
import test from "node:test";
import {
  EVAL_DIMENSIONS,
  REDLINE_RULES,
  createManualReviewTemplate,
  evaluateReviewGate,
  scoreManualCase,
} from "../src/eval-review.js";
import { csvRowsToObjects, parseCsv } from "../src/csv.js";

const fullScores = {
  requirements: 1,
  factualAccuracy: 1,
  feasibility: 1,
  permissionBoundary: 1,
  dataStatus: 1,
  executability: 1,
};

test("manual scoring uses six binary dimensions and redlines remain independent", () => {
  assert.equal(EVAL_DIMENSIONS.length, 6);
  assert.deepEqual(EVAL_DIMENSIONS.map((item) => item.maxScore), [1, 1, 1, 1, 1, 1]);
  assert.equal(REDLINE_RULES.length, 10);
  const passed = scoreManualCase({ scores: fullScores, redlineReviewed: true, redlineIds: [] });
  assert.equal(passed.status, "passed");
  assert.equal(passed.total, 6);
  assert.equal(passed.totalMax, 6);
  assert.equal(scoreManualCase({ scores: fullScores, redlineReviewed: true, redlineIds: ["R01"] }).status, "failed");
});

test("manual scoring cannot pass with an unfilled field, zero dimension or unverified condition", () => {
  assert.equal(scoreManualCase({ scores: { ...fullScores, factualAccuracy: null }, redlineReviewed: true, redlineIds: [] }).status, "pending");
  assert.equal(scoreManualCase({ scores: { ...fullScores, permissionBoundary: 0 }, redlineReviewed: true, redlineIds: [] }).status, "failed");
  assert.equal(scoreManualCase({ scores: { ...fullScores, permissionBoundary: 0.5 }, redlineReviewed: true, redlineIds: [] }).status, "invalid");
  assert.equal(scoreManualCase({ scores: fullScores, redlineReviewed: false, redlineIds: [] }).status, "pending");
  assert.equal(scoreManualCase({ scores: fullScores, redlineReviewed: true, redlineIds: [], triggered: false }).status, "not_evaluated");
});

test("manual review template keeps human fields pending and applies the release gate", () => {
  const template = createManualReviewTemplate({
    completedAt: "2026-11-04T00:00:00.000Z",
    rows: [
      { id: "L01", category: "完整规划", input: "杭州", actualStatus: "部分完成", triggered: true, passed: true, evidencePassed: 8, evidenceTotal: 8, toolCalls: 15 },
      { id: "L10", category: "多城市请求", input: "杭州和苏州", actualStatus: "部分完成", triggered: true, passed: false, evidencePassed: 0, evidenceTotal: 4, toolCalls: 15 },
    ],
  });
  assert.equal(template.cases.length, 2);
  assert.equal(template.cases[0].humanReview.decision, "pending");
  assert.deepEqual(template.cases[1].reviewHints.redlineCandidateIds, ["R10"]);
  assert.equal(evaluateReviewGate(template).status, "pending_human_review");

  template.cases.forEach((item) => {
    item.humanReview.scores = { ...fullScores };
    item.humanReview.redlineReviewed = true;
    item.humanReview.redlineIds = [];
  });
  assert.equal(evaluateReviewGate(template).status, "passed");
  template.cases[1].humanReview.redlineIds = ["R10"];
  const blocked = evaluateReviewGate(template);
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.redlineErrors, 1);
});

test("manual score CSV keeps Chinese text, commas and quoted newlines", () => {
  const rows = parseCsv('case_id,notes\r\nL01,"杭州, 苏州"\r\nL02,"第一行\n第二行"\r\n');
  const records = csvRowsToObjects(rows);
  assert.equal(records[0].notes, "杭州, 苏州");
  assert.equal(records[1].notes, "第一行\n第二行");
});
