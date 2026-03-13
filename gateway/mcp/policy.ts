import type { PaymentRequired } from "@x402/mcp";

import type { PolicyContext, PolicyDecision } from "./types.js";

/**
 * Runtime policy configuration.
 */
export interface PolicyConfig {
  paidToolAllowlist: Set<string>;
  toolMaxPriceWei: Map<string, bigint>;
  sessionSpendLimitWei: bigint;
  dailySpendLimitWei: bigint;
}

/**
 * In-memory policy engine for automatic payment controls.
 */
export class PolicyService {
  private readonly config: PolicyConfig;

  private readonly sessionSpend = new Map<string, bigint>();

  private readonly dailySpend = new Map<string, bigint>();

  /**
   * Creates a policy service instance.
   *
   * @param config - Policy limits and allowlists.
   */
  constructor(config: PolicyConfig) {
    this.config = config;
  }

  /**
   * Creates a policy service from environment variables.
   *
   * @returns Policy service instance.
   */
  static fromEnv(): PolicyService {
    const allowlistRaw = process.env.PAID_TOOL_ALLOWLIST || "";
    const allowlist = new Set(
      allowlistRaw
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    );

    const toolMaxPriceMap = new Map<string, bigint>();
    const maxPriceRaw = process.env.TOOL_MAX_PRICE_WEI || "";
    for (const pair of maxPriceRaw
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)) {
      const [tool, amount] = pair.split(":");
      if (!tool || !amount) {
        continue;
      }
      toolMaxPriceMap.set(tool.trim(), BigInt(amount.trim()));
    }

    const sessionSpendLimitWei = BigInt(
      process.env.SESSION_SPEND_LIMIT_WEI || "50000000000000000000",
    );
    const dailySpendLimitWei = BigInt(process.env.DAILY_SPEND_LIMIT_WEI || "200000000000000000000");

    return new PolicyService({
      paidToolAllowlist: allowlist,
      toolMaxPriceWei: toolMaxPriceMap,
      sessionSpendLimitWei,
      dailySpendLimitWei,
    });
  }

  /**
   * Evaluates whether a tool call is allowed under current policy.
   *
   * @param context - User/session/tool context.
   * @param paymentRequired - Optional x402 payment requirements.
   * @returns Policy decision.
   */
  evaluate(context: PolicyContext, paymentRequired: PaymentRequired | null): PolicyDecision {
    if (!paymentRequired) {
      return {
        allowed: true,
        ruleMatched: "FREE_TOOL",
        remainingBudget: this.formatRemainingDailyBudget(context.userId),
      };
    }

    if (!this.config.paidToolAllowlist.has(context.toolName)) {
      return {
        allowed: false,
        ruleMatched: "PAID_TOOL_ALLOWLIST",
        remainingBudget: this.formatRemainingDailyBudget(context.userId),
        blockedReason: `Tool ${context.toolName} is not in paid tool allowlist`,
        errorCode: "TOOL_NOT_ALLOWED",
        paymentRequired,
      };
    }

    const primaryAccept = paymentRequired.accepts[0];
    const amountWei = BigInt(primaryAccept.amount);
    const maxPrice = this.config.toolMaxPriceWei.get(context.toolName);

    if (maxPrice !== undefined && amountWei > maxPrice) {
      return {
        allowed: false,
        ruleMatched: "TOOL_MAX_PRICE_WEI",
        remainingBudget: this.formatRemainingDailyBudget(context.userId),
        blockedReason: `Price ${amountWei.toString()} exceeds max ${maxPrice.toString()}`,
        errorCode: "PRICE_TOO_HIGH",
        paymentRequired,
      };
    }

    const sessionKey = `${context.userId}:${context.sessionId}`;
    const currentSessionSpend = this.sessionSpend.get(sessionKey) || 0n;
    if (currentSessionSpend + amountWei > this.config.sessionSpendLimitWei) {
      return {
        allowed: false,
        ruleMatched: "SESSION_SPEND_LIMIT_WEI",
        remainingBudget: this.formatRemainingDailyBudget(context.userId),
        blockedReason: "Session spend limit exceeded",
        errorCode: "DAILY_LIMIT_EXCEEDED",
        paymentRequired,
      };
    }

    const dailyKey = this.dailyKey(context.userId);
    const currentDailySpend = this.dailySpend.get(dailyKey) || 0n;
    if (currentDailySpend + amountWei > this.config.dailySpendLimitWei) {
      return {
        allowed: false,
        ruleMatched: "DAILY_SPEND_LIMIT_WEI",
        remainingBudget: this.formatRemainingDailyBudget(context.userId),
        blockedReason: "Daily spend limit exceeded",
        errorCode: "DAILY_LIMIT_EXCEEDED",
        paymentRequired,
      };
    }

    return {
      allowed: true,
      ruleMatched: "POLICY_APPROVED",
      remainingBudget: this.formatRemainingDailyBudget(context.userId, amountWei),
      paymentRequired,
    };
  }

  /**
   * Records spend after a successful paid execution.
   *
   * @param context - User/session/tool context.
   * @param amountWei - Amount spent.
   */
  recordSpend(context: PolicyContext, amountWei: bigint): void {
    const sessionKey = `${context.userId}:${context.sessionId}`;
    const currentSessionSpend = this.sessionSpend.get(sessionKey) || 0n;
    this.sessionSpend.set(sessionKey, currentSessionSpend + amountWei);

    const dailyKey = this.dailyKey(context.userId);
    const currentDailySpend = this.dailySpend.get(dailyKey) || 0n;
    this.dailySpend.set(dailyKey, currentDailySpend + amountWei);
  }

  /**
   * Produces the daily bucket key for spend tracking.
   *
   * @param userId - User identifier.
   * @returns Key in user:YYYY-MM-DD form.
   */
  private dailyKey(userId: string): string {
    return `${userId}:${new Date().toISOString().slice(0, 10)}`;
  }

  /**
   * Formats remaining daily budget.
   *
   * @param userId - User identifier.
   * @param additionalSpend - Pending spend to subtract.
   * @returns Remaining budget string in wei.
   */
  private formatRemainingDailyBudget(userId: string, additionalSpend = 0n): string {
    const spent = this.dailySpend.get(this.dailyKey(userId)) || 0n;
    const remaining = this.config.dailySpendLimitWei - spent - additionalSpend;
    return (remaining > 0n ? remaining : 0n).toString();
  }
}
