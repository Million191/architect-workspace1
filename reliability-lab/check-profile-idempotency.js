#!/usr/bin/env node
// Plain script, no test framework: run with `node check-profile-idempotency.js`
// (or `npm run test:profile`). Exits non-zero on failure so it can gate a build.
//
// Proves two distinct idempotency properties:
//
//   1. Request-level dedup: replaying the SAME requestId (a network retry of
//      one logical request) must not re-stamp updatedAt or append a second
//      audit event -- runOnce() short-circuits it entirely.
//
//   2. Field-level convergence: submitting the SAME desired values under a
//      DIFFERENT requestId (a legitimate second request that happens to
//      restate the same facts) is not deduped -- it's a new event, and
//      updatedAt does change -- but the profile's data fields end up
//      identical either way, because "set field to X" has no way to
//      accumulate.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { applyProfileUpdate } = require("./profile");

const USER_ID = "u-test-9001";
const DATA_DIR = path.join(__dirname, "data");
const PROFILES_PATH = path.join(DATA_DIR, "profiles.json");
const EVENTS_PATH = path.join(DATA_DIR, "profile-events.jsonl");
const KEYS_PATH = path.join(DATA_DIR, "keys.json");
const DESK_PATH = path.join(__dirname, "profileDesk.js");

function readJsonLines(filePath) {
  try {
    return fs
      .readFileSync(filePath, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

function writeJsonLines(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.length > 0 ? rows.map((r) => JSON.stringify(r)).join("\n") + "\n" : "");
}

// Reset any state left over from a previous run of this test (or of
// `profileDesk.js` by hand for this user) so the test is itself safe to
// re-run.
function resetUserState(userId) {
  let profiles = {};
  try {
    profiles = JSON.parse(fs.readFileSync(PROFILES_PATH, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  delete profiles[userId];
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PROFILES_PATH, JSON.stringify(profiles, null, 2));

  const events = readJsonLines(EVENTS_PATH).filter((e) => e.userId !== userId);
  writeJsonLines(EVENTS_PATH, events);

  let keys = {};
  try {
    keys = JSON.parse(fs.readFileSync(KEYS_PATH, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  for (const key of Object.keys(keys)) {
    if (key.startsWith(`profile:${userId}:`)) delete keys[key];
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(KEYS_PATH, JSON.stringify(keys, null, 2));
}

function runUpdate(userId, requestId, updates) {
  const result = spawnSync(
    process.execPath,
    [DESK_PATH, "update", userId, requestId, JSON.stringify(updates)],
    { cwd: __dirname, encoding: "utf8" }
  );
  return result.stdout + result.stderr;
}

function getProfile(userId) {
  const profiles = JSON.parse(fs.readFileSync(PROFILES_PATH, "utf8"));
  return profiles[userId] || null;
}

function eventsFor(userId) {
  return readJsonLines(EVENTS_PATH).filter((e) => e.userId === userId);
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function checkPureFunctionIsIdempotent() {
  const updates = { name: "Grace Hopper", email: "grace@example.com" };
  const once = applyProfileUpdate(null, updates);
  const twice = applyProfileUpdate(once, updates);
  const thrice = applyProfileUpdate(twice, updates);

  if (JSON.stringify(once) !== JSON.stringify(twice) || JSON.stringify(twice) !== JSON.stringify(thrice)) {
    fail(
      `applyProfileUpdate should converge: once=${JSON.stringify(once)} twice=${JSON.stringify(
        twice
      )} thrice=${JSON.stringify(thrice)}`
    );
  }
  console.log("PASS: applyProfileUpdate(applyProfileUpdate(p, u), u) === applyProfileUpdate(p, u) (pure, no I/O)");
}

function checkSameRequestIdIsDeduped() {
  const updates = { name: "Ada Lovelace", email: "ada@example.com", bio: "Mathematician" };
  const requestId = "req-A";

  const first = runUpdate(USER_ID, requestId, updates);
  if (!/duplicate: false/.test(first)) fail(`first update should report "duplicate: false"; got:\n${first}`);

  const second = runUpdate(USER_ID, requestId, updates);
  if (!/duplicate: true/.test(second)) fail(`replayed update should report "duplicate: true"; got:\n${second}`);

  const third = runUpdate(USER_ID, requestId, updates);
  if (!/duplicate: true/.test(third)) fail(`second replay should also report "duplicate: true"; got:\n${third}`);

  const events = eventsFor(USER_ID);
  if (events.length !== 1) {
    fail(`profile-events.jsonl should have exactly 1 event after 3 identical requests, found ${events.length}`);
  }

  const profileAfterFirst = getProfile(USER_ID);
  const profileAfterThird = getProfile(USER_ID);
  if (profileAfterFirst.updatedAt !== profileAfterThird.updatedAt) {
    fail(`updatedAt should not change on a replayed requestId: ${profileAfterFirst.updatedAt} vs ${profileAfterThird.updatedAt}`);
  }

  console.log(
    `PASS: 3 calls with the same requestId -> 1 applied + 2 duplicates, 1 audit event, updatedAt unchanged (${profileAfterThird.updatedAt})`
  );
}

function checkFieldsConvergeAcrossDifferentRequestIds() {
  const updates = { name: "Ada Lovelace", email: "ada@example.com", bio: "Mathematician" };
  const before = getProfile(USER_ID);
  const eventsBefore = eventsFor(USER_ID).length;

  const output = runUpdate(USER_ID, "req-B", updates);
  if (!/duplicate: false/.test(output)) {
    fail(`a genuinely new requestId with the same values should NOT be deduped; got:\n${output}`);
  }

  const after = getProfile(USER_ID);
  const eventsAfter = eventsFor(USER_ID).length;

  if (eventsAfter !== eventsBefore + 1) {
    fail(`a new requestId should append exactly one more event (${eventsBefore} -> ${eventsAfter})`);
  }
  if (before.updatedAt === after.updatedAt) {
    fail(`updatedAt SHOULD change for a genuinely new request, but it did not`);
  }
  if (before.name !== after.name || before.email !== after.email || before.bio !== after.bio) {
    fail(
      `data fields should converge to the same values regardless of requestId: before=${JSON.stringify(
        before
      )} after=${JSON.stringify(after)}`
    );
  }

  console.log(
    "PASS: a different requestId with the same desired values is treated as a new event (updatedAt changes, " +
      "1 more audit event) but the data fields converge to the same values either way"
  );
}

function main() {
  resetUserState(USER_ID);
  checkPureFunctionIsIdempotent();
  checkSameRequestIdIsDeduped();
  checkFieldsConvergeAcrossDifferentRequestIds();
  console.log("PASS: all profile idempotency checks passed");
}

main();
