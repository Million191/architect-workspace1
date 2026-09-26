#!/usr/bin/env node
// Plain script, no test framework: run with `node check-idempotency.js`
// (or `npm test`). Exits non-zero on failure so it can gate a build.
//
// Proves confirm's send is idempotent: with VENDOR_MODE=ok, running
// `confirm 4001` twice must append exactly ONE line for 4001 to
// data/sent.log, and the second run must report "duplicate: true".

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ORDER_ID = "4001";
const DATA_DIR = path.join(__dirname, "data");
const LOG_PATH = path.join(DATA_DIR, "sent.log");
const KEYS_PATH = path.join(DATA_DIR, "keys.json");
const DESK_PATH = path.join(__dirname, "desk.js");

function readLines(filePath) {
  try {
    return fs
      .readFileSync(filePath, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

function writeLines(filePath, lines) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.length > 0 ? lines.join("\n") + "\n" : "");
}

// Reset any state left over from a previous run of this test (or of
// `confirm 4001` by hand) so the test is itself safe to re-run.
function resetOrderState(orderId) {
  const sentLines = readLines(LOG_PATH).filter((line) => JSON.parse(line).orderId !== orderId);
  writeLines(LOG_PATH, sentLines);

  let keys = {};
  try {
    keys = JSON.parse(fs.readFileSync(KEYS_PATH, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  delete keys[`order:${orderId}`];
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(KEYS_PATH, JSON.stringify(keys, null, 2));
}

function runConfirm(orderId) {
  const result = spawnSync(process.execPath, [DESK_PATH, "confirm", orderId], {
    cwd: __dirname,
    env: { ...process.env, VENDOR_MODE: "ok" },
    encoding: "utf8",
  });
  return result.stdout + result.stderr;
}

function countLinesForOrder(orderId) {
  return readLines(LOG_PATH).filter((line) => JSON.parse(line).orderId === orderId).length;
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function main() {
  resetOrderState(ORDER_ID);

  const firstOutput = runConfirm(ORDER_ID);
  if (!/duplicate: false/.test(firstOutput)) {
    fail(`first run should report "duplicate: false"; got:\n${firstOutput}`);
  }

  const secondOutput = runConfirm(ORDER_ID);
  if (!/duplicate: true/.test(secondOutput)) {
    fail(`second run should report "duplicate: true"; got:\n${secondOutput}`);
  }

  const lineCount = countLinesForOrder(ORDER_ID);
  if (lineCount !== 1) {
    fail(`data/sent.log should have exactly 1 line for order ${ORDER_ID}, found ${lineCount}`);
  }

  console.log(`PASS: order ${ORDER_ID} sent exactly once (${lineCount} line in sent.log), second confirm reported duplicate: true`);
}

main();
