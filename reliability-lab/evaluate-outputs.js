#!/usr/bin/env node
// Evaluates a batch of AI-generated order-confirmation messages (from the
// same vendor.js stand-in desk.js calls) against the quality gate criteria
// defined earlier this session: Accuracy, Relevance, Safety, Consistency,
// (simulated) User Feedback, and Performance.
//
// Reuses this repo's existing scoreBreakdown()/QUALITY_THRESHOLD from
// reliability.js rather than building a second, parallel rubric:
//   - Accuracy    -> exact order id present as a whole token   (40 pts)
//   - Safety      -> no disclaimer/refusal phrase               (30 pts)
//   - Relevance   -> length within the expected reply envelope  (30 pts)
// This script adds the two axes that gate was never built to measure on
// its own: Consistency (does the same input score the same way every
// time?) and Performance (latency per call). "User Feedback" is
// simulated here as an acceptance-verdict bucket derived from score,
// standing in for what a human reviewer's disposition would likely be
// (auto-accept / accept-with-edit / reject) until real feedback data exists.

const { scoreBreakdown, QUALITY_THRESHOLD } = require("./reliability");
const { getConfirmationMessage } = require("./vendor");

const ORDER_IDS = ["4001", "4002", "4003", "4004", "4005"];
const MODES = ["ok", "garbage"];

async function timedCall(orderId, mode) {
  process.env.VENDOR_MODE = mode;
  const start = Date.now();
  const message = await getConfirmationMessage(orderId);
  return { message, latencyMs: Date.now() - start };
}

function acceptanceVerdict(score) {
  if (score >= 90) return "auto-accept";
  if (score >= QUALITY_THRESHOLD) return "accept (borderline)";
  return "reject";
}

async function evaluateOne(orderId, mode) {
  const { message, latencyMs } = await timedCall(orderId, mode);
  const { score, reasons } = scoreBreakdown(message, orderId);
  return { orderId, mode, message, latencyMs, score, reasons, verdict: acceptanceVerdict(score) };
}

async function checkConsistency(orderId, mode, runs = 5) {
  const results = [];
  for (let i = 0; i < runs; i++) {
    results.push(await evaluateOne(orderId, mode));
  }
  const scores = results.map((r) => r.score);
  const stable = scores.every((s) => s === scores[0]);
  return { orderId, mode, scores, stable };
}

function printRow(row) {
  const reasonsPart = row.reasons.length ? ` | reasons: ${row.reasons.join("; ")}` : "";
  console.log(
    `  [${row.mode.padEnd(7)}] order ${row.orderId}  score=${String(row.score).padStart(3)}  ` +
      `verdict=${row.verdict.padEnd(20)} latency=${row.latencyMs}ms${reasonsPart}`
  );
}

async function main() {
  console.log("=== Per-output evaluation (Accuracy / Safety / Relevance via scoreBreakdown) ===");
  const rows = [];
  for (const mode of MODES) {
    for (const orderId of ORDER_IDS) {
      const row = await evaluateOne(orderId, mode);
      rows.push(row);
      printRow(row);
    }
  }

  console.log("\n=== Consistency check: same input run 5x ===");
  const consistencyOk = await checkConsistency("5001", "ok");
  console.log(`  [ok]      order 5001 scores: [${consistencyOk.scores.join(", ")}]  stable=${consistencyOk.stable}`);
  const consistencyGarbage = await checkConsistency("5002", "garbage");
  console.log(
    `  [garbage] order 5002 scores: [${consistencyGarbage.scores.join(", ")}]  stable=${consistencyGarbage.stable}`
  );

  console.log("\n=== Summary ===");
  const byMode = {};
  for (const row of rows) {
    byMode[row.mode] = byMode[row.mode] || { total: 0, passed: 0, latencies: [] };
    byMode[row.mode].total += 1;
    byMode[row.mode].latencies.push(row.latencyMs);
    if (row.score >= QUALITY_THRESHOLD) byMode[row.mode].passed += 1;
  }
  for (const [mode, stats] of Object.entries(byMode)) {
    const avgLatency = Math.round(stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length);
    console.log(
      `  [${mode}] ${stats.passed}/${stats.total} pass the quality gate (threshold ${QUALITY_THRESHOLD}), ` +
        `avg latency ${avgLatency}ms`
    );
  }
  console.log(`  Consistency: ok=${consistencyOk.stable ? "STABLE" : "UNSTABLE"}, garbage=${consistencyGarbage.stable ? "STABLE" : "UNSTABLE"}`);
}

main();
