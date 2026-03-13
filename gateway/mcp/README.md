# MCP Gateway (Codex + x402)

Gateway MCP service that sits between Codex and the domain MCP server.

Implementation:
- Express-based Streamable HTTP MCP endpoint handling (`POST/GET/DELETE /mcp`)
- `zod` validation for optional `__gateway` context (`userId`, `sessionId`)

Flow:
1. Codex connects to this gateway (`/mcp`)
2. Gateway proxies tools from upstream MCP
3. Paid tool calls are auto-paid through x402 client
4. Policy checks and audit logs are enforced before payment approval

## Setup

1. Copy env template:

```bash
cp .env-local .env
```

2. Fill required values:
- `EVM_PRIVATE_KEY`
- `MCP_UPSTREAM_URL` (default `http://localhost:4023`)
- `EVM_NETWORK` (example: `eip155:8283`)
- `EVM_CHAIN_ID` (example: `8283`)
- `EVM_RPC_URL`
- Optional policy/audit envs:
  - `PAID_TOOL_ALLOWLIST` (comma-separated)
  - `TOOL_MAX_PRICE_WEI` (`tool:amount,tool:amount`)
  - `SESSION_SPEND_LIMIT_WEI`
  - `DAILY_SPEND_LIMIT_WEI`
  - `AUDIT_LOG_PATH`

3. Install dependencies:

```bash
pnpm install
```

## Run

```bash
pnpm dev
```

Endpoints:
- `POST /mcp`
- `GET /mcp`
- `DELETE /mcp`
- `GET /health`

## Gateway Context

To control policy keys explicitly per call, include an optional `__gateway` object in tool args:

```json
{
  "city": "Seoul",
  "__gateway": {
    "userId": "user-123",
    "sessionId": "session-abc"
  }
}
```

If omitted, defaults are `DEFAULT_USER_ID` and `DEFAULT_SESSION_ID`.
If `__gateway` shape is invalid, it is ignored and defaults are used.

## Notes

- This gateway uses in-memory spend counters for session/day limits.
- Audit logs are written as JSONL to `AUDIT_LOG_PATH`.
- For production HA, move spend counters and audit sink to external storage.

## Test

```bash
pnpm test
```
