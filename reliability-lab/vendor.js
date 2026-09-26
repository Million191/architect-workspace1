// Stand-in for an outside AI service that writes order confirmation messages.
// Mode is read from VENDOR_MODE at call time (not at require time) so tests
// and repeated CLI invocations can each pick their own mode.

const GARBAGE_VARIANTS = [
  (orderId) => `Your order ${Number(orderId) + 47} is confirmed and will ship within 2 days.`,
  () => "As an AI I cannot access real order records, but here is a sample confirmation.",
];

function goodMessage(orderId) {
  return `Your order ${orderId} is confirmed and will ship within 2 days.`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getConfirmationMessage(orderId) {
  const mode = process.env.VENDOR_MODE || "ok";

  switch (mode) {
    case "ok":
      await delay(50);
      return goodMessage(orderId);

    case "slow":
      await delay(10000);
      return goodMessage(orderId);

    case "down": {
      await delay(50);
      const err = new Error("Vendor service unavailable (500)");
      err.statusCode = 500;
      throw err;
    }

    case "garbage": {
      await delay(50);
      const variant = GARBAGE_VARIANTS[Math.floor(Math.random() * GARBAGE_VARIANTS.length)];
      return variant(orderId);
    }

    default:
      throw new Error(`Unknown VENDOR_MODE: ${mode}`);
  }
}

module.exports = { getConfirmationMessage };
