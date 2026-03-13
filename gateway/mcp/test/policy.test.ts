import assert from "node:assert/strict";
import test from "node:test";

import type { PaymentRequired } from "@x402/mcp";

import { PolicyService } from "../policy.js";

const baseConfig = {
  paidToolAllowlist: new Set(["get_weather"]),
  toolMaxPriceWei: new Map([["get_weather", 10n]]),
  sessionSpendLimitWei: 15n,
  dailySpendLimitWei: 19n,
};

/**
 * Creates a minimal x402 payment-required fixture for policy tests.
 *
 * @param amount - Amount to place into accepts[0].amount.
 * @returns Payment-required-like structure consumed by the policy evaluator.
 */
function payment(amount: string): PaymentRequired {
  return {
    x402Version: 1,
    resource: {
      url: "mcp://tool/get_weather",
      description: "weather",
      mimeType: "application/json",
    },
    accepts: [
      {
        scheme: "exact",
        network: "eip155:8283",
        amount,
        asset: "0x0000000000000000000000000000000000001000",
        payTo: "0x0000000000000000000000000000000000000001",
        maxTimeoutSeconds: 60,
        extra: {},
      },
    ],
  } as unknown as PaymentRequired;
}

test("allows free tools", () => {
  const policy = new PolicyService(baseConfig);
  const decision = policy.evaluate({ userId: "u1", sessionId: "s1", toolName: "ping" }, null);
  assert.equal(decision.allowed, true);
  assert.equal(decision.ruleMatched, "FREE_TOOL");
});

test("blocks paid tool not in allowlist", () => {
  const policy = new PolicyService(baseConfig);
  const decision = policy.evaluate(
    { userId: "u1", sessionId: "s1", toolName: "other_tool" },
    payment("5"),
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.errorCode, "TOOL_NOT_ALLOWED");
});

test("blocks when daily limit is exceeded", () => {
  const policy = new PolicyService(baseConfig);
  const context = { userId: "u1", sessionId: "s1", toolName: "get_weather" };

  const first = policy.evaluate(context, payment("10"));
  assert.equal(first.allowed, true);
  policy.recordSpend(context, 10n);

  const second = policy.evaluate(context, payment("10"));
  assert.equal(second.allowed, false);
  assert.equal(second.errorCode, "DAILY_LIMIT_EXCEEDED");
});
