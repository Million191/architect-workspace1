// Generic reliability wrappers for calling an unreliable upstream: a
// per-attempt deadline (withTimeout), a bounded, backed-off retry loop
// (retry), and a circuit breaker (withCircuitBreaker) that sits AROUND the
// retry so a whole retried operation counts as a single failure. Named
// error classes let callers tell failure classes apart instead of
// collapsing everything into a generic Error.

const fs = require("fs");
const path = require("path");

class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = "TimeoutError";
  }
}

class UpstreamUnavailable extends Error {
  constructor(message) {
    super(message);
    this.name = "UpstreamUnavailable";
  }
}

class BadResponse extends Error {
  constructor(message) {
    super(message);
    this.name = "BadResponse";
  }
}

class BreakerOpen extends Error {
  constructor(message) {
    super(message);
    this.name = "BreakerOpen";
  }
}

// Failures that might succeed on a later attempt. BadResponse is
// deliberately excluded: a wrong answer will be wrong again.
const RETRYABLE_ERROR_NAMES = new Set(["TimeoutError", "UpstreamUnavailable"]);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Runs one attempt with a deadline. fn is called with no arguments; if it
// has not settled within ms, the returned promise rejects with a
// TimeoutError (fn itself is left to finish or fail on its own later --
// its result is just ignored).
function withTimeout(fn, ms) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new TimeoutError(`timed out after ${ms}ms`));
    }, ms);

    Promise.resolve()
      .then(fn)
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
  });
}

// Tries fn up to `attempts` times. The gap between attempts doubles each
// time (baseDelayMs, 2x, 4x, ...) with a little random jitter added so
// many clients retrying at once don't all land on the same second. Only
// retries errors named in RETRYABLE_ERROR_NAMES; anything else -- or the
// final attempt -- is thrown immediately. onAttempt(info), if given, is
// called after every attempt with { attempt, outcome, errorName }.
async function retry(fn, { attempts = 3, baseDelayMs = 500, onAttempt } = {}) {
  let lastErr;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await fn(attempt);
      if (onAttempt) onAttempt({ attempt, outcome: "success" });
      return result;
    } catch (err) {
      lastErr = err;
      if (onAttempt) onAttempt({ attempt, outcome: "failure", errorName: err.name });

      const retryable = RETRYABLE_ERROR_NAMES.has(err.name);
      const hasMoreAttempts = attempt < attempts;
      if (!retryable || !hasMoreAttempts) throw err;

      const backoff = baseDelayMs * 2 ** (attempt - 1);
      const jitter = Math.random() * backoff * 0.2;
      await delay(backoff + jitter);
    }
  }

  throw lastErr;
}

// --- Circuit breaker ---------------------------------------------------
//
// Wraps AROUND retry (not inside it): one call to `run(fn)` is meant to
// wrap one already-retried operation, so a full set of retries that still
// fails counts as ONE failure toward the trip threshold. State is
// persisted to disk so it survives between separate CLI invocations.

const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 10000;

const DEFAULT_STATE = { isOpen: false, consecutiveFailures: 0, openedAt: null };

function loadBreakerState(statePath) {
  try {
    const raw = fs.readFileSync(statePath, "utf8");
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    return { ...DEFAULT_STATE };
  }
}

function saveBreakerState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

// Runs `fn` (a whole retried operation) through the breaker at `statePath`.
// - Closed: fn runs; a failure bumps consecutiveFailures and trips the
//   breaker open once it hits FAILURE_THRESHOLD.
// - Open, within cooldown: fn is never called; rejects with BreakerOpen.
// - Open, cooldown elapsed: exactly one probe call is let through. Success
//   closes the breaker; failure re-opens it and restarts the cooldown.
async function withCircuitBreaker(fn, { statePath, onBreakerEvent } = {}) {
  const state = loadBreakerState(statePath);
  const now = Date.now();

  if (state.isOpen) {
    const elapsed = now - new Date(state.openedAt).getTime();
    if (elapsed < COOLDOWN_MS) {
      if (onBreakerEvent) onBreakerEvent({ event: "rejected", state });
      throw new BreakerOpen(`circuit open (${Math.ceil((COOLDOWN_MS - elapsed) / 1000)}s left in cooldown)`);
    }
    if (onBreakerEvent) onBreakerEvent({ event: "probe", state });
  }

  const wasProbe = state.isOpen; // cooldown had elapsed, this is the one probe call

  try {
    const result = await fn();
    saveBreakerState(statePath, { isOpen: false, consecutiveFailures: 0, openedAt: null });
    if (onBreakerEvent) onBreakerEvent({ event: "closed" });
    return result;
  } catch (err) {
    if (wasProbe) {
      saveBreakerState(statePath, {
        isOpen: true,
        consecutiveFailures: FAILURE_THRESHOLD,
        openedAt: new Date(now).toISOString(),
      });
      if (onBreakerEvent) onBreakerEvent({ event: "reopened" });
    } else {
      const consecutiveFailures = state.consecutiveFailures + 1;
      const trips = consecutiveFailures >= FAILURE_THRESHOLD;
      saveBreakerState(statePath, {
        isOpen: trips,
        consecutiveFailures,
        openedAt: trips ? new Date(now).toISOString() : null,
      });
      if (onBreakerEvent) onBreakerEvent({ event: trips ? "tripped" : "failure", consecutiveFailures });
    }
    throw err;
  }
}

