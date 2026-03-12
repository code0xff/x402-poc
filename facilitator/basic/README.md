# x402 Facilitator (Basic EVM)

Basic facilitator service for EVM network only.

## Setup

1. Copy env template:

```bash
cp .env-local .env
```

2. Fill required values:
- `EVM_PRIVATE_KEY`
- `EVM_NETWORK` (format: `eip155:<chainId>`, example: `eip155:84532`)
- `EVM_CHAIN_ID` (example: `84532`)
- `EVM_RPC_URL`
- `PORT` (optional, default `4022`)

`EVM_NETWORK` and `EVM_CHAIN_ID` must match (same chain id), otherwise startup fails.

3. Install dependencies:

```bash
cd ../../
pnpm install
cd facilitator/basic
```

## Run

```bash
pnpm dev
```

## API

- `GET /supported`
- `POST /verify`
- `POST /settle`
- `GET /health`

## Notes

- This package is EVM-only basic mode.
- Solana/Stellar and advanced multi-network examples are not included.
