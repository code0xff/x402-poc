import type { x402MCPClient } from "@x402/mcp";

import { AuditLogService } from "./audit.js";
import { PolicyService } from "./policy.js";
import type { GatewayToolEnvelope, PolicyContext } from "./types.js";

/**
 * Execution context carried into gateway tool calls.
 */
export interface GatewayExecutionContext {
  userId: string;
  sessionId: string;
}

/**
 * Result shape for orchestrated tool execution.
 */
export interface ExecuteToolResult {
  ok: boolean;
  envelope: GatewayToolEnvelope;
  errorCode?: string;
}

/**
 * Coordinates policy checks, paid tool execution, and audit logging.
 */
export class PaymentOrchestrator {
  private readonly x402Mcp: x402MCPClient;

  private readonly policyService: PolicyService;

  private readonly auditLogService: AuditLogService;

  private readonly pendingContexts = new Map<string, PolicyContext>();

  private readonly pendingDecisions = new Map<string, ReturnType<PolicyService["evaluate"]>>();

  /**
   * Creates a payment orchestrator.
   *
   * @param x402Mcp - x402-enabled MCP client.
   * @param policyService - Policy evaluator.
   * @param auditLogService - Audit writer.
   */
  constructor(
    x402Mcp: x402MCPClient,
    policyService: PolicyService,
    auditLogService: AuditLogService,
  ) {
    this.x402Mcp = x402Mcp;
    this.policyService = policyService;
    this.auditLogService = auditLogService;
  }

  /**
   * Attaches payment approval hook to x402 client.
   */
  attachPaymentHook(): void {
    this.x402Mcp.onPaymentRequired((context) => {
      const signature = this.signatureFor(context.toolName, context.arguments);
      const policyContext = this.pendingContexts.get(signature);
      if (!policyContext) {
        return { abort: true };
      }

      const decision = this.policyService.evaluate(policyContext, context.paymentRequired);
      this.pendingDecisions.set(signature, decision);

      if (!decision.allowed) {
        return { abort: true };
      }

      return undefined;
    });
  }

  /**
   * Executes a tool call through upstream MCP with policy and audit handling.
   *
   * @param toolName - Tool name to execute.
   * @param args - Tool arguments.
   * @param executionContext - User/session context.
   * @returns Structured execution result.
   */
  async executeTool(
    toolName: string,
    args: Record<string, unknown>,
    executionContext: GatewayExecutionContext,
  ): Promise<ExecuteToolResult> {
    const policyContext: PolicyContext = {
      userId: executionContext.userId,
      sessionId: executionContext.sessionId,
      toolName,
    };

    const signature = this.signatureFor(toolName, args);
    this.pendingContexts.set(signature, policyContext);

    try {
      const toolResult = await this.x402Mcp.callTool(toolName, args);
      const decision =
        this.pendingDecisions.get(signature) || this.policyService.evaluate(policyContext, null);
      const accepts = decision.paymentRequired?.accepts?.[0];

      if (toolResult.paymentMade && accepts) {
        this.policyService.recordSpend(policyContext, BigInt(accepts.amount));
      }

      await this.auditLogService.append({
        timestamp: new Date().toISOString(),
        user_id: policyContext.userId,
        session_id: policyContext.sessionId,
        tool: toolName,
        amount: accepts?.amount || "0",
        asset: accepts?.asset || "",
        network: accepts?.network || "",
        approved: decision.allowed,
        tx_hash: toolResult.paymentResponse?.transaction,
        reason: decision.allowed ? "approved" : decision.blockedReason || "blocked",
      });

      return {
        ok: true,
        envelope: {
          result: {
            content: toolResult.content,
            isError: toolResult.isError,
          },
          payment: {
            required: Boolean(accepts),
            approved: decision.allowed,
            amount: accepts?.amount || "0",
            asset: accepts?.asset || "",
            network: accepts?.network || "",
            txHash: toolResult.paymentResponse?.transaction,
          },
          policy: {
            allowed: decision.allowed,
            ruleMatched: decision.ruleMatched,
            remainingBudget: decision.remainingBudget,
            blockedReason: decision.blockedReason,
          },
        },
      };
    } catch (error) {
      const decision = this.pendingDecisions.get(signature);
      if (decision && !decision.allowed) {
        const accepts = decision.paymentRequired?.accepts?.[0];
        await this.auditLogService.append({
          timestamp: new Date().toISOString(),
          user_id: policyContext.userId,
          session_id: policyContext.sessionId,
          tool: toolName,
          amount: accepts?.amount || "0",
          asset: accepts?.asset || "",
          network: accepts?.network || "",
          approved: false,
          reason: decision.blockedReason || "blocked",
        });

        return {
          ok: false,
          errorCode: decision.errorCode,
          envelope: {
            result: null,
            payment: {
              required: Boolean(accepts),
              approved: false,
              amount: accepts?.amount || "0",
              asset: accepts?.asset || "",
              network: accepts?.network || "",
            },
            policy: {
              allowed: false,
              ruleMatched: decision.ruleMatched,
              remainingBudget: decision.remainingBudget,
              blockedReason: decision.blockedReason,
            },
          },
        };
      }

      const message = error instanceof Error ? error.message : String(error);

      await this.auditLogService.append({
        timestamp: new Date().toISOString(),
        user_id: policyContext.userId,
        session_id: policyContext.sessionId,
        tool: toolName,
        amount: "0",
        asset: "",
        network: "",
        approved: false,
        reason: message,
      });

      return {
        ok: false,
        errorCode: "FACILITATOR_UNAVAILABLE",
        envelope: {
          result: {
            error: message,
          },
          payment: {
            required: false,
            approved: false,
            amount: "0",
            asset: "",
            network: "",
          },
          policy: {
            allowed: false,
            ruleMatched: "EXECUTION_FAILURE",
            remainingBudget: "0",
            blockedReason: message,
          },
        },
      };
    } finally {
      this.pendingContexts.delete(signature);
      this.pendingDecisions.delete(signature);
    }
  }

  /**
   * Creates a stable signature for correlating tool execution hooks.
   *
   * @param toolName - Tool name.
   * @param args - Tool arguments.
   * @returns Stable signature key.
   */
  private signatureFor(toolName: string, args: Record<string, unknown>): string {
    return `${toolName}:${stableStringify(args)}`;
  }
}

/**
 * Stable JSON serializer with deterministic key ordering.
 *
 * @param value - Value to serialize.
 * @returns Stable JSON string.
 */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(",")}}`;
}