// --- runOnce (idempotency keys) ----------------------------------------
//
// Runs fn AT MOST ONCE per key, ever, persisted to disk so the guarantee
// holds across separate CLI invocations, not just within one process.
// The key is claimed BEFORE fn runs: checking "did this already happen"
// only after fn runs leaves a gap where two arrivals both see "not sent"
// and both send. Claiming first closes that gap. If fn throws, the claim
// is released so a genuine later retry is still free to run fn for real.

function loadKeys(keysPath) {
  try {
    const raw = fs.readFileSync(keysPath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    return {};
  }
}

function saveKeys(keysPath, keys) {
  fs.mkdirSync(path.dirname(keysPath), { recursive: true });
  fs.writeFileSync(keysPath, JSON.stringify(keys, null, 2));
}

// Returns { result, duplicate }. duplicate is true when a previously
// stored result was returned without calling fn again.
async function runOnce(key, fn, { keysPath }) {
  const keys = loadKeys(keysPath);
  const existing = keys[key];
  if (existing && existing.status === "done") {
    return { result: existing.result, duplicate: true };
  }

  keys[key] = { status: "pending", claimedAt: new Date().toISOString() };
  saveKeys(keysPath, keys);

  try {
    const result = await fn();
    const after = loadKeys(keysPath);
    after[key] = { status: "done", result, completedAt: new Date().toISOString() };
    saveKeys(keysPath, after);
    return { result, duplicate: false };
  } catch (err) {
    const after = loadKeys(keysPath);
    delete after[key];
    saveKeys(keysPath, after);
    throw err;
  }
}

// --- Quality gate --------------------------------------------------------
//
// Reliability's job ends once an answer comes back at all. This is the
// separate, cheap layer that decides whether that answer is worth using.
// score() is a pure 0-100 rubric; checkQualityGate() applies the threshold
// and throws QualityGateRejected (with .score and .reasons attached) so
// callers can dead-letter with the same numbers a human would see.

const QUALITY_THRESHOLD = 70;
const BANNED_PHRASES = ["as an ai", "i cannot", "i'm sorry", "as a language model"];

class QualityGateRejected extends Error {
  constructor(message) {
    super(message);
    this.name = "QualityGateRejected";
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The exact order id as a whole token: "2001" must not match inside
// "22001" or "20011". Order ids are digits, so digit boundaries are enough.
function hasExactOrderId(message, orderId) {
  const re = new RegExp(`(?<!\\d)${escapeRegExp(orderId)}(?!\\d)`);
  return re.test(message);
}

function hasNoBannedPhrase(message) {
  const lower = message.toLowerCase();
  return !BANNED_PHRASES.some((phrase) => lower.includes(phrase));
}

function hasGoodLength(message) {
  return message.length >= 20 && message.length <= 300;
}

function scoreBreakdown(message, orderId) {
  const checks = [
    { points: 40, ok: hasExactOrderId(message, orderId), reason: "missing the exact order id as a whole token" },
    { points: 30, ok: hasNoBannedPhrase(message), reason: "contains a disclaimer/refusal phrase" },
    { points: 30, ok: hasGoodLength(message), reason: `length ${message.length} is not between 20 and 300 characters` },
  ];
  const total = checks.reduce((sum, c) => sum + (c.ok ? c.points : 0), 0);
  const reasons = checks.filter((c) => !c.ok).map((c) => c.reason);
  return { score: total, reasons };
}

function score(message, orderId) {
  return scoreBreakdown(message, orderId).score;
}

// Returns the score when it meets QUALITY_THRESHOLD; otherwise throws
// QualityGateRejected with .score and .reasons attached.
function checkQualityGate(message, orderId) {
  const { score: s, reasons } = scoreBreakdown(message, orderId);
  if (s < QUALITY_THRESHOLD) {
    const err = new QualityGateRejected(
      `quality score ${s} is below threshold ${QUALITY_THRESHOLD} (${reasons.join("; ")})`
    );
    err.score = s;
    err.reasons = reasons;
    throw err;
  }
  return s;
}

module.exports = {
  withTimeout,
  retry,
  withCircuitBreaker,
  loadBreakerState,
  runOnce,
  loadKeys,
  score,
  scoreBreakdown,
  checkQualityGate,
  QUALITY_THRESHOLD,
  TimeoutError,
  UpstreamUnavailable,
  BadResponse,
  BreakerOpen,
  QualityGateRejected,
};
