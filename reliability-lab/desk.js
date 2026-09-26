#!/usr/bin/env node
// Order desk CLI: confirm <orderId> | replay
//
// Layering, outermost to innermost, for one order:
//   runOnce            -- at most once per order, ever (idempotency key)
//     quality gate      -- is the message worth sending at all?
//       circuit breaker  -- is the vendor worth calling right now?
//         retry           -- worth trying again on THIS call?
//           withTimeout    -- how long is too long for ONE attempt?
//
// Duplicates short-circuit at the runOnce layer, before the quality gate
// ever runs again -- a stored result was already gated once.
//
// Failure handling, in order:
//   - vendor message fails the quality gate -> never sent, never falls
//     back -> dead-letter (a wrong/low-quality message must never go out
//     under any name)
//   - UpstreamUnavailable / BreakerOpen -> degraded fallback message is
//     sent instead (itself gated too), marked {"fallback": true}
//   - fallback message fails the gate, or the fallback send itself
//     throws -> dead-letter
//   - anything else (e.g. every retry attempt timed out) -> dead-letter,
//     since it was not sent and is not fallback-eligible (assumption,
//     logged here: the spec names specific cases but "any order that
//     could not be sent" is the stated general rule)
//
// Every confirm run gets its own correlation id (identifies the RUN, not
// the order -- it is not the idempotency key) stamped on every log line,
// the sent.log line, and any dead-letter row, and ends with one JSON
// receipt line.
//
// replay: re-runs every dead-lettered order through the same path above
// (each with its own fresh correlation id) and rewrites dead-letter.jsonl
// to keep only the orders still unsent.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getConfirmationMessage } = require("./vendor");
const {
  withTimeout,
  retry,
  withCircuitBreaker,
  loadBreakerState,
  runOnce,
  checkQualityGate,
  UpstreamUnavailable,
} = require("./reliability");

const DATA_DIR = path.join(__dirname, "data");
const LOG_PATH = path.join(DATA_DIR, "sent.log");
const DEAD_LETTER_PATH = path.join(DATA_DIR, "dead-letter.jsonl");
const BREAKER_PATH = path.join(DATA_DIR, "breaker.json");
const KEYS_PATH = path.join(DATA_DIR, "keys.json");

const ATTEMPT_TIMEOUT_MS = 2000;
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

function fallbackMessage(orderId) {
  return `Your order ${orderId} is confirmed. Full details will follow shortly.`;
}

// One attempt: ask the vendor inside a 2s deadline. Message QUALITY is not
// judged here -- that is the gate's job, one layer up, applied once to
// whatever message actually ends up being a candidate to send.
function callVendor(orderId) {
  return withTimeout(async () => {
    try {
      return await getConfirmationMessage(orderId);
    } catch (err) {
      if (err.statusCode === 500) throw new UpstreamUnavailable(err.message);
      throw err;
    }
  }, ATTEMPT_TIMEOUT_MS);
}

function logAttempt(correlationId, { attempt, outcome, errorName }) {
  console.log(`[${correlationId}] attempt ${attempt}: ${outcome}${errorName ? ` (${errorName})` : ""}`);
}

function appendJsonLine(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(obj) + "\n");
}

function appendSent(orderId, message, { fallback, correlationId, gateScore }) {
  const sentAt = new Date().toISOString();
  const entry = { orderId, message, sentAt, correlationId, gateScore };
  if (fallback) entry.fallback = true;
  appendJsonLine(LOG_PATH, entry);
  return entry;
}

function deadLetterRow(orderId, err, correlationId) {
  const row = { orderId, errorName: err.name, time: new Date().toISOString(), correlationId };
  if (typeof err.score === "number") row.score = err.score;
  if (err.reasons) row.reasons = err.reasons;
  return row;
}

// Runs the full protected path for one order EXACTLY ONCE per orderId,
// ever (see runOnce below). Resolves with { entry, gateScore, attempts,
// fallbackReason } on any successful send (normal or fallback); throws
// (releasing the idempotency claim, so a later real retry/replay is still
// possible) when the order must be dead-lettered instead. The thrown
// error always carries .attempts, and a QualityGateRejected also carries
// .score/.reasons, so the caller can build a receipt/dead-letter row
// without re-deriving any of it.
async function attemptSend(orderId, correlationId) {
  let attempts = 0;
  let vendorMessage = null;
  let fallbackReason = null;

  try {
    vendorMessage = await withCircuitBreaker(
      () =>
        retry(() => callVendor(orderId), {
          attempts: RETRY_ATTEMPTS,
          baseDelayMs: RETRY_BASE_DELAY_MS,
          onAttempt: (info) => {
            attempts += 1;
            logAttempt(correlationId, info);
          },
        }),
      { statePath: BREAKER_PATH }
    );
  } catch (err) {
    if (err.name !== "UpstreamUnavailable" && err.name !== "BreakerOpen") {
      console.log(`[${correlationId}] desk: not sent (${err.name}): ${err.message}`);
      err.attempts = attempts;
      throw err;
    }
    fallbackReason = err.name;
  }

  const fallback = fallbackReason !== null;
  const message = fallback ? fallbackMessage(orderId) : vendorMessage;

  let gateScore;
  try {
    gateScore = checkQualityGate(message, orderId);
  } catch (gateErr) {
    console.log(
      `[${correlationId}] desk: quality gate rejected the ${fallback ? "fallback" : "vendor"} message, ` +
        `score ${gateErr.score}: ${gateErr.reasons.join("; ")}`
    );
    gateErr.attempts = attempts;
    throw gateErr;
  }

  try {
    const entry = appendSent(orderId, message, { fallback, correlationId, gateScore });
    if (fallback) console.log(`[${correlationId}] desk: falling back after ${fallbackReason}`);
    console.log(`[${correlationId}] desk: quality score ${gateScore}`);
    return { entry, gateScore, attempts, fallbackReason };
  } catch (sendErr) {
    console.log(`[${correlationId}] desk: ${fallback ? "fallback " : ""}send itself failed: ${sendErr.message}`);
    sendErr.name = "FallbackSendFailed";
    sendErr.attempts = attempts;
    throw sendErr;
  }
}

