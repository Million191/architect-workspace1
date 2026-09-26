#!/usr/bin/env node
// Profile desk CLI: update <userId> <requestId> <json-updates>
//
// Example:
//   node profileDesk.js update u1 req-1 '{"name":"Ada Lovelace","email":"ada@example.com"}'
//
// Running the exact same command again (same requestId) is a no-op: it
// prints "duplicate: true" and the stored profile is untouched -- see
// profile.js and check-profile-idempotency.js for why.

const { updateUserProfile, loadProfiles } = require("./profile");

async function update(userId, requestId, updatesJson) {
  let updates;
  try {
    updates = JSON.parse(updatesJson);
  } catch (err) {
    console.error(`updates must be valid JSON: ${err.message}`);
    process.exit(1);
  }

  const { result, duplicate } = await updateUserProfile(userId, updates, requestId);
  console.log(`duplicate: ${duplicate}`);
  console.log(JSON.stringify(result));
}

function show(userId) {
  const profiles = loadProfiles();
  console.log(JSON.stringify(profiles[userId] || null));
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (command === "update" && rest.length === 3) {
    await update(...rest);
    return;
  }

  if (command === "show" && rest.length === 1) {
    show(rest[0]);
    return;
  }

  console.error("Usage: node profileDesk.js update <userId> <requestId> <json-updates>");
  console.error("       node profileDesk.js show <userId>");
  process.exit(1);
}

main().catch((err) => {
  console.error(`profileDesk failed: ${err.name}: ${err.message}`);
  process.exit(1);
});
