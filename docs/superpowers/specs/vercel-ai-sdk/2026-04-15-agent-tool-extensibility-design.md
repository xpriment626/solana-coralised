# Agent Tool Extensibility Design

**Date:** 2026-04-15
**Status:** Approved — Pre-overlay. Predates the CLAUDE.md documentation pipeline conventions (no Decomposition Index, no Plan Index). Do not use as a template for new specs.
**Scope:** Give the 40 Coralised agents real execution tools so they can act on their skills, not just discuss them.

---

## Problem

The library has 40 agents, each wrapping a SendAI Solana skill into a single-purpose Coral agent. They can communicate through Coral about what they know (via SKILL.md context), but they cannot execute anything. They have no HTTP tools, no transaction building, no wallet access. A developer downloading this library gets coordinated advisors, not coordinated executors.

For the library to deliver on its value proposition — pre-configured agents with bi-directional communication that you can spin into any combination — agents must ship with the tools to do what their skills describe.

## Design Principles

These emerged from the brainstorming session and are grounded in the project's "Agents as Capabilities" thesis:

1. **The agent is the unit of composition, not the tool.** Developers compose agents by grouping them in Coral sessions. Tools are scoped to the agent that owns them. No shared tool plugins, no tool portability between agents.

2. **1 skill + all its tools = 1 agent.** Each agent is self-contained: its domain knowledge (system prompt + SKILL.md), its execution tools (tools.ts), and its coordination capability (Coral). Looking at an agent's directory tells you everything it can do.

3. **Full execution out of the box.** Agents ship with tools to do everything their SKILL.md describes, including transaction signing. The developer provides a wallet and API keys. This is the only option that justifies downloading a library instead of loading skills into existing agents.

4. **Hand-written tools over generated abstractions.** LLM non-determinism means a schema-driven generator that works with one model may silently fail with another. Hand-written tools with explicit Zod schemas give the LLM precise parameter names, types, and descriptions with no interpretation required.

5. **One wallet per agent.** Every major agent wallet provider (Turnkey, Privy, Crossmint, Botwallet) converges on this pattern. Shared wallets create race conditions when multiple agents build and sign transactions concurrently. The wallet interface is designed for per-agent instances.

---

## Architecture

### Runtime Changes (`shared/coral-loop.ts`)

`AgentConfig` gains two optional fields:

```ts
export interface AgentConfig {
  name: string;
  systemPrompt: string;
  skillUrl?: string;
  model?: string;
  maxSteps?: number;
  tools?: Record<string, Tool>;   // agent-specific execution tools
  wallet?: Wallet;                 // optional — only for signing agents
}
```

In `runCoralAgent()`, agent tools merge with Coral tools:

```ts
const coralTools = bridgeTools(mcpTools, client);
const allTools = { ...coralTools, ...(config.tools ?? {}) };
```

Flat merge into a single tool map. The LLM sees both Coral coordination tools and domain execution tools and picks the right one based on context.

### Wallet Interface (`shared/wallet.ts`)

```ts
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

export interface Wallet {
  publicKey: PublicKey;
  signTransaction(tx: Transaction | VersionedTransaction): Promise<Transaction | VersionedTransaction>;
  signAllTransactions(txs: (Transaction | VersionedTransaction)[]): Promise<(Transaction | VersionedTransaction)[]>;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}
```

This interface matches the standard Solana wallet adapter contract used by Turnkey (`TurnkeySigner`), Privy (server wallets), Crossmint (smart wallets), and SendAI's agent kit. Any provider that implements these four members is a drop-in replacement.

**Dev-only default — `KeypairWallet`:**

```ts
export class KeypairWallet implements Wallet {
  private keypair: Keypair;
  publicKey: PublicKey;

  constructor(secretKey: Uint8Array) {
    this.keypair = Keypair.fromSecretKey(secretKey);
    this.publicKey = this.keypair.publicKey;
  }

  async signTransaction(tx: Transaction | VersionedTransaction) { /* sign with keypair */ }
  async signAllTransactions(txs: (Transaction | VersionedTransaction)[]) { /* sign all */ }
  async signMessage(message: Uint8Array) { /* nacl.sign.detached */ }
}
```

