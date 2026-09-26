# Reliability notes

Plain-language answers, using the real names in this code (`desk.js`, `reliability.js`).

## 1. What happens when the vendor fails?

`callVendor` wraps `getConfirmationMessage` in `withTimeout`. A 500-style error from the
vendor is converted to `UpstreamUnavailable`; a response that takes longer than the 2-second
per-attempt deadline becomes `TimeoutError`. That single attempt is wrapped in `retry`, and
the whole retried operation is wrapped in `withCircuitBreaker`. If every retry fails, or the
breaker is open and refuses to call the vendor at all (`BreakerOpen`), `attemptSend` sends a
plain fallback message instead — "Your order `<id>` is confirmed. Full details will follow
shortly." — so the customer gets a true, if less detailed, answer instead of nothing.

## 2. Does it retry? With what strategy?

Yes: `retry(fn, { attempts: 3, baseDelayMs: 500 })`, called from inside `attemptSend`. The gap
between attempts doubles each time (500ms, 1s, 2s, plus a little jitter) before giving up after
3 attempts. Only `TimeoutError` and `UpstreamUnavailable` are retried
(`RETRYABLE_ERROR_NAMES`) — anything else, including a `QualityGateRejected` message from the
vendor, is not, because a wrong answer will be wrong again no matter how many times you ask.
Around all of that, `withCircuitBreaker` counts one fully-retried operation as a single
failure; after 3 consecutive failed operations it opens for 10 seconds and stops calling the
vendor at all, so a widening outage doesn't turn into an ever-growing pile of 3-attempt retries
hammering a vendor that is already down.

## 3. What is the recovery path when retries are exhausted?

Two different paths, depending on why it failed. If the vendor call itself failed
(`UpstreamUnavailable`) or the breaker was open (`BreakerOpen`), the desk sends the fallback
message described above — that's the recovery path, and it's automatic. If instead the vendor
answered but the answer failed the quality gate (`QualityGateRejected` from
`checkQualityGate` — wrong order id, a refusal phrase, or a bad length), or if the fallback
send itself throws, the order is appended to `data/dead-letter.jsonl` with its error name,
score, and reasons. Nothing is retried automatically from there; a human (or a script) runs
`node desk.js replay`, which re-runs every dead-lettered order through the same path and
removes the ones that now succeed. Losing the order silently is the one outcome this code
refuses to allow — everything either sends, degrades, or gets parked with a reason.

## 4. Which failures does this code handle, and which does it not?

**Handled:** a vendor that returns a 500, a vendor that hangs past the 2-second deadline, a
vendor that answers fast but wrong, a vendor that is down long enough to matter (the circuit
breaker), and the same order being confirmed twice in a row from the same process
(`runOnce`, keyed on `order:<orderId>`, backed by `data/keys.json`).

**Not handled, honestly:**
- **Two processes running at once.** `runOnce` reads `data/keys.json`, checks the key, then
  writes a "pending" claim — but the read and the write are two separate, unlocked filesystem
  operations. Two `confirm 4001` calls launched from two different processes at nearly the same
  moment can both read the file before either has written its claim, and both will proceed to
  call the vendor. The "claim before you act" design closes the gap for one process calling
  `runOnce` twice in sequence; it does not close it for genuine concurrency across processes.
- **A corrupted `data/keys.json`.** `loadKeys` only special-cases a missing file (`ENOENT`); a
  file that exists but contains invalid JSON throws a `SyntaxError` that is not caught, and
  every subsequent `confirm` or `replay` crashes until someone manually repairs or deletes the
  file. There is no backup, checksum, or corruption-recovery path.
- **A vendor that is slow but still under the deadline.** This case is handled correctly in the
  narrow sense — `withTimeout` lets anything under 2 seconds through, exactly as designed. What
  is missing is any visibility into it: there is no latency logging, so a vendor that is
  consistently limping along at 1.8 seconds looks identical in the logs to one answering in
  50ms, right up until the day it tips over the deadline and the breaker trips with no warning
  that it was coming.
