/**
 * MCP Server with x402 Paid Tools - Simple Example
 *
 * This example demonstrates creating an MCP server with payment-wrapped tools.
 * Uses the createPaymentWrapper function to add x402 payment to individual tools.
 *
 * Run with: pnpm dev
 */

import { config } from "dotenv";
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
  // STEP 1: Create standard MCP server
  // ========================================================================
  const mcpServer = new McpServer({
    name: "x402 Weather Service",
    version: "1.0.0",
  });

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

  // ========================================================================
  // STEP 5: Register tools using native McpServer.tool() API
  // ========================================================================

  // Paid tool - wrap handler with payment
  mcpServer.tool(
    "get_weather",
    "Get current weather for a city. Requires payment of $0.001.",
    { city: z.string().describe("The city name to get weather for") },
    paidWeather(async (args: { city: string }) => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(getWeatherData(args.city), null, 2),
        },
      ],
    })),
  );

  // Free tool - no wrapper needed
  mcpServer.tool("ping", "A free health check tool", {}, async () => ({
    content: [{ type: "text", text: "pong" }],
  }));

  // Start Express server for Streamable HTTP transport
  startExpressServer(mcpServer, port);
}

/**
 * Helper to start Express Streamable HTTP server.
 *
 * @param mcpServer - The MCP server instance
 * @param port - Port to listen on
 */
function startExpressServer(mcpServer: McpServer, port: number): void {
  const app = express();
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  app.use(express.json());

  app.post("/mcp", async (req, res) => {
    const sessionIdHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;

    try {
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: initializedSessionId => {
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