`KeypairWallet` holds a raw private key in memory. It is explicitly for local development and demos. Production deployments should use a managed wallet provider (Turnkey, Privy, or similar). The library does not bundle any provider SDK — developers install their chosen provider and wrap it in the `Wallet` interface.

**Wallet provider decision is deferred.** Turnkey (best Solana support, lowest latency) and Privy (most generous free tier, Stripe ecosystem) are the leading candidates. The interface is designed so this decision doesn't affect any agent code.

### Shared RPC Helper (`shared/rpc.ts`)

A thin helper that creates a `Connection` instance from `SOLANA_RPC_URL`:

```ts
import { Connection } from "@solana/web3.js";

let _connection: Connection | null = null;

export function getConnection(): Connection {
  if (!_connection) {
    const url = process.env.SOLANA_RPC_URL;
    if (!url) { console.error("Missing SOLANA_RPC_URL"); process.exit(1); }
    _connection = new Connection(url, "confirmed");
  }
  return _connection;
}
```

Shared across all tool handlers within an agent process. One connection per agent, not per tool call.

### Per-Agent Tool Structure

Each agent directory gains a `tools.ts` file:

```
agents/jupiter-swap/
├── coral-agent.toml      # Coral discovery metadata (exists)
├── index.ts              # Agent entry point (modified)
├── tools.ts              # NEW — hand-written domain tools
└── startup.sh            # Coral-launched startup (exists)
```

**Signing agents** — `tools.ts` exports a factory function:

```ts
// agents/jupiter-swap/tools.ts
import type { Wallet } from "../../shared/wallet.js";
import { getConnection } from "../../shared/rpc.js";
import { tool } from "ai";
import { z } from "zod";

export function createTools(wallet: Wallet) {
  return {
    jupiter_get_quote: tool({
      description: "Get a swap quote from Jupiter for a token pair",
      parameters: z.object({
        inputMint: z.string().describe("Source token mint address"),
        outputMint: z.string().describe("Destination token mint address"),
        amount: z.number().describe("Amount in smallest unit (lamports)"),
        slippageBps: z.number().optional().describe("Slippage tolerance in basis points (default 50)"),
      }),
      execute: async ({ inputMint, outputMint, amount, slippageBps }) => {
        // HTTP GET to Jupiter quote API, return parsed quote
      },
    }),
    jupiter_execute_swap: tool({
      description: "Execute a token swap on Jupiter — builds, signs, and submits the transaction",
      parameters: z.object({
        inputMint: z.string().describe("Source token mint address"),
        outputMint: z.string().describe("Destination token mint address"),
        amount: z.number().describe("Amount in smallest unit (lamports)"),
        slippageBps: z.number().optional().describe("Slippage tolerance in basis points (default 50)"),
      }),
      execute: async (params) => {
        // 1. Fetch quote from Jupiter
        // 2. POST to Jupiter swap API to get serialized transaction
        // 3. Deserialize, wallet.signTransaction(tx)
        // 4. Submit via getConnection().sendRawTransaction()
        // 5. Return { signature, inputAmount, outputAmount }
      },
    }),
  };
}
```

**Read-only agents** — `tools.ts` exports a plain object:

```ts
// agents/coingecko/tools.ts
import { tool } from "ai";
import { z } from "zod";

export const tools = {
  coingecko_get_token_price: tool({
    description: "Get the current USD price of a token by its CoinGecko ID or contract address",
    parameters: z.object({
      tokenId: z.string().describe("CoinGecko token ID or Solana mint address"),
    }),
    execute: async ({ tokenId }) => {
      // HTTP GET to CoinGecko API, return price data
    },
  }),
};
```

**Agent `index.ts` wiring:**

```ts
// Signing agent (e.g., jupiter-swap)
import { runCoralAgent } from "../../shared/coral-loop.js";
import { KeypairWallet } from "../../shared/wallet.js";
import { createTools } from "./tools.js";
import bs58 from "bs58";

const wallet = new KeypairWallet(bs58.decode(process.env.SOLANA_PRIVATE_KEY!));
const tools = createTools(wallet);

runCoralAgent({ name: "solana-jupiter-swap", systemPrompt: SYSTEM_PROMPT, tools });
```

