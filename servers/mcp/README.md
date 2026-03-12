# MCP Server (Basic)

Basic MCP server example with one paid tool (`get_weather`) and one free tool (`ping`).

## Setup

1. Copy env template:

```bash
cp .env-local .env
```

2. Fill required values:
- `EVM_ADDRESS`
- `FACILITATOR_URL`
- `EVM_NETWORK` (example: `eip155:84532`)
- `PORT` (optional, default `4023`)

3. Install dependencies:

```bash
pnpm install
```

## Run

```bash
pnpm dev
```

Server endpoints:
- `GET /sse`
- `POST /messages`
- `GET /health`

## Notes

- This package runs only the simple/basic flow.
- No advanced hooks or existing-server variants are included.
