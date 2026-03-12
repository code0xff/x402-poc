# MCP Client (Basic)

Basic MCP client example that:
1. Connects to MCP server
2. Calls free tool (`ping`)
3. Calls paid tool (`get_weather`) with auto payment

## Setup

1. Copy env template:

```bash
cp .env-local .env
```

2. Fill required values:
- `EVM_PRIVATE_KEY`
- `MCP_SERVER_URL` (optional, default `http://localhost:4023`)
- `EVM_NETWORK` (example: `eip155:84532`)

3. Install dependencies:

```bash
pnpm install
```

## Run

```bash
pnpm dev
```

## Notes

- This package runs only the simple/basic flow.
- Advanced/manual client and chatbot examples are removed.