```ts
// Read-only agent (e.g., coingecko)
import { runCoralAgent } from "../../shared/coral-loop.js";
import { tools } from "./tools.js";

runCoralAgent({ name: "solana-coingecko", systemPrompt: SYSTEM_PROMPT, tools });
```

### System Prompt Changes

Each agent's system prompt gains a "Your Tools" section between domain expertise and Coral instructions:

```
You are solana-jupiter-swap, a specialised Solana agent.

[domain expertise paragraph]

## Your Tools

You have the following tools available for direct execution:
- jupiter_get_quote: Get a swap quote from Jupiter for a token pair
- jupiter_execute_swap: Execute a token swap — builds, signs, and submits the transaction

When a user or another agent asks you to perform an action that matches your tools, USE THEM.
Do not describe how to perform the action — execute it directly using your tools.
If an action is outside your tool set, say so and suggest which agent might help.

## Solana Skill Reference
[SKILL.md content fetched at startup — deep API knowledge as fallback reference]

## Coral Coordination Protocol
[existing Coral instructions — unchanged]
```

The critical addition is the behavioral directive: "Do not describe how to perform the action — execute it directly." Without this, agents default to their current advisory behavior.

### Generator Script Changes

`scripts/generate-agents.ts` is updated to:

1. **Produce the new `index.ts` template** — with tools import and optional wallet construction. Each `AgentDef` gains a `signing: boolean` field to determine which template to use.

2. **Scaffold an empty `tools.ts`** — with a placeholder export (`export const tools = {}` or `export function createTools(wallet: Wallet) { return {}; }`). This lets the agent compile while tools are being authored. The generator does NOT produce tool implementations.

3. **Generate the "Your Tools" system prompt section** — initially empty (since tools.ts starts as a placeholder), updated manually as tools are written.

**Generator vs hand-maintenance boundary:** The generator scaffolds all three files (`index.ts`, `tools.ts`, `coral-agent.toml`, `startup.sh`) for new agents. Once an agent's `tools.ts` is hand-written and its `index.ts` is modified to wire in tools/wallet, that agent is considered hand-maintained. Re-running the generator should **skip agents that already have a non-placeholder `tools.ts`** (detected by checking whether the file contains more than just the empty placeholder export). This prevents the generator from overwriting manual work while still allowing it to scaffold new agents added to the `AgentDef` array.

---

## Dependencies

Added to root `package.json`:

| Package | Purpose |
|---------|---------|
| `@solana/web3.js` | `Keypair`, `PublicKey`, `Transaction`, `VersionedTransaction`, `Connection` — core types for wallet interface and RPC |
| `bs58` | Base58 decode for `SOLANA_PRIVATE_KEY` from env vars |

No protocol-specific SDKs at root level. Agents in Tier 2+ that need heavier dependencies (Orca Whirlpools SDK, Kamino klend-sdk) will document those as needed when they're built.

---

## Build Priority

### Tier 1 — Prove the architecture (6 agents)

| Agent | Tools | Auth | Wallet needed |
|-------|-------|------|---------------|
| coingecko | `get_token_price`, `get_ohlcv`, `get_pool_data` | Free demo key | No |
| pyth | `get_price_feed`, `get_ema_price` | Public, no auth | No |
| helius | `get_asset`, `get_assets_by_owner`, `get_priority_fees`, `get_transaction` | API key (have it) | No |
| switchboard | `get_feed_data`, `get_vrf_result` | Optional key | No |
| jupiter-swap | `get_quote`, `execute_swap`, `get_token_list` | Free API | Yes |
| pumpfun | `create_token`, `buy_token`, `sell_token` | Public endpoints | Yes |

These 6 agents validate:
- Read-only tools (CoinGecko, Pyth, Helius, Switchboard)
- Signing tools (Jupiter, PumpFun)
- Wallet interface in practice
- Coral coordination between agents that can actually execute
- The full loop: mention -> LLM reasons -> tool executes -> result posted to thread

### Tier 2 — Expand with moderate effort (19 agents)

**DeFi protocols:** Meteora, Orca, Raydium, Kamino, MarginFi, Lulo, Sanctum, Lavarage, Ranger Finance, GLAM, Manifest. These need SDK integrations or multi-step flows but follow the same architecture.

