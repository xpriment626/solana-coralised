import type { Wallet } from "../../shared/wallet.js";
import { VersionedTransaction } from "@solana/web3.js";
import { tool } from "ai";
import { z } from "zod";

const JUPITER_API = "https://api.jup.ag/ultra/v1";

function jupiterHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const apiKey = process.env.JUPITER_API_KEY;
  if (apiKey) headers["x-api-key"] = apiKey;
  return headers;
}

export function createTools(wallet: Wallet) {
  return {
    jupiter_get_quote: tool({
      description:
        "Get a swap quote from Jupiter Ultra API for a token pair. Returns estimated output amount and routing info without executing.",
      parameters: z.object({
        inputMint: z
          .string()
          .describe("Source token mint address"),
        outputMint: z
          .string()
          .describe("Destination token mint address"),
        amount: z
          .number()
          .describe(
            "Amount in smallest unit (e.g. lamports for SOL, where 1 SOL = 1_000_000_000 lamports)"
          ),
        slippageBps: z
          .number()
          .optional()
          .describe(
            "Slippage tolerance in basis points (default 50 = 0.5%)"
          ),
      }),
      execute: async ({
        inputMint,
        outputMint,
        amount,
        slippageBps,
      }) => {
        const params = new URLSearchParams({
          inputMint,
          outputMint,
          amount: String(amount),
          taker: wallet.publicKey.toBase58(),
        });
        if (slippageBps)
          params.set("slippageBps", String(slippageBps));

        const res = await fetch(
          `${JUPITER_API}/order?${params}`,
          { headers: jupiterHeaders() }
        );
        if (!res.ok) {
          const err = await res.text();
          return {
            error: `Jupiter API error ${res.status}: ${err}`,
          };
        }
        const data = await res.json();
        return {
          inputMint,
          outputMint,
          inAmount: data.inAmount,
          outAmount: data.outAmount,
          priceImpactPct: data.priceImpactPct,
          routePlan: data.routePlan,
        };
      },
    }),

    jupiter_execute_swap: tool({
      description:
        "Execute a token swap on Jupiter — gets a quote, signs the transaction, and submits it on-chain. Returns the transaction signature.",
      parameters: z.object({
        inputMint: z
          .string()
          .describe("Source token mint address"),
        outputMint: z
          .string()
          .describe("Destination token mint address"),
        amount: z
          .number()
          .describe(
            "Amount in smallest unit (e.g. lamports for SOL, where 1 SOL = 1_000_000_000 lamports)"
          ),
        slippageBps: z
          .number()
          .optional()
          .describe(
            "Slippage tolerance in basis points (default 50 = 0.5%)"
          ),
      }),
      execute: async ({
        inputMint,
        outputMint,
        amount,
        slippageBps,
      }) => {
        // 1. Get order (quote + unsigned transaction)
        const params = new URLSearchParams({
          inputMint,
          outputMint,
          amount: String(amount),
          taker: wallet.publicKey.toBase58(),
        });
        if (slippageBps)
          params.set("slippageBps", String(slippageBps));

        const orderRes = await fetch(
          `${JUPITER_API}/order?${params}`,
          { headers: jupiterHeaders() }
        );
        if (!orderRes.ok) {
          const err = await orderRes.text();
          return {
            error: `Jupiter order error ${orderRes.status}: ${err}`,
          };
        }
        const order = await orderRes.json();

        // 2. Deserialize and sign the transaction
        const txBuf = Buffer.from(order.transaction, "base64");
        const tx = VersionedTransaction.deserialize(txBuf);
        await wallet.signTransaction(tx);

        // 3. Submit signed transaction to Jupiter execute endpoint
        const execRes = await fetch(`${JUPITER_API}/execute`, {
          method: "POST",
          headers: jupiterHeaders(),
          body: JSON.stringify({
            signedTransaction: Buffer.from(
              tx.serialize()
            ).toString("base64"),
            requestId: order.requestId,
          }),
        });
        if (!execRes.ok) {
          const err = await execRes.text();
          return {
            error: `Jupiter execute error ${execRes.status}: ${err}`,
          };
        }
        const result = await execRes.json();
        return {
          signature: result.signature,
          inputMint,
          outputMint,
          inAmount: order.inAmount,
          outAmount: order.outAmount,
        };
      },
    }),

    jupiter_get_token_info: tool({
      description:
        "Look up token metadata (name, symbol, decimals, logo) by mint address from Jupiter's token registry",
      parameters: z.object({
        mint: z.string().describe("Token mint address"),
      }),
      execute: async ({ mint }) => {
        const res = await fetch(
          `https://tokens.jup.ag/token/${mint}`
        );
        if (!res.ok)
          return {
            error: `Jupiter token lookup error ${res.status}`,
          };
        return res.json();
      },
    }),
  };
}
