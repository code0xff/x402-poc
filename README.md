# x402 MCP Gateway Manual Test Guide (Codex CLI, Local E2E)

This guide explains how to manually validate the local MCP flow with **Codex CLI**:

- `facilitator/basic` (payment facilitator)
- `servers/mcp` (upstream MCP server)
- `gateway/mcp` (gateway MCP server)
- Codex CLI registered to `gateway/mcp`

## 1. Prerequisites

- Node.js 20+ and `pnpm`
- Codex CLI installed and logged in
- A valid `EVM_PRIVATE_KEY` in `gateway/mcp/.env`

Check Codex CLI login:

```bash
codex login
```

## 2. Environment Setup

Prepare env files if not already done:

```bash
cp facilitator/basic/.env-local facilitator/basic/.env
cp servers/mcp/.env-local servers/mcp/.env
cp gateway/mcp/.env-local gateway/mcp/.env
```

Required values to verify:

- `facilitator/basic/.env`
  - `EVM_PRIVATE_KEY`
  - `EVM_NETWORK`
  - `EVM_CHAIN_ID`
  - `EVM_RPC_URL`
- `servers/mcp/.env`
  - `EVM_ADDRESS`
  - `FACILITATOR_URL` (default: `http://localhost:4022`)
  - `EVM_NETWORK`
- `gateway/mcp/.env`
  - `EVM_PRIVATE_KEY`
  - `MCP_UPSTREAM_URL` (default: `http://localhost:4023`)
  - `EVM_NETWORK`, `EVM_CHAIN_ID`, `EVM_RPC_URL`

## 3. Install Dependencies

```bash
pnpm -C facilitator/basic install
pnpm -C servers/mcp install
pnpm -C gateway/mcp install
```

## 4. Start Services (3 terminals)

Start in this order.

Terminal A:

```bash
pnpm -C facilitator/basic dev
```

Terminal B:

```bash
pnpm -C servers/mcp dev
```

Terminal C:

```bash
pnpm -C gateway/mcp dev
```

Expected startup ports:

- Facilitator: `http://localhost:4022`
- Upstream MCP: `http://localhost:4023`
- Gateway MCP: `http://localhost:4024`

## 5. Health Check

From a new terminal:

```bash
curl -sS http://127.0.0.1:4023/health
curl -sS http://127.0.0.1:4024/health
```

Expected:

- Upstream returns status with tool list (`get_weather`, `ping`)
- Gateway returns JSON containing `status`, `upstream`, and `tools`

## 6. Register Gateway MCP in Codex CLI

```bash
codex mcp remove x402-gateway || true
codex mcp add x402-gateway --url http://127.0.0.1:4024/mcp
codex mcp list
codex mcp get x402-gateway
```

Expected:

- `x402-gateway` is listed as enabled
- URL is `http://127.0.0.1:4024/mcp`

## 7. Manual E2E Tool Call (Ping)

```bash
codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox "Do not run any shell commands. Use MCP server x402-gateway and call ping tool exactly once. Return only the ping result text."
```

Expected:

- MCP startup shows `x402-gateway ready`
- tool call `x402-gateway.ping({})` succeeds
- final output includes `pong`

## 8. Optional Paid Tool Check

```bash
codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox "Do not run any shell commands. Use MCP server x402-gateway. Call tool x402-gateway.get_weather exactly once with arguments: {\"city\":\"Seoul\"}. If the tool call arguments differ from that JSON, report failure. Then return summarized weather result and whether payment was required."
```

Expected:

- tool call succeeds
- response payload includes payment/policy envelope fields

## 9. Quick Troubleshooting

- `Failed to fetch supported kinds from facilitator`
  - Facilitator is not running or `FACILITATOR_URL` is incorrect.
- `ECONNREFUSED` from gateway/upstream
  - Upstream or gateway is not running, or wrong port in env.
- MCP registered but calls fail
  - Re-register server:
  - `codex mcp remove x402-gateway && codex mcp add x402-gateway --url http://127.0.0.1:4024/mcp`
- Env validation errors at startup
  - Recheck required env variables in each package `.env`.

## 10. Teardown

Stop all services with `Ctrl+C` in each terminal.

Optional cleanup:

```bash
codex mcp remove x402-gateway
```