// The key comes from the ORDER ("order:<id>"), never from the attempt --
// a fresh random ID minted at the top of each run would be different
// every time, so runOnce would never recognize a repeat and the dedup
// would protect against nothing.
function idempotencyKeyFor(orderId) {
  return `order:${orderId}`;
}

// Wraps attemptSend in runOnce, keyed by the order. Never throws: returns
// { sent: true, entry, gateScore, attempts, duplicate, fallbackReason } on
// any successful send (this call or a prior one), or { sent: false,
// errorName, gateScore, reasons, attempts } when the order is unsent and
// must be dead-lettered.
async function sendOrder(orderId, correlationId) {
  try {
    const { result, duplicate } = await runOnce(idempotencyKeyFor(orderId), () => attemptSend(orderId, correlationId), {
      keysPath: KEYS_PATH,
    });
    if (duplicate) console.log(`[${correlationId}] desk: duplicate suppressed for order ${orderId}, gate/vendor not re-run`);
    console.log(`[${correlationId}] duplicate: ${duplicate}`);
    return {
      sent: true,
      entry: result.entry,
      gateScore: result.gateScore,
      attempts: duplicate ? 0 : result.attempts,
      duplicate,
      fallbackReason: result.fallbackReason,
    };
  } catch (err) {
    return {
      sent: false,
      errorName: err.name,
      gateScore: typeof err.score === "number" ? err.score : null,
      reasons: err.reasons || null,
      attempts: err.attempts || 0,
      rawError: err,
    };
  }
}

function receiptFor(orderId, correlationId, result) {
  const breaker = loadBreakerState(BREAKER_PATH);
  let outcome;
  let errorName = null;

  if (!result.sent) {
    outcome = "dead-lettered";
    errorName = result.errorName;
  } else if (result.duplicate) {
    outcome = "duplicate";
  } else if (result.entry.fallback) {
    outcome = "fallback";
    errorName = result.fallbackReason;
  } else {
    outcome = "sent";
  }

  return {
    orderId,
    correlationId,
    attempts: result.attempts,
    breakerState: breaker.isOpen ? "open" : "closed",
    gateScore: result.gateScore,
    outcome,
    errorName,
  };
}

async function confirm(orderId) {
  const correlationId = crypto.randomUUID();
  const result = await sendOrder(orderId, correlationId);

  if (!result.sent) {
    const row = deadLetterRow(orderId, result.rawError, correlationId);
    appendJsonLine(DEAD_LETTER_PATH, row);
    console.log(`[${correlationId}] Appended to dead-letter: ${orderId} (${result.errorName})`);
    process.exitCode = 1;
  } else {
    console.log(`[${correlationId}] Vendor message: ${result.entry.message}`);
    console.log(
      `[${correlationId}] Appended to ${path.relative(process.cwd(), LOG_PATH)} at ${result.entry.sentAt}${
        result.entry.fallback ? " (fallback)" : ""
      }`
    );
  }

  console.log(JSON.stringify(receiptFor(orderId, correlationId, result)));
}

function readDeadLetters() {
  try {
    const raw = fs.readFileSync(DEAD_LETTER_PATH, "utf8");
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

function writeDeadLetters(entries) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const body = entries.map((entry) => JSON.stringify(entry)).join("\n");
  fs.writeFileSync(DEAD_LETTER_PATH, entries.length > 0 ? body + "\n" : "");
}

async function replay() {
  const entries = readDeadLetters();
  if (entries.length === 0) {
    console.log("replay: dead-letter.jsonl is empty, nothing to do");
    return;
  }

  const stillDead = [];
  for (const entry of entries) {
    const correlationId = crypto.randomUUID();
    console.log(`[${correlationId}] --- replaying order ${entry.orderId} (was: ${entry.errorName}) ---`);
    const result = await sendOrder(entry.orderId, correlationId);
    console.log(JSON.stringify(receiptFor(entry.orderId, correlationId, result)));
    if (result.sent) {
      console.log(
        `[${correlationId}] replay: order ${entry.orderId} sent${result.entry.fallback ? " (fallback)" : ""}, removed from dead-letter`
      );
    } else {
      console.log(`[${correlationId}] replay: order ${entry.orderId} still unsent (${result.errorName}), kept in dead-letter`);
      stillDead.push(deadLetterRow(entry.orderId, result.rawError, correlationId));
    }
  }

  writeDeadLetters(stillDead);
  console.log(`replay: done, ${entries.length - stillDead.length}/${entries.length} sent`);
}

async function main() {
  const [command, orderId] = process.argv.slice(2);

  if (command === "confirm" && orderId) {
    await confirm(orderId);
    return;
  }

  if (command === "replay") {
    await replay();
    return;
  }

  console.error("Usage: node desk.js confirm <orderId>");
  console.error("       node desk.js replay");
  process.exit(1);
}

main().catch((err) => {
  console.error(`desk failed: ${err.name}: ${err.message}`);
  process.exit(1);
});
