import type { PaymentRequired } from "@x402/mcp";

/**
 * Standard gateway error codes.
 */
export type GatewayErrorCode =
  | "TOOL_NOT_ALLOWED"
  | "PRICE_TOO_HIGH"
  | "DAILY_LIMIT_EXCEEDED"
  | "FACILITATOR_UNAVAILABLE";

/**
 * Policy evaluation context.
 */
export interface PolicyContext {
  userId: string;
  sessionId: string;
  toolName: string;
}

/**
 * Policy evaluation output.
 */
export interface PolicyDecision {
  allowed: boolean;
  ruleMatched: string;
  remainingBudget: string;
  blockedReason?: string;
  errorCode?: GatewayErrorCode;
  paymentRequired?: PaymentRequired;
}

/**
 * Payment summary for tool result payload.
 */
export interface PaymentSummary {
  required: boolean;
  approved: boolean;
  amount: string;
  asset: string;
  network: string;
  txHash?: string;
}

/**
 * Gateway tool envelope returned to MCP clients.
 */
export interface GatewayToolEnvelope {
  result: unknown;
  payment: PaymentSummary;
  policy: {
    allowed: boolean;
    ruleMatched: string;
    remainingBudget: string;
    blockedReason?: string;
  };
}

/**
 * Audit event shape written as JSONL.
 */
export interface AuditEvent {
  timestamp: string;
  user_id: string;
  session_id: string;
  tool: string;
  amount: string;
  asset: string;
  network: string;
  approved: boolean;
  tx_hash?: string;
  reason: string;
}