**Infrastructure (read-only HTTP):** QuickNode, Carbium. Similar to Helius — HTTP tools for RPC, streaming, and data queries.

**Composite agents:** Helius-DFlow, Helius-Phantom. Combine capabilities from two domains. Tools are a superset of their constituent agents.

**NFTs & digital assets:** Metaplex. Umi framework integration for NFT operations.

**Cross-chain:** deBridge. Bridge operations require transaction signing on both source and destination chains.

**Wallet & multisig:** Squads. Multisig operations, vault management.

**Privacy:** Light Protocol. ZK compression, compressed token operations.

### Tier 3 — Blocked or requires external access (5 agents)

DFlow (API key from hello@dflow.net), MetEngine (x402 payments), CT-Alpha (Twitter $100/mo Basic tier), Inco-SVM (niche confidential computing), MagicBlock (specialized ephemeral rollup infra).

### Tier 4 — Knowledge agents (10 agents)

**Dev tools & education:** Solana-kit, Solana-kit-migration, SVM, Pinocchio, Solana-agent-kit, Surfpool. Their value is teaching SDK patterns, architecture concepts, and migration guidance.

**Security (needs filesystem access):** VulnHunter, Code-recon. These need file reading and code analysis tools — a different kind of tool than HTTP/signing. Out of scope for this design but noted for a future pass.

**Wallet SDKs (guidance, not execution):** Phantom Connect, Phantom Wallet MCP. These teach wallet integration patterns. The library's own wallet interface handles actual signing — these agents advise on Phantom-specific frontend integration.

---

## Explicit Scope Cuts

The following are deferred from the first implementation pass. Each is expected to become relevant and will need its own design session:

1. **Human-in-the-loop approval gates** — Agents execute without confirmation.
2. **Spending limits / policy enforcement** — Deferred to wallet provider.
3. **Inter-agent dependency awareness** — No hardcoded delegation chains. Agents discover each other through Coral.
4. **Transaction simulation** — No `simulateTransaction` before submitting.
5. **Retry logic / confirmation polling** — Tools return signatures, don't track confirmation.
6. **x402 payment integration** — Blocked on wallet provider decision.
7. **Rate limiting / cost tracking** — No budget caps or throttling.
8. **Local SKILL.md caching** — Still fetching from GitHub on every startup.

---

## Key Design Decisions and Rationale

| Decision | Chosen | Rejected | Why |
|----------|--------|----------|-----|
| Execution capability | Full execution (Option C) | Talk-only (A), Read-only (B) | A leaves 90% of work to developer. B is worse than A from perception ("too lazy to add writes?"). C is the only option that backs up the library's value proposition. |
| Tool architecture | Tools as files (Approach 2) | Plugin layer (Approach 1), Coral-routed tools (Approach 3) | Approach 2's composability is at the agent level, which is what matters for "pick agents, group them, let them coordinate." Approach 1's plugin composability works against the "agent = capability" thesis by making agents generic containers. Approach 3 (Coral-routed) was rejected as "a house of cards" — novel for demos, fragile for real use. |
| Tool implementation | Hand-written per agent | Schema-driven generator | LLM non-determinism means a generator that works with one model may silently fail with another. Hand-written tools remove that variable. Maintenance cost is real but manageable for an experimental library with potential for more contributors. |
| Wallet architecture | Per-agent wallets, shared interface | Shared keypair, wallet-as-Coral-agent | Shared keypair causes race conditions when multiple agents sign concurrently. Wallet-as-Coral-agent adds 3 LLM calls per signature with non-deterministic return types. Per-agent wallets with a typed interface are fast, deterministic, and match industry consensus. |
| Wallet provider | Interface + KeypairWallet default, provider TBD | Committing to Turnkey or Privy now | Premature to commit. Turnkey has best Solana DX and latency. Privy has best free tier and Stripe ecosystem. Decision deferred until hands-on evaluation. |
| Build order | Tier 1 first (6 agents) | Build all 40 at once | 6 agents prove the entire architecture. No point writing 200 tools before validating the pattern works end-to-end. |
