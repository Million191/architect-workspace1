// User profile update, in two idempotent layers:
//
//   1. Field-level: every field is an absolute ASSIGNMENT ("set name to X"),
//      never a delta ("append to bio", "increment loginCount"). Assignments
//      are naturally idempotent -- applying the same update to the same
//      starting profile any number of times produces the exact same
//      resulting fields. applyProfileUpdate() is that pure logic, with no
//      timestamps or side effects, so this property is easy to see and test
//      in isolation.
//
//   2. Request-level: updateUserProfile() wraps applyProfileUpdate() in
//      runOnce(), keyed by (userId, requestId). This is what makes the FULL
//      operation -- including updatedAt and the audit event -- safe to
//      retry: a network retry that resends the identical request (same
//      requestId) returns the first call's stored result unchanged, instead
//      of bumping updatedAt again or appending a second audit event. A
//      resubmission with a fresh requestId (a genuinely new request that
//      happens to carry the same desired values) is treated as a new event
//      by design -- see check-profile-idempotency.js for both cases side by
//      side.

const fs = require("fs");
const path = require("path");
const { runOnce } = require("./reliability");

const DATA_DIR = path.join(__dirname, "data");
const PROFILES_PATH = path.join(DATA_DIR, "profiles.json");
const EVENTS_PATH = path.join(DATA_DIR, "profile-events.jsonl");
const KEYS_PATH = path.join(DATA_DIR, "keys.json");

const ALLOWED_FIELDS = ["name", "email", "bio"];

function loadProfiles() {
  try {
    return JSON.parse(fs.readFileSync(PROFILES_PATH, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    return {};
  }
}

function saveProfiles(profiles) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PROFILES_PATH, JSON.stringify(profiles, null, 2));
}

function appendEvent(event) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(EVENTS_PATH, JSON.stringify(event) + "\n");
}

/**
 * Pure. Returns a NEW profile object: `existing` (or a fresh blank profile
 * if there isn't one yet) with every field named in `updates` set to its
 * given value. Fields not in ALLOWED_FIELDS are ignored rather than
 * silently accepted, so an unexpected key can't leak into stored state.
 *
 * Idempotent by construction: applyProfileUpdate(applyProfileUpdate(p, u), u)
 * deep-equals applyProfileUpdate(p, u), because re-assigning the same value
 * to the same field changes nothing. This holds regardless of how many
 * times it's called or in what order relative to other update calls with
 * DIFFERENT `updates` -- there is no "+1" anywhere in this function for a
 * repeat to double.
 */
function applyProfileUpdate(existing, updates) {
  const base = existing || { name: null, email: null, bio: null };
  const next = { ...base };
  for (const field of ALLOWED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(updates, field)) {
      next[field] = updates[field];
    }
  }
  return next;
}

/**
 * The side-effecting operation: applies `updates` to `userId`'s profile,
 * stamps `updatedAt`, persists it, and appends one `profile_updated` audit
 * event -- all guarded by runOnce keyed on (userId, requestId). Returns
 * { result: <profile>, duplicate: <bool> }; `duplicate: true` means this
 * exact request was already applied and nothing ran again.
 */
async function updateUserProfile(userId, updates, requestId) {
  return runOnce(
    `profile:${userId}:${requestId}`,
    async () => {
      const profiles = loadProfiles();
      const next = applyProfileUpdate(profiles[userId], updates);
      next.updatedAt = new Date().toISOString();
      profiles[userId] = next;
      saveProfiles(profiles);
      appendEvent({ type: "profile_updated", userId, requestId, updates, at: next.updatedAt });
      return next;
    },
    { keysPath: KEYS_PATH }
  );
}

module.exports = { applyProfileUpdate, updateUserProfile, loadProfiles, ALLOWED_FIELDS };
