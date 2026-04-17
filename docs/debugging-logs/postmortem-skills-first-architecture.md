# Post-Mortem: Skills-First Agent Architecture Failure

**Date:** 2026-04-16  
**Severity:** Architectural — required full rebuild decision  
**Author:** Claude (AI pair programmer) + xpriment626  
**Sessions:** 2 debugging sessions across April 15–16  

---

## Executive Summary

The solana-aat-library was built with a "skills-first, agent-second" development order: wrap SendAI's SKILL.md files into Coral-connected LLM agents, then retroactively add execution tools. This produced talking skill files, not agents. The architecture failed at two levels — OpenAI schema validation rejected tool definitions, and once that was fixed, agents could not sustain multi-turn coordination because their prompting, identity, and tool knowledge were fundamentally misaligned.

**Decision:** Full codebase reroll. Rebuild agents around SendAI's `solana-agent-kit` plugin system with a proven Coral agent pattern.

---

## Timeline

### Phase 1: Initial Build (pre-April 15)
- Generated 40 agent directories from SendAI's skills library
- Each agent: system prompt (skill identity) + SKILL.md fetched at startup + Coral MCP tools
- Validated basic 3-agent advisory conversation on Coral console — agents could TALK about skills
- No execution tools — agents were pure knowledge/conversation wrappers

### Phase 2: Tool Extensibility — Tier 1 (April 15)
- Added hand-built execution tools to 6 agents: coingecko, pyth, helius, switchboard, jupiter-swap, pumpfun
- Tools used raw `fetch()` against protocol APIs — no protocol SDKs
- Signing agents (jupiter-swap, pumpfun) integrated via shared wallet interface
- All tools defined with Zod schemas in `agents/*/tools.ts`

### Phase 3: Integration Testing — First Failures (April 15–16)
- Attempted multi-agent coordination: puppet orchestrating coingecko → pyth + helius
- **Error 1:** OpenAI rejected all agent tool schemas — `Invalid schema for function`
- **Error 2:** After schema fix, agents sent first messages but never picked up responses
- **Error 3:** After replay window fix, agents entered infinite loops — talking about actions without executing them

---

## Root Causes

### RC-1: OpenAI Strict Mode Schema Validation

**Symptom:** `Invalid schema for function 'coingecko_get_ohlcv': In context=(), 'aggregate' is missing from 'required'`

**Cause chain:**
1. Vercel AI SDK's `@ai-sdk/openai` provider auto-enables `structuredOutputs: true` for models matching `isReasoningModel()` (includes `gpt-5*`)
2. OpenAI strict mode requires EVERY key in a JSON Schema's `properties` to also appear in `required`
3. Zod `.optional()` produces a property WITHOUT a `required` entry — instant rejection
4. Zod `.default(value)` also does NOT put the field in `required` in the generated JSON Schema
5. The `patchSchemaForOpenAI()` function in `coral-loop.ts` only patched Coral MCP tools (bridged from the server), NOT agent-specific Zod tools — those were passed through raw

**Fix applied:**
- Enhanced `patchSchemaForOpenAI()` to force `required = Object.keys(properties)` on every object schema
- Added `patchAgentTools()` function to convert Zod-based agent tools through the same pipeline (Zod → `zod-to-json-schema` → patch → `jsonSchema()` re-wrap)
- Changed tool merging: `const aiTools = { ...coralTools, ...patchAgentTools(config.tools ?? {}) }`

**Status:** Fixed. All agent tools now pass OpenAI strict mode validation.

### RC-2: Coral Replay Window Race Condition

**Symptom:** Agents responded to the first mention but never picked up subsequent messages from other agents. 60-second timeouts on every `coral_wait_for_mention` after the first response.

**Cause:**
1. `coral_wait_for_mention` accepts a `currentUnixTime` parameter (defaults to `System.currentTimeMillis()`)
2. Messages with timestamps BEFORE `currentUnixTime` are invisible to the waiting agent
3. Without passing `currentUnixTime`, each wait call used "now" as the replay start
4. Messages sent by other agents DURING the `generateText` processing window (e.g., at T-1s) were before the new replay point (T) and thus invisible
5. Every agent was waiting for messages that had already been sent and missed

