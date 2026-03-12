import { x402Facilitator } from "@x402/core/facilitator";
import {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@x402/core/types";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import dotenv from "dotenv";
import express from "express";
import { type Chain, createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";

dotenv.config();

const port = parseInt(process.env.PORT || "4022", 10);

const evmPrivateKey = process.env.EVM_PRIVATE_KEY as `0x${string}` | undefined;
if (!evmPrivateKey) {
  console.error("❌ EVM_PRIVATE_KEY environment variable is required");
  process.exit(1);
}

const evmNetwork = process.env.EVM_NETWORK;
if (!evmNetwork) {
  console.error(
    "❌ EVM_NETWORK environment variable is required (example: eip155:84532)",
  );
  process.exit(1);
}

const evmRpcUrl = process.env.EVM_RPC_URL;
if (!evmRpcUrl) {
  console.error("❌ EVM_RPC_URL environment variable is required");
  process.exit(1);
}

const evmChainIdRaw = process.env.EVM_CHAIN_ID;
if (!evmChainIdRaw) {
  console.error("❌ EVM_CHAIN_ID environment variable is required");
  process.exit(1);
}

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

const evmNetworkChainId = Number(evmNetworkMatch[1]);
if (evmNetworkChainId !== evmChainId) {
  console.error(
    `❌ EVM_NETWORK (${evmNetwork}) and EVM_CHAIN_ID (${evmChainId}) must reference the same chain`,
  );
  process.exit(1);
}
const evmNetworkCaip = evmNetwork as `${string}:${string}`;

const evmAccount = privateKeyToAccount(evmPrivateKey);
console.info(`EVM Facilitator account: ${evmAccount.address}`);

const chain: Chain = {
  id: evmChainId,
  name: `evm-${evmChainId}`,
  nativeCurrency: { name: "WKRC", symbol: "WKRC", decimals: 18 },
  rpcUrls: {
    default: { http: [evmRpcUrl] },
    public: { http: [evmRpcUrl] },
  },
};

const viemClient = createWalletClient({
  account: evmAccount,
  chain,
  transport: http(evmRpcUrl),
}).extend(publicActions);

const evmSigner = toFacilitatorEvmSigner({
  getCode: (args: { address: `0x${string}` }) => viemClient.getCode(args),
  address: evmAccount.address,
  readContract: (args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }) =>
    viemClient.readContract({
      ...args,
      args: args.args || [],
    }),
  verifyTypedData: (args: {
    address: `0x${string}`;
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
    signature: `0x${string}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) => viemClient.verifyTypedData(args as any),
  writeContract: (args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }) =>
    viemClient.writeContract({
      ...args,
      args: args.args || [],
    }),
  sendTransaction: (args: { to: `0x${string}`; data: `0x${string}` }) =>
    viemClient.sendTransaction(args),
  waitForTransactionReceipt: (args: { hash: `0x${string}` }) =>
    viemClient.waitForTransactionReceipt(args),
});

const facilitator = new x402Facilitator();
facilitator.register(
  evmNetworkCaip,
  new ExactEvmScheme(evmSigner, { deployERC4337WithEIP6492: true }),
);

const app = express();
app.use(express.json());

app.post("/verify", async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body as {
      paymentPayload: PaymentPayload;
      paymentRequirements: PaymentRequirements;
    };

    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({
        error: "Missing paymentPayload or paymentRequirements",
      });
    }

    const response: VerifyResponse = await facilitator.verify(
      paymentPayload,
      paymentRequirements,
    );

    res.json(response);
  } catch (error) {
    console.error("Verify error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/settle", async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body;

    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({
        error: "Missing paymentPayload or paymentRequirements",
      });
    }

    const response: SettleResponse = await facilitator.settle(
      paymentPayload as PaymentPayload,
      paymentRequirements as PaymentRequirements,
    );

    res.json(response);
  } catch (error) {
    console.error("Settle error:", error);

    if (
      error instanceof Error &&
      error.message.includes("Settlement aborted:")
    ) {
      return res.json({
        success: false,
        errorReason: error.message.replace("Settlement aborted: ", ""),
        network: req.body?.paymentPayload?.network || "unknown",
      } as SettleResponse);
    }

    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/supported", async (_req, res) => {
  try {
    const response = facilitator.getSupported();
    res.json(response);
  } catch (error) {
    console.error("Supported error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    network: evmNetwork,
    chainId: evmChainId,
  });
});

app.listen(port, () => {
  console.log(`🚀 Facilitator listening on http://localhost:${port}`);
  console.log(`   Network: ${evmNetwork}`);
  console.log(`   Chain ID: ${evmChainId}`);
  console.log(`   RPC URL: ${evmRpcUrl}`);
  console.log();
});
