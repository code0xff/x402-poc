import { main } from "./simple.js";

/**
 * Runs the MCP gateway service.
 */
async function run(): Promise<void> {
  await main();
}

run().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