**Fix applied:**
- Track `lastMentionTimestamp = Date.now()` when each mention arrives
- Pass it as `currentUnixTime` on the NEXT `coral_wait_for_mention` call
- Ensures the replay window covers the entire processing gap

**Status:** Fix implemented. Resolved the message-missing problem but exposed RC-3.

### RC-3: Agents Cannot Sustain Multi-Turn Coordination (Architectural)

**Symptom:** After the replay window fix, agents entered infinite loops — coingecko and pyth repeatedly telling each other what they needed and that they'd send it, but never making actual tool calls.

**Cause:** This is not a single bug but six compounding design failures from the skills-first development path:

#### 3a. Identity Confusion
System prompts frame agents as skill/knowledge experts ("You are CoinGecko, a Solana skill…") rather than autonomous coordinators with execution capabilities. The model prioritizes its role as an information source over its role as a tool-calling agent.

**Evidence:** Agent system prompts open with `You are [SkillName], a Solana Skill specialized in…` followed by skill documentation. The "Your Tools" section listing execution capabilities is buried below.

#### 3b. Passive generateText Instruction
The coral-loop runtime passes a single user message: "Process this mention. Use coral_send_message to respond." This tells the model to RESPOND (one message) rather than to STAY IN CONVERSATION and FOLLOW THROUGH on multi-step tasks.

**Evidence:** In `coral-loop.ts` line ~259:
```typescript
messages: [{
  role: "user",
  content: [
    `<mention>\n${mentionPayload}\n</mention>`,
    `Process this mention. Use coral_send_message to respond…`,
  ].join("\n\n"),
}],
```

#### 3c. Model Never Calls coral_wait_for_agent
The LLM has access to `coral_wait_for_agent` within `generateText`, but never uses it. It sends one message and returns control to the outer loop. This means an agent cannot execute a multi-step workflow within a single `generateText` invocation — it processes one mention, sends one response, and exits.

**Evidence:** Coral server logs show only `coral_send_message` calls, never `coral_wait_for_agent` within a generateText run.

#### 3d. SKILL.md Content Drowns Out Coordination Instructions
The SKILL.md content (fetched from GitHub at startup) can be tens of thousands of characters of API documentation, code examples, and protocol details. It's appended to the system prompt AFTER the Coral coordination instructions, but its sheer volume drowns out the brief coordination protocol section.

**Evidence:** Helius SKILL.md alone is ~15KB. Coral coordination instructions are ~500 bytes. The model optimizes for the dominant signal.

#### 3e. No Task Lifecycle Concept
Agents process each mention as a stateless one-shot: receive → LLM generates → send response → forget. There's no concept of "I'm working on a task that requires multiple exchanges." Each mention starts from zero.

#### 3f. Empty mentions Field Description
Coral server's `SendMessageInput` has `@Description("")` on the `mentions` field. The model gets no guidance on how to format mentions to tag other agents, leading to inconsistent or missing agent targeting.

**Status:** NOT fixed. These are architectural issues that cannot be patched — they require redesigning how agents are constructed and prompted.

---

## What Worked

1. **Coral MCP bridging** — The MCP client connection, tool discovery, and Vercel AI SDK bridging work correctly. `bridgeTools()` reliably converts MCP tool schemas into callable AI SDK tools.

2. **OpenAI schema patching pipeline** — `patchSchemaForOpenAI()` correctly enforces strict mode compliance (additionalProperties, required arrays, numeric constraint stripping). The `patchAgentTools()` Zod-to-JSON-Schema conversion pipeline works.

3. **Shared wallet interface** — `Wallet` interface and `KeypairWallet` implementation work for transaction signing. Both Jupiter and PumpFun tools successfully sign and serialize transactions.

4. **Shared infrastructure** — `rpc.ts` singleton, `.env` loading, `startup.sh` pattern, TOML manifests, generator script — all functional.

5. **Individual tool execution** — The 6 hand-built tool sets (coingecko, pyth, helius, switchboard, jupiter-swap, pumpfun) work in isolation. API calls return correct data, transactions serialize properly.

---

## What Failed

1. **Development order** — Building skills → coralising → adding tools → retroactively configuring created a Frankenstein: agents that know about skills but don't know how to BE agents.

