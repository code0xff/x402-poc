import { randomUUID } from "node:crypto";

import { config } from "dotenv";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AnySchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createx402MCPClient } from "@x402/mcp";
import { toClientEvmSigner } from "@x402/evm";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import express from "express";
import { type Chain, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

import { AuditLogService } from "./audit.js";
import { PaymentOrchestrator } from "./orchestrator.js";
import { PolicyService } from "./policy.js";

config();

const port = parseInt(process.env.PORT || "4024", 10);
const upstreamUrl = process.env.MCP_UPSTREAM_URL || "http://localhost:4023";

const evmPrivateKey = requiredEnv("EVM_PRIVATE_KEY") as `0x${string}`;
const evmNetwork = requiredEnv("EVM_NETWORK") as `${string}:${string}`;
const evmRpcUrl = requiredEnv("EVM_RPC_URL");
const evmChainIdRaw = requiredEnv("EVM_CHAIN_ID");

const evmChainId = Number(evmChainIdRaw);
if (!Number.isInteger(evmChainId) || evmChainId <= 0) {
  console.error("❌ EVM_CHAIN_ID must be a positive integer");
  process.exit(1);
}

const evmNetworkMatch = /^eip155:(\d+)$/.exec(evmNetwork);
if (!evmNetworkMatch) {
  console.error("❌ EVM_NETWORK must match eip155:<chainId> format");
  process.exit(1);
}
if (Number(evmNetworkMatch[1]) !== evmChainId) {
  console.error(
    `❌ EVM_NETWORK (${evmNetwork}) and EVM_CHAIN_ID (${evmChainId}) must reference the same chain`,
  );
  process.exit(1);
}

const gatewayContextSchema = z
  .object({
    userId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
  })
  .strict();

/**
 * Main entry point for MCP gateway.
 */
export async function main(): Promise<void> {
  const account = privateKeyToAccount(evmPrivateKey);
  const chain: Chain = {
    id: evmChainId,
    name: `evm-${evmChainId}`,
    nativeCurrency: { name: "WKRC", symbol: "WKRC", decimals: 18 },
    rpcUrls: {
      default: { http: [evmRpcUrl] },
      public: { http: [evmRpcUrl] },
    },
  };

  const publicClient = createPublicClient({
    chain,
    transport: http(evmRpcUrl),
  });

  const x402Mcp = createx402MCPClient({
    name: "x402-mcp-gateway",
    version: "1.0.0",
    schemes: [
      { network: evmNetwork, client: new ExactEvmScheme(toClientEvmSigner(account, publicClient)) },
    ],
    autoPayment: true,
    onPaymentRequested: async () => true,
  });

  const transport = new StreamableHTTPClientTransport(new URL(`${upstreamUrl}/mcp`));
  await x402Mcp.connect(transport);

  const policyService = PolicyService.fromEnv();
  const auditLogService = AuditLogService.fromEnv();
  const orchestrator = new PaymentOrchestrator(x402Mcp, policyService, auditLogService);
  orchestrator.attachPaymentHook();

  const upstreamTools = await x402Mcp.listTools();
  const gatewayMcp = new McpServer({
    name: "x402-gateway-mcp",
    version: "1.0.0",
  });

  for (const tool of upstreamTools.tools) {
    const toolConfig: {
      description: string;
      inputSchema?: AnySchema;
    } = {
      description: `[gateway] ${tool.description || ""}`,
      inputSchema: tool.inputSchema as unknown as AnySchema,
    };

    gatewayMcp.registerTool(tool.name, toolConfig, async (args: Record<string, unknown>) => {
      const gatewayContext = extractGatewayContext(args);
      const result = await orchestrator.executeTool(tool.name, gatewayContext.forwardArgs, {
        userId: gatewayContext.userId,
        sessionId: gatewayContext.sessionId,
      });

      if (!result.ok) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                code: result.errorCode,
                ...result.envelope,
              }),
            },
          ],
        };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result.envelope) }],
      };
    });
  }

  startExpressServer(
    gatewayMcp,
    port,
    upstreamTools.tools.map((t) => t.name),
  );
}

/**
 * Extracts gateway execution context and strips control fields from tool args.
 *
 * @param args - Original tool arguments.
 * @returns Context and sanitized args.
 */
function extractGatewayContext(args: Record<string, unknown>): {
  userId: string;
  sessionId: string;
  forwardArgs: Record<string, unknown>;
} {
  const defaultUserId = process.env.DEFAULT_USER_ID || "codex";
  const defaultSessionId = process.env.DEFAULT_SESSION_ID || "default";

  const parsedContext = gatewayContextSchema.safeParse(args.__gateway);
  const context = parsedContext.success ? parsedContext.data : undefined;

  const forwardArgs = { ...args };
  delete forwardArgs.__gateway;

  return {
    userId: context?.userId || defaultUserId,
    sessionId: context?.sessionId || defaultSessionId,
    forwardArgs,
  };
}

/**
 * Starts streamable HTTP MCP server with health endpoint using Express.
 *
 * @param mcpServer - Gateway MCP server.
 * @param listenPort - Service port.
 * @param tools - Exposed tool names.
 */
function startExpressServer(mcpServer: McpServer, listenPort: number, tools: string[]): void {
  const app = express();
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  app.use(express.json());

  app.post("/mcp", async (req, res) => {
    try {
      const sessionIdHeader = req.headers["mcp-session-id"];
      const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

      let transport: StreamableHTTPServerTransport;
      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          onsessioninitialized: (initializedSessionId) => {
            transports[initializedSessionId] = transport;
          },
        });
        transport.onclose = () => {
          const currentSessionId = transport.sessionId;
          if (currentSessionId && transports[currentSessionId]) {
            delete transports[currentSessionId];
          }
        };

        await mcpServer.connect(transport);
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid session ID provided" },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("Gateway request error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", async (req, res) => {
    const sessionIdHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  });

  app.delete("/mcp", async (req, res) => {
    const sessionIdHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await transports[sessionId].handleRequest(req, res);
  });

  app.get("/health", (_, res) => {
    res.json({ status: "ok", upstream: upstreamUrl, tools });
  });

  app.listen(listenPort, () => {
    console.log(`🚀 Gateway MCP listening on http://localhost:${listenPort}`);
    console.log(`🔌 Upstream MCP: ${upstreamUrl}/mcp`);
    console.log(`📋 Proxied tools: ${tools.join(", ")}`);
  });
}

/**
 * Loads a required environment variable.
 *
 * @param key - Environment variable name.
 * @returns Non-empty environment value.
 */
function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    console.error(`❌ ${key} environment variable is required`);
    process.exit(1);
  }
  return value;
}
