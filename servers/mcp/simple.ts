/**
 * MCP Server with x402 Paid Tools - Simple Example
 *
 * This example demonstrates creating an MCP server with payment-wrapped tools.
 * Uses the createPaymentWrapper function to add x402 payment to individual tools.
 *
 * Run with: pnpm dev
 */

import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { createPaymentWrapper, x402ResourceServer } from "@x402/mcp";
import { HTTPFacilitatorClient } from "@x402/core/server";
import express from "express";
import { z } from "zod";

config();

const evmAddress = process.env.EVM_ADDRESS as `0x${string}`;
if (!evmAddress) {
  console.error("❌ EVM_ADDRESS environment variable is required");
  process.exit(1);
}

const facilitatorUrl = process.env.FACILITATOR_URL;
if (!facilitatorUrl) {
  console.error("❌ FACILITATOR_URL environment variable is required");
  process.exit(1);
}

const evmNetwork = process.env.EVM_NETWORK as `${string}:${string}`;
if (!evmNetwork) {
  console.error("❌ EVM_NETWORK environment variable is required");
  process.exit(1);
}

const port = parseInt(process.env.PORT || "4023", 10);

type SessionContext = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  createdAt: number;
};

/**
 * Simulates fetching weather data for a city.
 *
 * @param city - The city name to get weather for
 * @returns Weather data object
 */
function getWeatherData(city: string): { city: string; weather: string; temperature: number } {
  const conditions = ["sunny", "cloudy", "rainy", "snowy", "windy"];
  const weather = conditions[Math.floor(Math.random() * conditions.length)];
  const temperature = Math.floor(Math.random() * 40) + 40;
  return { city, weather, temperature };
}

/**
 * Main entry point - demonstrates the payment wrapper API.
 *
 * @returns Promise that resolves when server is running
 */
export async function main(): Promise<void> {
  console.log("\n📦 Using Payment Wrapper API\n");

  // ========================================================================
  // STEP 2: Set up x402 resource server for payment handling
  // ========================================================================
  const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });
  const resourceServer = new x402ResourceServer(facilitatorClient);
  resourceServer.register(evmNetwork, new ExactEvmScheme());
  await resourceServer.initialize();

  // ========================================================================
  // STEP 3: Build payment requirements
  // ========================================================================
  const weatherAccepts = await resourceServer.buildPaymentRequirements({
    scheme: "exact",
    network: evmNetwork,
    payTo: evmAddress,
    price: { amount: "10000000000000000000", asset: "0x0000000000000000000000000000000000001000" },
    extra: { name: "WKRC", version: "1" }, // EIP-712 domain parameters
  });

  // ========================================================================
  // STEP 4: Create payment wrapper with accepts array
  // ========================================================================
  const paidWeather = createPaymentWrapper(resourceServer, {
    accepts: weatherAccepts,
  });

  const createServer = (): McpServer => {
    const mcpServer = new McpServer({
      name: "x402 Weather Service",
      version: "1.0.0",
    });

    mcpServer.registerTool(
      "get_weather",
      {
        description: "Get current weather for a city. Requires payment of 10 KRW.",
        inputSchema: { city: z.string().describe("The city name to get weather for") },
      },
      paidWeather(async (args: { city: string }) => ({
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(getWeatherData(args.city), null, 2),
          },
        ],
      })),
    );

    mcpServer.registerTool("ping", { description: "A free health check tool" }, async () => ({
      content: [{ type: "text", text: "pong" }],
    }));

    return mcpServer;
  };

  // Start Express server for Streamable HTTP transport
  startExpressServer(createServer, port);
}

/**
 * Helper to start Express Streamable HTTP server.
 *
 * @param createServer - Factory that returns a new MCP server per session
 * @param port - Port to listen on
 */
function startExpressServer(createServer: () => McpServer, port: number): void {
  const app = express();
  const sessions: Record<string, SessionContext> = {};

  app.use(express.json());

  app.post("/mcp", async (req, res) => {
    const sessionIdHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

    try {
      let transport: StreamableHTTPServerTransport;

      if (sessionId && sessions[sessionId]) {
        transport = sessions[sessionId].transport;
      } else if (!sessionId && isInitializeRequest(req.body)) {
        const server = createServer();
        const nextSession: SessionContext = {
          server,
          transport: new StreamableHTTPServerTransport({
            sessionIdGenerator: randomUUID,
            onsessioninitialized: initializedSessionId => {
              sessions[initializedSessionId] = nextSession;
            },
          }),
          createdAt: Date.now(),
        };
        transport = nextSession.transport;
        transport.onclose = () => {
          const currentSessionId = transport.sessionId;
          if (currentSessionId && sessions[currentSessionId]) {
            delete sessions[currentSessionId];
          }
        };

        await server.connect(transport);
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: No valid session ID provided",
          },
          id: null,
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("Error handling MCP POST request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", async (req, res) => {
    const sessionIdHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
    if (!sessionId || !sessions[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await sessions[sessionId].transport.handleRequest(req, res);
  });

  app.delete("/mcp", async (req, res) => {
    const sessionIdHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
    if (!sessionId || !sessions[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    await sessions[sessionId].transport.handleRequest(req, res);
  });

  app.get("/health", (_, res) => {
    res.json({ status: "ok", tools: ["get_weather (paid: 10 KRW)", "ping (free)"] });
  });

  app.listen(port, () => {
    console.log(`🚀 x402 MCP Server running on http://localhost:${port}`);
    console.log(`\n📋 Available tools:`);
    console.log(`   - get_weather (paid: 10 KRW)`);
    console.log(`   - ping (free)`);
    console.log(`\n🔗 Connect via Streamable HTTP: http://localhost:${port}/mcp`);
    console.log(`\n💡 This example uses createPaymentWrapper() to add payment to tools.\n`);
  });
}