2. **Hand-building tools that already exist** — SendAI provides `solana-agent-kit` with 180+ pre-configured actions covering every protocol we were manually implementing. We reinvented the wheel for coingecko, jupiter, helius, pumpfun, pyth, and switchboard.

3. **Skill-as-identity pattern** — Treating SKILL.md content as the agent's identity instead of as a reference resource. The skill should inform the agent's capabilities, not define its existence.

4. **Single-shot processing model** — The generateText call handles one mention and exits. Real multi-agent coordination requires agents that can execute multi-step workflows: query tools, wait for responses, iterate.

5. **Prompt architecture** — Coral coordination instructions were a footnote in a prompt dominated by skill documentation. The model never learned to prioritize tool execution and inter-agent coordination.

---

## Architectural Observations

### SendAI's Intended Integration Pattern
SendAI's ecosystem has two complementary pieces:
- **Skills library** (`sendaifun/skills`): Markdown documentation files that teach agents about protocols
- **Agent Kit** (`sendaifun/solana-agent-kit`): Plugin system with 180+ pre-configured actions, Zod schemas, framework adapters

These are designed to be integrated INTO existing agents, not wrapped AS agents. The assumed pattern is "bring your own agent framework, plug in our tools and knowledge."

### What We Built vs. What Was Intended
| Aspect | Our Pattern | SendAI's Intended Pattern |
|--------|------------|--------------------------|
| Agent identity | Skill file expert | Developer-defined agent with Solana capabilities |
| Tools | Hand-built raw fetch() | Pre-configured plugin actions |
| Integration | Skills → Agent → Tools | Agent → Plugins → Skills as reference |
| Framework | Custom coral-loop.ts | Vercel AI / LangChain / OpenAI / Claude SDK |
| Ownership | "Bring your own everything" | "Bring your own agent, use our tools" |

### What the Pivot Preserves
- `shared/coral-loop.ts` — Agent-framework-agnostic runtime, works regardless of tool source
- MCP bridging + `patchSchemaForOpenAI` — Still needed for any tools flowing into OpenAI
- Coral coordination layer — This IS the unique value add
- Shared wallet interface — Still needed for signing agents
- TOML manifests + startup scripts — Still valid for Coral server discovery

### What the Pivot Replaces
- 36 remaining hand-built `agents/*/tools.ts` stubs → SendAI agent-kit plugins
- Possibly the 6 already-built tools.ts files → agent-kit equivalents if production-ready
- System prompt architecture → Agent-first identity with tools as capabilities
- Single-shot generateText pattern → Multi-step autonomous coordination

---

## Lessons Learned

1. **Development order matters.** "Skills-first" produced knowledge wrappers. "Agent-first" produces tool-calling coordinators. The difference isn't cosmetic — it determines whether the LLM treats tool execution as primary or secondary.

2. **Don't rebuild what exists.** SendAI explicitly provides a plugin library with 180+ actions, framework adapters, and wallet integration. Hand-building raw fetch() tools for the same protocols was wasted effort and introduced bugs they've already solved.

3. **Prompt real estate is finite.** A 15KB SKILL.md appended to a system prompt drowns out 500 bytes of coordination instructions. The model optimizes for the dominant signal. Coordination behavior requires coordination to be the dominant signal.

4. **Multi-agent coordination requires multi-step capability.** One-shot "process mention → respond → exit" cannot sustain a conversation. Agents need the ability to execute, wait, observe, and iterate within a single task lifecycle.

5. **Test the integration, not the components.** Individual tools worked. Individual Coral messaging worked. The 3-agent advisory conversation worked. None of these tested whether agents could coordinate to execute tools based on each other's requests — which is the actual product.

---

## Action Items

- [ ] Analyze SendAI agent-kit plugin inventory to determine agent composition strategy (category-based, capability-based, workflow-based)
- [ ] Study working Coral agent patterns (e.g., `Coral-Protocol/agents/koog`) for multi-step coordination architecture
- [ ] Design new agent identity/prompting architecture — agent-first, tools as capabilities, Coral coordination as primary behavior
- [ ] Rebuild agents using agent-kit plugins + proven Coral pattern
- [ ] Preserve and adapt shared infrastructure (coral-loop.ts, wallet.ts, rpc.ts, schema patching)
