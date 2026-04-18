# Pairwise Port to pi-mono Implementation Plan

> **STATUS: FAILED on H2 (2026-04-18). DO NOT RE-EXECUTE.**
> The execution attempt regressed the receive path that was already working in Gen 2 (`atoms-runtime`). Both atoms ended up never receiving the puppet seed. Full evidence + post-mortem: [`docs/decomposition/ts-coral-framework/pi-mono-pairwise-first-run.md`](../../../decomposition/ts-coral-framework/pi-mono-pairwise-first-run.md). Branch archived as git tag `archive/pi-mono-attempt-1`.
> The next attempt is fixture-first, not plan-first. See [`docs/fixtures/coral-wire-traces/README.md`](../../../fixtures/coral-wire-traces/README.md).
> This plan is retained as evidence; the runtime mechanics it describes are not invalidated, but the execution approach (plan-driven decomposition without a receive-path regression test) is.

---

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the `market-signal-pairwise` molecule (atoms `trends` + `info`) from the hand-rolled Vercel AI SDK runtime to pi-mono (`@mariozechner/pi-agent-core` + `@mariozechner/pi-ai`), wiring per-atom runtime state machines (runtime-managed tool gating + runtime-driven finalization) to validate hypothesis H2 from the TS Coral Framework Thesis: *runtime-managed tools + runtime-driven finalization eliminate `message_non_execution`*.

**Architecture:** Keep Gen 2 Coral infrastructure (`scripts/run-pairwise.ts`, `molecules/`, `evaluation/`, `agents/*/coral-agent.toml`) untouched — it's framework-agnostic (REST + protocol). Replace Gen 2 runtime (`src/runtime/`, `src/agent-kit/`) and atom entrypoints (`agents/trends/index.ts`, `agents/info/index.ts`) with pi-mono-native equivalents at the same file paths. Each atom owns a typed state machine: phases are tracked in closure state; `beforeToolCall` rejects calls that violate the phase contract; `subscribe("turn_end")` inspects state and — when the phase reaches terminal — the runtime composes the `atom_result` envelope from accumulated state and posts it via the Coral MCP client directly, then calls `agent.abort()`. The model never calls `coral_send_message`; the runtime does.

**Tech Stack:** pi-mono (`@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`), `@sinclair/typebox` for tool/message schemas, `@modelcontextprotocol/sdk` for Coral MCP transport, `vitest` for unit + mocked integration tests. Keep `@solana-agent-kit/core` + `@solana-agent-kit/plugin-misc` for the data tools.

**Reference material:**
- Thesis: `docs/decomposition/ts-coral-framework/thesis.md`
- Koog canonical pattern: `/Users/bambozlor/Desktop/content-lab/compliance-demo/coral-sanctions-agent/src/main/kotlin/ai/coralprotocol/coral/koog/fullexample/Main.kt`
- Gen 2 runtime being replaced (same file paths — read before rewriting): `src/runtime/`, `src/agent-kit/`
- Gen 2 specs that still frame intent (schemas, failure-mode taxonomy, molecule contract): `docs/superpowers/specs/vercel-ai-sdk/2026-04-17-capability-atoms-*.md`
- Gen 2 failure data this plan clears: `docs/decomposition/capability-atoms/pairwise-first-run.md`
- pi-mono API docs: https://github.com/badlogic/pi-mono/tree/main/packages/agent

**Success bar (H2 milestone):** One live pairwise run of `market-signal-pairwise` against a local Coral Server produces a `RunArtifact` where (a) `trends` emits at least one `coral_send_message` carrying an `atom_result`, (b) `info` resolves its `coral_wait_for_message`, processes the handoff, and emits its own `atom_result`, (c) neither `message_non_execution` nor `handoff_missing` appears in `failure_modes`. The full 10-run × 3-atom bar from the thesis is a follow-on; this plan is the first data point.

---

## File structure

### New code (all paths relative to repo root, on new worktree)

**Runtime scaffold (`src/runtime/`) — overwrites Gen 2 files:**
- `src/runtime/env.ts` — Coral env var reader (small port from Gen 2; logic identical, imports minimal)
- `src/runtime/messages.ts` — TypeBox schemas + encoders for `atom_request` / `atom_result`
- `src/runtime/resource-expand.ts` — `<resource>coral://*</resource>` string expansion used by atom system prompts
- `src/runtime/coral-mcp.ts` — connects to Coral MCP server, discovers tools, adapts each into an `AgentTool`, applies the JSON-Schema sanitizer (strip Kotlin `Long.MAX_VALUE` numeric bounds), applies the OpenAI-safe name remap (dots → underscores), exposes a `callTool` escape hatch for runtime-driven finalization
- `src/runtime/atom-state.ts` — generic per-atom state machine helpers: `defineAtomState<TPhase>`, `makeToolGate`, `makeFinalizer`
- `src/runtime/debug.ts` — per-iteration debug artifact writer that subscribes to pi-mono agent events
- `src/runtime/atom-template.ts` — `startAtom` bootstrap: env, MCP connect, merge tools, build Agent, subscribe debug + finalization, run

**Agent Kit adapter (`src/agent-kit/`) — overwrites Gen 2:**
- `src/agent-kit/envelope.ts` — `{ tool, status, data, warnings, source }` result envelope (ported; logic identical)
- `src/agent-kit/adapter.ts` — generic Agent Kit `Action` → `AgentTool` adapter (rewrite: `zod` → TypeBox, soft-fail + throw handling preserved)

**Atoms (`agents/*/`) — overwrites Gen 2 index.ts; configs new:**
- `agents/trends/atom-config.ts` — atom identity, handoff hints, TypeBox atom_request schema, state machine definition
- `agents/trends/index.ts` — pi-mono Agent entrypoint for trends
- `agents/info/atom-config.ts` — same shape as trends, different tool set and state
- `agents/info/index.ts` — pi-mono Agent entrypoint for info

**Tests (`tests/`):**
- `tests/runtime/env.test.ts`
- `tests/runtime/messages.test.ts`
- `tests/runtime/resource-expand.test.ts`
- `tests/runtime/coral-mcp.test.ts`
- `tests/runtime/atom-state.test.ts`
- `tests/agent-kit/envelope.test.ts`
- `tests/agent-kit/adapter.test.ts`

### Files that stay unchanged (do NOT touch in this plan)

- `scripts/run-pairwise.ts` (Coral REST session launcher)
- `molecules/*.ts` + `molecule-compiler.ts` (SessionRequest emitter)
- `src/evaluation/*` (RunArtifact writer; reads `.coral-debug/` dirs, framework-agnostic)
- `agents/*/coral-agent.toml` (Coral manifest; already correct)
- `agents/*/README.md` (atom descriptions)
- `.env.example`, `tsconfig.json`, anything under `docs/`

---

## Task 0: Worktree + dependency setup

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Create worktree off master**

Run from the repo root:

```bash
git worktree add .worktrees/pairwise-pi-mono -b pairwise-pi-mono master
cd .worktrees/pairwise-pi-mono
```

Expected: new worktree directory exists with master's full history (including the Gen 2 runtime, atoms, scripts, and the archived docs).

- [ ] **Step 2: Install pi-mono + TypeBox**

```bash
npm install @mariozechner/pi-agent-core @mariozechner/pi-ai @sinclair/typebox
```

Expected: `package.json` gains three new dependencies; `package-lock.json` updates; no peer-dep warnings (pi-mono has minimal peers).

- [ ] **Step 3: Verify vitest is already a devDependency**

```bash
npm ls vitest
```

Expected: vitest appears in the tree. If missing: `npm install -D vitest @vitest/ui`.

- [ ] **Step 4: Verify typecheck still passes on Gen 2 code before any replacement**

```bash
npm run typecheck
```

Expected: clean. This confirms the worktree starts from a known-good state. If it fails, stop — something is wrong with the worktree setup, not with the plan.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(pairwise-pi-mono): add pi-mono + typebox deps"
```

---

## Task 1: Port `env.ts`

**Files:**
- Modify: `src/runtime/env.ts` (overwrite Gen 2)
- Test: `tests/runtime/env.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/runtime/env.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { readCoralEnv } from "../../src/runtime/env";

describe("readCoralEnv", () => {
  const originalEnv = { ...process.env };
  afterEach(() => { process.env = { ...originalEnv }; });

  it("returns structured env when all required vars are present", () => {
    process.env.CORAL_CONNECTION_URL = "http://localhost:5555/sse";
    process.env.CORAL_AGENT_ID = "trends";
    process.env.CORAL_SESSION_ID = "abc";
    process.env.MODEL_API_KEY = "sk-test";
    process.env.MODEL_NAME = "openai/gpt-4o-mini";

    expect(readCoralEnv()).toEqual({
      connectionUrl: "http://localhost:5555/sse",
      agentId: "trends",
      sessionId: "abc",
      modelApiKey: "sk-test",
      modelName: "openai/gpt-4o-mini",
    });
  });

  it("throws with a legible message when a required var is missing", () => {
    delete process.env.CORAL_CONNECTION_URL;
    expect(() => readCoralEnv()).toThrow(/CORAL_CONNECTION_URL/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/runtime/env.test.ts
```

Expected: FAIL — `readCoralEnv` not found (file exists from Gen 2 but exports different shape).

- [ ] **Step 3: Rewrite `src/runtime/env.ts`**

```ts
export interface CoralEnv {
  connectionUrl: string;
  agentId: string;
  sessionId: string;
  modelApiKey: string;
  modelName: string;
}

const REQUIRED = [
  "CORAL_CONNECTION_URL",
  "CORAL_AGENT_ID",
  "CORAL_SESSION_ID",
  "MODEL_API_KEY",
  "MODEL_NAME",
] as const;

export function readCoralEnv(): CoralEnv {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(
      `Missing required Coral env vars: ${missing.join(", ")}. ` +
        `Expected all of: ${REQUIRED.join(", ")}.`,
    );
  }
  return {
    connectionUrl: process.env.CORAL_CONNECTION_URL!,
    agentId: process.env.CORAL_AGENT_ID!,
    sessionId: process.env.CORAL_SESSION_ID!,
    modelApiKey: process.env.MODEL_API_KEY!,
    modelName: process.env.MODEL_NAME!,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/runtime/env.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/runtime/env.ts tests/runtime/env.test.ts
git commit -m "feat(runtime): port env reader to pi-mono runtime"
```

---

## Task 2: Atom messages in TypeBox

**Files:**
- Modify: `src/runtime/messages.ts`
- Test: `tests/runtime/messages.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/runtime/messages.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { AtomRequest, AtomResult, encodeAtomMessage, decodeAtomMessage } from "../../src/runtime/messages";

describe("atom messages", () => {
  it("AtomRequest validates a well-formed payload", () => {
    const payload = { kind: "atom_request" as const, from: "conductor", to: "trends", goal: "find trending tokens", context: {} };
    expect(Value.Check(AtomRequest, payload)).toBe(true);
  });

  it("AtomResult validates a well-formed payload", () => {
    const payload = { kind: "atom_result" as const, from: "trends", to: "info", data: { tokens: ["BONK"] }, summary: "3 trending" };
    expect(Value.Check(AtomResult, payload)).toBe(true);
  });

  it("encodeAtomMessage produces a JSON string that decodeAtomMessage round-trips", () => {
    const msg = { kind: "atom_result" as const, from: "trends", to: "info", data: { x: 1 }, summary: "ok" };
    const encoded = encodeAtomMessage(msg);
    expect(typeof encoded).toBe("string");
    expect(decodeAtomMessage(encoded)).toEqual(msg);
  });

  it("decodeAtomMessage throws on malformed JSON", () => {
    expect(() => decodeAtomMessage("not json")).toThrow();
  });

  it("decodeAtomMessage throws on schema-invalid payload", () => {
    expect(() => decodeAtomMessage(JSON.stringify({ kind: "bogus" }))).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/runtime/messages.test.ts
```

Expected: FAIL — module or exports not found.

- [ ] **Step 3: Rewrite `src/runtime/messages.ts`**

```ts
import { Type, Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const AtomRequest = Type.Object({
  kind: Type.Literal("atom_request"),
  from: Type.String({ minLength: 1 }),
  to: Type.String({ minLength: 1 }),
  goal: Type.String({ minLength: 1 }),
  context: Type.Record(Type.String(), Type.Unknown(), { default: {} }),
});

export const AtomResult = Type.Object({
  kind: Type.Literal("atom_result"),
  from: Type.String({ minLength: 1 }),
  to: Type.String({ minLength: 1 }),
  data: Type.Record(Type.String(), Type.Unknown()),
  summary: Type.String({ default: "" }),
});

export const AtomMessage = Type.Union([AtomRequest, AtomResult]);

export type AtomRequestT = Static<typeof AtomRequest>;
export type AtomResultT = Static<typeof AtomResult>;
export type AtomMessageT = Static<typeof AtomMessage>;

export function encodeAtomMessage(msg: AtomMessageT): string {
  if (!Value.Check(AtomMessage, msg)) {
    const errs = [...Value.Errors(AtomMessage, msg)];
    throw new Error(`Invalid atom message: ${JSON.stringify(errs)}`);
  }
  return JSON.stringify(msg);
}

export function decodeAtomMessage(raw: string): AtomMessageT {
  const parsed = JSON.parse(raw);
  if (!Value.Check(AtomMessage, parsed)) {
    const errs = [...Value.Errors(AtomMessage, parsed)];
    throw new Error(`Invalid atom message: ${JSON.stringify(errs)}`);
  }
  return parsed;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/runtime/messages.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/runtime/messages.ts tests/runtime/messages.test.ts
git commit -m "feat(runtime): atom message schemas in typebox"
```

---

## Task 3: Resource expansion

**Files:**
- Modify: `src/runtime/resource-expand.ts`
- Test: `tests/runtime/resource-expand.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/runtime/resource-expand.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { expandResources } from "../../src/runtime/resource-expand";

describe("expandResources", () => {
  const fetcher = vi.fn(async (uri: string) => {
    if (uri === "coral://instruction") return "YOU ARE THE TRENDS ATOM.";
    if (uri === "coral://state") return "THREAD STATE: empty";
    throw new Error(`unknown resource ${uri}`);
  });

  it("replaces a single <resource> tag", async () => {
    const out = await expandResources("<resource>coral://instruction</resource>", fetcher);
    expect(out).toBe("YOU ARE THE TRENDS ATOM.");
  });

  it("replaces multiple tags in order", async () => {
    const out = await expandResources(
      "A\n<resource>coral://instruction</resource>\nB\n<resource>coral://state</resource>\nC",
      fetcher,
    );
    expect(out).toBe("A\nYOU ARE THE TRENDS ATOM.\nB\nTHREAD STATE: empty\nC");
  });

  it("passes through input with no tags unchanged", async () => {
    expect(await expandResources("no tags here", fetcher)).toBe("no tags here");
  });

  it("propagates fetcher errors", async () => {
    await expect(expandResources("<resource>coral://bogus</resource>", fetcher)).rejects.toThrow(/bogus/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/runtime/resource-expand.test.ts
```

Expected: FAIL — module or `expandResources` not found.

- [ ] **Step 3: Rewrite `src/runtime/resource-expand.ts`**

```ts
const RESOURCE_RE = /<resource>([\s\S]*?)<\/resource>/g;

export type ResourceFetcher = (uri: string) => Promise<string>;

export async function expandResources(input: string, fetcher: ResourceFetcher): Promise<string> {
  const matches = [...input.matchAll(RESOURCE_RE)];
  if (matches.length === 0) return input;
  const resolved = await Promise.all(matches.map((m) => fetcher(m[1].trim())));
  let out = "";
  let cursor = 0;
  matches.forEach((m, i) => {
    out += input.slice(cursor, m.index) + resolved[i];
    cursor = m.index! + m[0].length;
  });
  out += input.slice(cursor);
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/runtime/resource-expand.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/runtime/resource-expand.ts tests/runtime/resource-expand.test.ts
git commit -m "feat(runtime): resource tag expansion"
```

---

## Task 4: Coral MCP client — schema sanitizer + name remap

**Files:**
- Create: `src/runtime/coral-mcp.ts` (partial — sanitizer + remap only in this task)
- Test: `tests/runtime/coral-mcp.test.ts` (partial)

- [ ] **Step 1: Write the failing test**

Create `tests/runtime/coral-mcp.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sanitizeJsonSchema, remapToolName, restoreToolName } from "../../src/runtime/coral-mcp";

describe("sanitizeJsonSchema", () => {
  it("strips numeric bounds outside the OpenAI-safe int32 range", () => {
    const schema = {
      type: "object",
      properties: {
        count: { type: "integer", minimum: 0, maximum: 9223372036854775807 },
        ratio: { type: "number", minimum: -1.0, maximum: 1.0 },
      },
    };
    const out = sanitizeJsonSchema(schema);
    expect(out.properties.count.maximum).toBeUndefined();
    expect(out.properties.count.minimum).toBe(0);
    expect(out.properties.ratio.maximum).toBe(1.0);
  });

  it("recurses into nested object + array schemas", () => {
    const schema = {
      type: "object",
      properties: {
        items: { type: "array", items: { type: "integer", maximum: 9223372036854775807 } },
      },
    };
    const out = sanitizeJsonSchema(schema);
    expect(out.properties.items.items.maximum).toBeUndefined();
  });

  it("returns the input unchanged when no bounds are out of range", () => {
    const schema = { type: "object", properties: { x: { type: "string" } } };
    expect(sanitizeJsonSchema(schema)).toEqual(schema);
  });
});

describe("remapToolName / restoreToolName", () => {
  it("replaces dots with underscores", () => {
    expect(remapToolName("agentkit.trending_tokens")).toBe("agentkit_trending_tokens");
  });

  it("round-trips via the map it returns", () => {
    const map = new Map<string, string>();
    const remapped = remapToolName("atom.noop", map);
    expect(remapped).toBe("atom_noop");
    expect(restoreToolName(remapped, map)).toBe("atom.noop");
  });

  it("restoreToolName returns the input unchanged when no mapping exists", () => {
    const map = new Map<string, string>();
    expect(restoreToolName("coral_send_message", map)).toBe("coral_send_message");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/runtime/coral-mcp.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the partial `src/runtime/coral-mcp.ts`**

```ts
const INT32_MAX = 2147483647;
const INT32_MIN = -2147483648;

export function sanitizeJsonSchema(schema: any): any {
  if (schema == null || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(sanitizeJsonSchema);
  const out: any = { ...schema };
  if (out.type === "integer" || out.type === "number") {
    if (typeof out.maximum === "number" && (out.maximum > INT32_MAX || out.maximum < INT32_MIN)) {
      delete out.maximum;
    }
    if (typeof out.minimum === "number" && (out.minimum > INT32_MAX || out.minimum < INT32_MIN)) {
      delete out.minimum;
    }
  }
  for (const key of ["properties", "items", "additionalProperties", "patternProperties"]) {
    if (out[key] != null && typeof out[key] === "object") {
      if (key === "properties" || key === "patternProperties") {
        out[key] = Object.fromEntries(Object.entries(out[key]).map(([k, v]) => [k, sanitizeJsonSchema(v)]));
      } else {
        out[key] = sanitizeJsonSchema(out[key]);
      }
    }
  }
  if (Array.isArray(out.anyOf)) out.anyOf = out.anyOf.map(sanitizeJsonSchema);
  if (Array.isArray(out.oneOf)) out.oneOf = out.oneOf.map(sanitizeJsonSchema);
  if (Array.isArray(out.allOf)) out.allOf = out.allOf.map(sanitizeJsonSchema);
  return out;
}

const NAME_RE = /^[a-zA-Z0-9_-]+$/;

export function remapToolName(original: string, map?: Map<string, string>): string {
  if (NAME_RE.test(original)) {
    if (map && !map.has(original)) map.set(original, original);
    return original;
  }
  const remapped = original.replace(/\./g, "_");
  if (!NAME_RE.test(remapped)) {
    throw new Error(`Cannot remap tool name "${original}" to an OpenAI-safe identifier`);
  }
  if (map) map.set(remapped, original);
  return remapped;
}

export function restoreToolName(remapped: string, map: Map<string, string>): string {
  return map.get(remapped) ?? remapped;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/runtime/coral-mcp.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/runtime/coral-mcp.ts tests/runtime/coral-mcp.test.ts
git commit -m "feat(runtime): coral-mcp schema sanitizer + name remap"
```

---

## Task 5: Coral MCP client — connect + tool discovery + AgentTool adapter

**Files:**
- Modify: `src/runtime/coral-mcp.ts` (add client class)
- Modify: `tests/runtime/coral-mcp.test.ts` (add adapter tests with mocked client)

- [ ] **Step 1: Write the failing test**

Append to `tests/runtime/coral-mcp.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { mcpToolsToAgentTools, type McpToolLike } from "../../src/runtime/coral-mcp";

describe("mcpToolsToAgentTools", () => {
  it("adapts an MCP tool into an AgentTool with sanitized schema + remapped name", () => {
    const mcpTools: McpToolLike[] = [
      {
        name: "agentkit.trending_tokens",
        description: "Fetch trending tokens",
        inputSchema: {
          type: "object",
          properties: { limit: { type: "integer", minimum: 1, maximum: 9223372036854775807 } },
        },
      },
    ];
    const callTool = vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] }));
    const nameMap = new Map<string, string>();
    const [tool] = mcpToolsToAgentTools(mcpTools, callTool, nameMap);
    expect(tool.name).toBe("agentkit_trending_tokens");
    expect(tool.label).toBe("agentkit.trending_tokens");
    expect((tool.parameters as any).properties.limit.maximum).toBeUndefined();
    expect(nameMap.get("agentkit_trending_tokens")).toBe("agentkit.trending_tokens");
  });

  it("execute() calls the underlying MCP client with the ORIGINAL tool name", async () => {
    const mcpTools: McpToolLike[] = [
      { name: "coral_send_message", description: "Send a Coral message", inputSchema: { type: "object", properties: {} } },
    ];
    const callTool = vi.fn(async () => ({ content: [{ type: "text", text: "sent" }] }));
    const [tool] = mcpToolsToAgentTools(mcpTools, callTool, new Map());
    const result = await tool.execute("call-1", { threadId: "t", content: "hi" } as any);
    expect(callTool).toHaveBeenCalledWith("coral_send_message", { threadId: "t", content: "hi" });
    expect(result.content).toEqual([{ type: "text", text: "sent" }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/runtime/coral-mcp.test.ts
```

Expected: FAIL — `mcpToolsToAgentTools` not exported.

- [ ] **Step 3: Extend `src/runtime/coral-mcp.ts`**

Append:

```ts
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface McpToolLike {
  name: string;
  description?: string;
  inputSchema: any;
}

export type McpCallTool = (
  originalName: string,
  args: Record<string, unknown>,
) => Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }>;

export function mcpToolsToAgentTools(
  mcpTools: McpToolLike[],
  callTool: McpCallTool,
  nameMap: Map<string, string>,
): AgentTool<any>[] {
  return mcpTools.map((mt) => {
    const remapped = remapToolName(mt.name, nameMap);
    const sanitized = sanitizeJsonSchema(mt.inputSchema ?? { type: "object", properties: {} });
    const tool: AgentTool<any> = {
      name: remapped,
      label: mt.name,
      description: mt.description ?? mt.name,
      parameters: sanitized as any,
      execute: async (_toolCallId, params) => {
        const original = restoreToolName(remapped, nameMap);
        const res = await callTool(original, params as Record<string, unknown>);
        return { content: res.content };
      },
    };
    return tool;
  });
}

export interface CoralMcpClient {
  tools: AgentTool<any>[];
  nameMap: Map<string, string>;
  callTool: McpCallTool;
  readResource: (uri: string) => Promise<string>;
  close: () => Promise<void>;
}

export async function connectCoralMcp(connectionUrl: string, agentId: string): Promise<CoralMcpClient> {
  const transport = new StreamableHTTPClientTransport(new URL(connectionUrl));
  const client = new Client({ name: agentId, version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);

  const listed = await client.listTools();
  const nameMap = new Map<string, string>();
  const callTool: McpCallTool = async (originalName, args) => {
    const res = await client.callTool({ name: originalName, arguments: args });
    return {
      content: (res.content ?? []) as Array<{ type: string; text?: string }>,
      isError: (res as any).isError,
    };
  };
  const tools = mcpToolsToAgentTools(listed.tools as McpToolLike[], callTool, nameMap);
  const readResource = async (uri: string): Promise<string> => {
    const res = await client.readResource({ uri });
    const first = res.contents?.[0];
    if (!first) throw new Error(`resource ${uri} returned no contents`);
    if ("text" in first && typeof first.text === "string") return first.text;
    throw new Error(`resource ${uri} returned non-text contents`);
  };

  return {
    tools,
    nameMap,
    callTool,
    readResource,
    close: async () => { await client.close(); },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/runtime/coral-mcp.test.ts
```

Expected: PASS (8 tests total for this file).

- [ ] **Step 5: Commit**

```bash
git add src/runtime/coral-mcp.ts tests/runtime/coral-mcp.test.ts
git commit -m "feat(runtime): coral MCP client + AgentTool adapter"
```

---

## Task 6: Per-atom state machine helpers

**Files:**
- Create: `src/runtime/atom-state.ts`
- Test: `tests/runtime/atom-state.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/runtime/atom-state.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { defineAtomState, makeToolGate } from "../../src/runtime/atom-state";

type Phase = "awaiting" | "fetching" | "sent";

describe("defineAtomState", () => {
  it("initializes to the given phase and allows transitions", () => {
    const state = defineAtomState<Phase, { hits: number }>({ phase: "awaiting", hits: 0 });
    expect(state.get().phase).toBe("awaiting");
    state.update((s) => ({ ...s, phase: "fetching" }));
    expect(state.get().phase).toBe("fetching");
  });

  it("notifies subscribers on update", () => {
    const state = defineAtomState<Phase, { hits: number }>({ phase: "awaiting", hits: 0 });
    const seen: Phase[] = [];
    state.subscribe((s) => { seen.push(s.phase); });
    state.update((s) => ({ ...s, phase: "fetching" }));
    state.update((s) => ({ ...s, phase: "sent" }));
    expect(seen).toEqual(["fetching", "sent"]);
  });
});

describe("makeToolGate", () => {
  it("blocks tool calls whose name is in the runtime-managed set", async () => {
    const state = defineAtomState<Phase, {}>({ phase: "fetching" });
    const gate = makeToolGate({
      runtimeManaged: new Set(["coral_send_message"]),
      allowedByPhase: () => null,
      state,
    });
    const res = await gate({
      assistantMessage: {} as any,
      toolCall: { id: "c1", name: "coral_send_message" } as any,
      args: {},
      context: {} as any,
    });
    expect(res).toMatchObject({ block: true });
  });

  it("blocks tool calls whose name is not in the allowed-by-phase list", async () => {
    const state = defineAtomState<Phase, {}>({ phase: "awaiting" });
    const gate = makeToolGate({
      runtimeManaged: new Set<string>(),
      allowedByPhase: (phase) => (phase === "awaiting" ? ["coral_wait_for_message"] : null),
      state,
    });
    const res = await gate({
      assistantMessage: {} as any,
      toolCall: { id: "c1", name: "agentkit_trending_tokens" } as any,
      args: {},
      context: {} as any,
    });
    expect(res).toMatchObject({ block: true });
  });

  it("lets an allowed tool through (returns undefined)", async () => {
    const state = defineAtomState<Phase, {}>({ phase: "fetching" });
    const gate = makeToolGate({
      runtimeManaged: new Set<string>(),
      allowedByPhase: () => null,
      state,
    });
    const res = await gate({
      assistantMessage: {} as any,
      toolCall: { id: "c1", name: "agentkit_trending_tokens" } as any,
      args: {},
      context: {} as any,
    });
    expect(res).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/runtime/atom-state.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/runtime/atom-state.ts`**

```ts
import type { BeforeToolCallContext } from "@mariozechner/pi-agent-core";

export interface AtomStateHandle<TPhase extends string, TData extends object> {
  get(): { phase: TPhase } & TData;
  update(fn: (prev: { phase: TPhase } & TData) => { phase: TPhase } & TData): void;
  subscribe(listener: (state: { phase: TPhase } & TData) => void): () => void;
}

export function defineAtomState<TPhase extends string, TData extends object>(
  initial: { phase: TPhase } & TData,
): AtomStateHandle<TPhase, TData> {
  let state = initial;
  const listeners = new Set<(s: { phase: TPhase } & TData) => void>();
  return {
    get: () => state,
    update: (fn) => {
      state = fn(state);
      for (const l of listeners) l(state);
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export interface ToolGateConfig<TPhase extends string, TData extends object> {
  runtimeManaged: Set<string>;
  allowedByPhase: (phase: TPhase) => string[] | null;
  state: AtomStateHandle<TPhase, TData>;
}

export function makeToolGate<TPhase extends string, TData extends object>(
  cfg: ToolGateConfig<TPhase, TData>,
) {
  return async (ctx: BeforeToolCallContext) => {
    const name = ctx.toolCall.name;
    if (cfg.runtimeManaged.has(name)) {
      return {
        block: true as const,
        reason:
          `Tool "${name}" is runtime-managed. The runtime composes and posts it directly ` +
          `when the atom state transitions to its terminal phase.`,
      };
    }
    const current = cfg.state.get();
    const allowed = cfg.allowedByPhase(current.phase);
    if (allowed !== null && !allowed.includes(name)) {
      return {
        block: true as const,
        reason:
          `Tool "${name}" is not permitted in phase "${current.phase}". ` +
          `Allowed: ${allowed.join(", ") || "(none)"}.`,
      };
    }
    return undefined;
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/runtime/atom-state.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/runtime/atom-state.ts tests/runtime/atom-state.test.ts
git commit -m "feat(runtime): per-atom state handle + tool gate"
```

---

## Task 7: Debug artifact writer

**Files:**
- Create: `src/runtime/debug.ts`
- Test: `tests/runtime/debug.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/runtime/debug.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachDebugWriter } from "../../src/runtime/debug";

function makeMockAgent() {
  const listeners: Array<(ev: any) => Promise<void>> = [];
  return {
    subscribe: (l: any) => { listeners.push(l); return () => {}; },
    emit: async (ev: any) => { for (const l of listeners) await l(ev); },
  };
}

describe("attachDebugWriter", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "coral-debug-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it("writes one artifact file per turn_end event", async () => {
    const agent = makeMockAgent();
    attachDebugWriter({
      agent: agent as any,
      agentId: "trends",
      sessionId: "sess-1",
      rootDir: root,
    });
    await agent.emit({ type: "turn_start" });
    await agent.emit({ type: "turn_end", message: { role: "assistant", content: [] }, toolResults: [] });
    await agent.emit({ type: "turn_end", message: { role: "assistant", content: [] }, toolResults: [] });

    const dir = join(root, "trends", "sess-1");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(2);
  });

  it("redacts MODEL_API_KEY values in the written payload", async () => {
    const agent = makeMockAgent();
    attachDebugWriter({
      agent: agent as any,
      agentId: "trends",
      sessionId: "sess-2",
      rootDir: root,
      secrets: ["supersecret"],
    });
    await agent.emit({
      type: "turn_end",
      message: { role: "assistant", content: [{ type: "text", text: "key is supersecret here" }] },
      toolResults: [],
    });
    const dir = join(root, "trends", "sess-2");
    const file = readdirSync(dir)[0];
    const body = readFileSync(join(dir, file), "utf8");
    expect(body).not.toContain("supersecret");
    expect(body).toContain("***");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/runtime/debug.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/runtime/debug.ts`**

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface DebugWriterOptions {
  agent: { subscribe: (l: (ev: any) => Promise<void>) => () => void };
  agentId: string;
  sessionId: string;
  rootDir?: string;
  secrets?: string[];
}

export function attachDebugWriter(opts: DebugWriterOptions): () => void {
  const root = opts.rootDir ?? ".coral-debug";
  const dir = join(root, opts.agentId, opts.sessionId);
  mkdirSync(dir, { recursive: true });
  let iteration = 0;
  const secrets = (opts.secrets ?? []).filter((s) => typeof s === "string" && s.length > 0);
  const redact = (raw: string): string => {
    let out = raw;
    for (const s of secrets) out = out.split(s).join("***");
    return out;
  };
  return opts.agent.subscribe(async (ev) => {
    if (ev.type !== "turn_end") return;
    iteration += 1;
    const payload = { iteration, event: ev, ts: new Date().toISOString() };
    const body = redact(JSON.stringify(payload, null, 2));
    writeFileSync(join(dir, `iter-${String(iteration).padStart(4, "0")}.json`), body, "utf8");
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/runtime/debug.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/runtime/debug.ts tests/runtime/debug.test.ts
git commit -m "feat(runtime): debug artifact writer on pi-mono subscribe"
```

---

## Task 8: Atom template bootstrap

**Files:**
- Modify: `src/runtime/atom-template.ts`

(No dedicated test file — `atom-template` is wiring; its correctness is exercised by the atom integration tests in Tasks 13 and 15, and by the live pairwise run in Task 16.)

- [ ] **Step 1: Rewrite `src/runtime/atom-template.ts`**

```ts
import { Agent, type AgentTool } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { readCoralEnv, type CoralEnv } from "./env";
import { connectCoralMcp, type CoralMcpClient } from "./coral-mcp";
import { expandResources } from "./resource-expand";
import { attachDebugWriter } from "./debug";

export interface StartAtomOptions {
  /** Raw system prompt string with optional `<resource>coral://*</resource>` tags. */
  systemPrompt: string;
  /** Tools local to the atom (e.g. adapted Agent Kit actions). */
  localTools: AgentTool<any>[];
  /**
   * Wire the atom's state machine into the Agent. Called after MCP connect so the atom
   * has the full tool surface + Coral client for runtime-driven actions.
   */
  wire: (ctx: {
    env: CoralEnv;
    coral: CoralMcpClient;
    allTools: AgentTool<any>[];
  }) => {
    beforeToolCall: Parameters<typeof buildAgent>[0]["beforeToolCall"];
    afterToolCall?: Parameters<typeof buildAgent>[0]["afterToolCall"];
    onStarted: (agent: Agent) => void;
  };
  /**
   * Initial prompt passed to `agent.prompt(...)` once wiring is complete.
   */
  initialPrompt: string;
}

function buildAgent(init: {
  systemPrompt: string;
  model: ReturnType<typeof getModel>;
  tools: AgentTool<any>[];
  getApiKey: (provider: string) => Promise<string>;
  beforeToolCall: NonNullable<ConstructorParameters<typeof Agent>[0]["beforeToolCall"]>;
  afterToolCall?: ConstructorParameters<typeof Agent>[0]["afterToolCall"];
}): Agent {
  return new Agent({
    initialState: {
      systemPrompt: init.systemPrompt,
      model: init.model,
      tools: init.tools,
      messages: [],
    },
    convertToLlm: (messages) => messages as any,
    getApiKey: init.getApiKey,
    beforeToolCall: init.beforeToolCall,
    afterToolCall: init.afterToolCall,
  });
}

export async function startAtom(opts: StartAtomOptions): Promise<void> {
  const env = readCoralEnv();
  const coral = await connectCoralMcp(env.connectionUrl, env.agentId);
  try {
    const allTools = [...coral.tools, ...opts.localTools];
    const wired = opts.wire({ env, coral, allTools });
    const expanded = await expandResources(opts.systemPrompt, (uri) => coral.readResource(uri));
    const [provider, modelId] = env.modelName.split("/");
    if (!provider || !modelId) {
      throw new Error(`MODEL_NAME must be "provider/model-id"; got "${env.modelName}"`);
    }
    const model = getModel(provider, modelId);
    const agent = buildAgent({
      systemPrompt: expanded,
      model,
      tools: allTools,
      getApiKey: async () => env.modelApiKey,
      beforeToolCall: wired.beforeToolCall,
      afterToolCall: wired.afterToolCall,
    });
    attachDebugWriter({
      agent,
      agentId: env.agentId,
      sessionId: env.sessionId,
      secrets: [env.modelApiKey],
    });
    wired.onStarted(agent);
    await agent.prompt(opts.initialPrompt);
    await agent.waitForIdle();
  } finally {
    await coral.close();
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: clean. If errors reference `Agent` or `AgentTool` generics, inspect the imports against `node_modules/@mariozechner/pi-agent-core/dist/types.d.ts` and adjust — the public API is the source of truth.

- [ ] **Step 3: Commit**

```bash
git add src/runtime/atom-template.ts
git commit -m "feat(runtime): atom-template startAtom bootstrap on pi-mono"
```

---

## Task 9: Agent Kit result envelope (port)

**Files:**
- Modify: `src/agent-kit/envelope.ts`
- Test: `tests/agent-kit/envelope.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/agent-kit/envelope.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { wrapAgentKitResult, wrapAgentKitThrow } from "../../src/agent-kit/envelope";

describe("wrapAgentKitResult", () => {
  it("normalizes a successful raw result", () => {
    const env = wrapAgentKitResult("agentkit.trending", { items: [1, 2] });
    expect(env).toEqual({
      tool: "agentkit.trending",
      status: "success",
      data: { items: [1, 2] },
      warnings: [],
      source: "agent-kit",
    });
  });

  it("flags soft-fail results that carry a top-level error field", () => {
    const env = wrapAgentKitResult("agentkit.trending", { error_code: 10011, message: "rate limited" });
    expect(env.status).toBe("soft_fail");
    expect(env.warnings).toContain("rate limited");
  });

  it("null/undefined raw results land as success with null data", () => {
    const env = wrapAgentKitResult("agentkit.ping", null);
    expect(env).toMatchObject({ status: "success", data: null });
  });
});

describe("wrapAgentKitThrow", () => {
  it("captures thrown Error into a failure envelope", () => {
    const env = wrapAgentKitThrow("agentkit.break", new Error("boom"));
    expect(env.status).toBe("error");
    expect(env.data).toMatchObject({ message: "boom" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/agent-kit/envelope.test.ts
```

Expected: FAIL — envelope module doesn't expose the new names.

- [ ] **Step 3: Rewrite `src/agent-kit/envelope.ts`**

```ts
export type EnvelopeStatus = "success" | "soft_fail" | "error";

export interface AgentKitEnvelope<T = unknown> {
  tool: string;
  status: EnvelopeStatus;
  data: T | null;
  warnings: string[];
  source: "agent-kit";
}

const SOFT_FAIL_KEYS = ["error_code", "error", "errors"] as const;

export function wrapAgentKitResult<T>(tool: string, raw: T): AgentKitEnvelope<T> {
  if (raw == null) {
    return { tool, status: "success", data: null, warnings: [], source: "agent-kit" };
  }
  if (typeof raw === "object") {
    const hit = SOFT_FAIL_KEYS.find((k) => k in (raw as Record<string, unknown>));
    if (hit) {
      const msg = (raw as any).message ?? (raw as any)[hit];
      return {
        tool,
        status: "soft_fail",
        data: raw,
        warnings: [typeof msg === "string" ? msg : JSON.stringify(msg)],
        source: "agent-kit",
      };
    }
  }
  return { tool, status: "success", data: raw, warnings: [], source: "agent-kit" };
}

export function wrapAgentKitThrow(tool: string, err: unknown): AgentKitEnvelope {
  const message = err instanceof Error ? err.message : String(err);
  return {
    tool,
    status: "error",
    data: { message } as any,
    warnings: [],
    source: "agent-kit",
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/agent-kit/envelope.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent-kit/envelope.ts tests/agent-kit/envelope.test.ts
git commit -m "feat(agent-kit): port result envelope"
```

---

## Task 10: Agent Kit action → AgentTool adapter

**Files:**
- Modify: `src/agent-kit/adapter.ts`
- Test: `tests/agent-kit/adapter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/agent-kit/adapter.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { Type } from "@sinclair/typebox";
import { adaptAgentKitAction } from "../../src/agent-kit/adapter";

describe("adaptAgentKitAction", () => {
  it("produces an AgentTool whose execute wraps the handler result in a success envelope", async () => {
    const handler = vi.fn(async (args: any) => ({ trending: ["BONK", "WIF"], arg: args.limit }));
    const tool = adaptAgentKitAction({
      name: "agentkit.trending",
      description: "Fetch trending tokens",
      parameters: Type.Object({ limit: Type.Number({ default: 10 }) }),
      handler,
    });
    expect(tool.name).toBe("agentkit_trending");
    expect(tool.label).toBe("agentkit.trending");
    const res = await tool.execute("c1", { limit: 5 } as any);
    expect(handler).toHaveBeenCalledWith({ limit: 5 });
    const envelope = JSON.parse((res.content[0] as any).text);
    expect(envelope).toMatchObject({ status: "success", data: { trending: ["BONK", "WIF"] } });
  });

  it("captures thrown handler errors into an error envelope without rejecting", async () => {
    const tool = adaptAgentKitAction({
      name: "agentkit.break",
      description: "Always fails",
      parameters: Type.Object({}),
      handler: async () => { throw new Error("boom"); },
    });
    const res = await tool.execute("c1", {} as any);
    const envelope = JSON.parse((res.content[0] as any).text);
    expect(envelope.status).toBe("error");
    expect(envelope.data.message).toBe("boom");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/agent-kit/adapter.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Rewrite `src/agent-kit/adapter.ts`**

```ts
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TSchema, Static } from "@sinclair/typebox";
import { wrapAgentKitResult, wrapAgentKitThrow } from "./envelope";
import { remapToolName } from "../runtime/coral-mcp";

export interface AgentKitActionDef<TParams extends TSchema> {
  name: string;
  description: string;
  parameters: TParams;
  handler: (args: Static<TParams>) => Promise<unknown>;
}

export function adaptAgentKitAction<TParams extends TSchema>(
  def: AgentKitActionDef<TParams>,
): AgentTool<TParams> {
  const remapped = remapToolName(def.name);
  return {
    name: remapped,
    label: def.name,
    description: def.description,
    parameters: def.parameters,
    execute: async (_toolCallId, params) => {
      let envelope;
      try {
        const raw = await def.handler(params);
        envelope = wrapAgentKitResult(def.name, raw);
      } catch (err) {
        envelope = wrapAgentKitThrow(def.name, err);
      }
      return { content: [{ type: "text", text: JSON.stringify(envelope) }] };
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/agent-kit/adapter.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent-kit/adapter.ts tests/agent-kit/adapter.test.ts
git commit -m "feat(agent-kit): adapter rewrite for pi-mono AgentTool"
```

---

## Task 11: `trends` atom — config (schemas + state machine definition)

**Files:**
- Create: `agents/trends/atom-config.ts`

- [ ] **Step 1: Inspect the existing Gen 2 trends config to preserve tool inventory + handoff hints**

```bash
ls agents/trends/
cat agents/trends/coral-agent.toml
```

Note the `tools` list + any description of what `info` expects from trends. The `coral-agent.toml` stays unchanged; only `atom-config.ts` is new.

- [ ] **Step 2: Write `agents/trends/atom-config.ts`**

```ts
import { Type, type Static } from "@sinclair/typebox";

export const TrendsRequest = Type.Object({
  kind: Type.Literal("atom_request"),
  from: Type.String(),
  to: Type.Literal("trends"),
  goal: Type.String(),
  context: Type.Record(Type.String(), Type.Unknown(), { default: {} }),
});
export type TrendsRequestT = Static<typeof TrendsRequest>;

export type TrendsPhase =
  | "awaiting_request"
  | "fetching"
  | "ready_to_finalize"
  | "sent";

export interface TrendsStateData {
  request: TrendsRequestT | null;
  collectedTokens: Array<{ symbol: string; address?: string; score?: number }>;
  fetchCalls: number;
}

export const TRENDS_MAX_FETCH_CALLS = 6;

/** Allow-lists per phase. `null` means "no restriction" (gate falls through). */
export function trendsAllowedByPhase(phase: TrendsPhase): string[] | null {
  switch (phase) {
    case "awaiting_request":
      return ["coral_wait_for_message"];
    case "fetching":
      return [
        "coral_wait_for_message",
        "agentkit_get_trending_tokens_on_coingecko",
        "agentkit_get_trending_pools_on_coingecko",
        "agentkit_get_token_price_data_from_coingecko",
        "agentkit_get_top_gainers_on_coingecko",
      ];
    case "ready_to_finalize":
    case "sent":
      return [];
  }
}

/** Tools the model must never call directly. Runtime handles them. */
export const TRENDS_RUNTIME_MANAGED: ReadonlySet<string> = new Set([
  "coral_send_message",
]);
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: clean. If the exact Agent Kit tool names differ from the allow-list (they're remapped from `agentkit.*` → `agentkit_*`), fix the strings to match what the Coral Server exposes — confirm by running the Gen 2 pairwise test's debug artifacts under `.coral-debug/trends/` and reading tool names from `turn_end` events.

- [ ] **Step 4: Commit**

```bash
git add agents/trends/atom-config.ts
git commit -m "feat(atoms): trends atom-config (schemas + phase allow-lists)"
```

---

## Task 12: `trends` atom — entrypoint

**Files:**
- Modify: `agents/trends/index.ts` (overwrite Gen 2)

- [ ] **Step 1: Write `agents/trends/index.ts`**

```ts
import { Agent } from "@mariozechner/pi-agent-core";
import { startAtom } from "../../src/runtime/atom-template";
import { defineAtomState, makeToolGate } from "../../src/runtime/atom-state";
import { adaptAgentKitAction } from "../../src/agent-kit/adapter";
import { encodeAtomMessage, decodeAtomMessage, type AtomResultT } from "../../src/runtime/messages";
import {
  TRENDS_MAX_FETCH_CALLS,
  TRENDS_RUNTIME_MANAGED,
  trendsAllowedByPhase,
  type TrendsPhase,
  type TrendsStateData,
} from "./atom-config";
// NOTE: The actual Agent Kit action imports live in the existing Gen 2 module surface.
// Read agents/trends/index.ts on master to copy the exact imports for `get_trending_tokens_on_coingecko`,
// `get_trending_pools_on_coingecko`, `get_token_price_data_from_coingecko`, `get_top_gainers_on_coingecko`.
import * as coingeckoActions from "@solana-agent-kit/plugin-misc";

const SYSTEM_PROMPT = `You are the \"trends\" capability atom in a Coral multi-agent session.
<resource>coral://instruction</resource>

Your job:
1. Wait for an atom_request JSON message addressed to \"trends\".
2. When received, call the CoinGecko tools (trending tokens, trending pools, top gainers) to gather a concise list of trending tokens. Do NOT send Coral messages — the runtime handles that.
3. Once you have enough data, stop calling tools. The runtime will detect this and post the atom_result on your behalf.

<resource>coral://state</resource>`;

await startAtom({
  systemPrompt: SYSTEM_PROMPT,
  localTools: [
    adaptAgentKitAction({
      name: "agentkit.get_trending_tokens_on_coingecko",
      description: "Fetch trending tokens from CoinGecko",
      parameters: coingeckoActions.getTrendingTokensOnCoinGeckoAction.parameters as any,
      handler: async (args: any) => coingeckoActions.getTrendingTokensOnCoinGeckoAction.handler({} as any, args),
    }),
    adaptAgentKitAction({
      name: "agentkit.get_trending_pools_on_coingecko",
      description: "Fetch trending pools from CoinGecko",
      parameters: coingeckoActions.getTrendingPoolsOnCoinGeckoAction.parameters as any,
      handler: async (args: any) => coingeckoActions.getTrendingPoolsOnCoinGeckoAction.handler({} as any, args),
    }),
    adaptAgentKitAction({
      name: "agentkit.get_token_price_data_from_coingecko",
      description: "Fetch token price data from CoinGecko",
      parameters: coingeckoActions.getTokenPriceDataFromCoinGeckoAction.parameters as any,
      handler: async (args: any) => coingeckoActions.getTokenPriceDataFromCoinGeckoAction.handler({} as any, args),
    }),
    adaptAgentKitAction({
      name: "agentkit.get_top_gainers_on_coingecko",
      description: "Fetch top gainers from CoinGecko",
      parameters: coingeckoActions.getTopGainersOnCoinGeckoAction.parameters as any,
      handler: async (args: any) => coingeckoActions.getTopGainersOnCoinGeckoAction.handler({} as any, args),
    }),
  ],
  initialPrompt: "Begin the trends workflow.",
  wire: ({ env, coral }) => {
    const state = defineAtomState<TrendsPhase, TrendsStateData>({
      phase: "awaiting_request",
      request: null,
      collectedTokens: [],
      fetchCalls: 0,
    });

    const gate = makeToolGate({
      runtimeManaged: TRENDS_RUNTIME_MANAGED as Set<string>,
      allowedByPhase: trendsAllowedByPhase,
      state,
    });

    let agentRef: Agent | null = null;

    return {
      beforeToolCall: gate,
      afterToolCall: async (ctx) => {
        const name = ctx.toolCall.name;
        // trends ingests atom_request via coral_wait_for_message content
        if (name === "coral_wait_for_message" && state.get().phase === "awaiting_request") {
          try {
            const text = (ctx.result.content?.[0] as any)?.text ?? "";
            const msg = decodeAtomMessage(text);
            if (msg.kind === "atom_request" && msg.to === "trends") {
              state.update((s) => ({ ...s, phase: "fetching", request: msg as any }));
            }
          } catch {
            // not an atom_request — ignore and let the model keep polling
          }
          return undefined;
        }
        if (name.startsWith("agentkit_") && state.get().phase === "fetching") {
          const next = state.get().fetchCalls + 1;
          state.update((s) => ({ ...s, fetchCalls: next }));
          // Parse the envelope and harvest tokens; light best-effort extraction.
          try {
            const body = JSON.parse((ctx.result.content?.[0] as any)?.text ?? "{}");
            const items: any[] = body?.data?.coins ?? body?.data?.items ?? body?.data?.pools ?? [];
            const harvested = items.slice(0, 10).map((it: any) => ({
              symbol: it.symbol ?? it.item?.symbol ?? it.base_token?.symbol ?? "?",
              address: it.address ?? it.item?.id ?? undefined,
              score: it.score ?? it.item?.score ?? undefined,
            }));
            state.update((s) => ({
              ...s,
              collectedTokens: [...s.collectedTokens, ...harvested],
            }));
          } catch {
            // non-JSON content, skip harvest
          }
          if (next >= TRENDS_MAX_FETCH_CALLS || state.get().collectedTokens.length >= 12) {
            state.update((s) => ({ ...s, phase: "ready_to_finalize" }));
          }
        }
        return undefined;
      },
      onStarted: (agent) => {
        agentRef = agent;
        // Runtime-driven finalization: when state hits ready_to_finalize, post the
        // atom_result via Coral MCP directly and abort the agent.
        state.subscribe(async (s) => {
          if (s.phase !== "ready_to_finalize" || !agentRef) return;
          state.update((x) => ({ ...x, phase: "sent" }));
          const threadId = (s.request?.context as any)?.threadId;
          if (!threadId) {
            // Fall back: pull thread id from env or leave absent; Coral still routes by mentions.
          }
          const result: AtomResultT = {
            kind: "atom_result",
            from: env.agentId,
            to: s.request?.from ?? "info",
            data: { tokens: s.collectedTokens.slice(0, 12) },
            summary: `Collected ${s.collectedTokens.length} trending token entries across ${s.fetchCalls} fetches`,
          };
          await coral.callTool("coral_send_message", {
            threadId,
            mentions: [s.request?.from ?? "info"],
            content: encodeAtomMessage(result),
          });
          agentRef.abort();
        });
      },
    };
  },
});
```

NOTE: The Agent Kit action imports above are illustrative — the exact export names and handler signatures from `@solana-agent-kit/plugin-misc` match what the Gen 2 `agents/trends/index.ts` already used. Read that file first (`git show master:agents/trends/index.ts`) and port the exact import shape; do not guess.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: clean. Type errors most likely indicate an import name mismatch with the plugin-misc package — resolve by reading the Gen 2 entry file.

- [ ] **Step 3: Commit**

```bash
git add agents/trends/index.ts
git commit -m "feat(atoms): trends entrypoint on pi-mono with state machine"
```

---

## Task 13: `info` atom — config

**Files:**
- Create: `agents/info/atom-config.ts`

- [ ] **Step 1: Inspect Gen 2 info**

```bash
cat agents/info/coral-agent.toml
git show master:agents/info/index.ts | head -80
```

Note the Agent Kit tools info uses (token-info actions from plugin-misc / plugin-token).

- [ ] **Step 2: Write `agents/info/atom-config.ts`**

```ts
import { Type, type Static } from "@sinclair/typebox";

export const InfoRequest = Type.Object({
  kind: Type.Literal("atom_request"),
  from: Type.String(),
  to: Type.Literal("info"),
  goal: Type.String(),
  context: Type.Record(Type.String(), Type.Unknown(), { default: {} }),
});
export type InfoRequestT = Static<typeof InfoRequest>;

export type InfoPhase =
  | "awaiting_handoff"
  | "enriching"
  | "ready_to_finalize"
  | "sent";

export interface InfoStateData {
  handoffTokens: Array<{ symbol: string; address?: string }>;
  enrichedTokens: Array<{ symbol: string; address?: string; details?: unknown }>;
  originRequester: string | null;
  lookupCalls: number;
}

export const INFO_MAX_LOOKUP_CALLS = 8;

export function infoAllowedByPhase(phase: InfoPhase): string[] | null {
  switch (phase) {
    case "awaiting_handoff":
      return ["coral_wait_for_message"];
    case "enriching":
      return [
        "coral_wait_for_message",
        "agentkit_get_token_info",
        "agentkit_get_token_data_by_address",
        "agentkit_get_token_data_by_ticker",
      ];
    case "ready_to_finalize":
    case "sent":
      return [];
  }
}

export const INFO_RUNTIME_MANAGED: ReadonlySet<string> = new Set([
  "coral_send_message",
]);
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add agents/info/atom-config.ts
git commit -m "feat(atoms): info atom-config"
```

---

## Task 14: `info` atom — entrypoint

**Files:**
- Modify: `agents/info/index.ts` (overwrite Gen 2)

- [ ] **Step 1: Write `agents/info/index.ts`**

Follow the same shape as Task 12 but with info-specific semantics. The state machine ingests an `atom_result` from `trends` via `coral_wait_for_message`, enriches each token via Agent Kit, then the runtime posts an `atom_result` back to the original requester.

```ts
import { Agent } from "@mariozechner/pi-agent-core";
import { startAtom } from "../../src/runtime/atom-template";
import { defineAtomState, makeToolGate } from "../../src/runtime/atom-state";
import { adaptAgentKitAction } from "../../src/agent-kit/adapter";
import { encodeAtomMessage, decodeAtomMessage, type AtomResultT } from "../../src/runtime/messages";
import {
  INFO_MAX_LOOKUP_CALLS,
  INFO_RUNTIME_MANAGED,
  infoAllowedByPhase,
  type InfoPhase,
  type InfoStateData,
} from "./atom-config";
// Mirror the Gen 2 info/index.ts imports for the actual token-info actions.
import * as tokenActions from "@solana-agent-kit/plugin-misc";

const SYSTEM_PROMPT = `You are the \"info\" capability atom.
<resource>coral://instruction</resource>

Your job:
1. Wait for an atom_result handoff from \"trends\".
2. For each token in the handoff, call the relevant token-info tools to enrich it.
3. Do NOT send Coral messages — the runtime composes and posts the final atom_result.

<resource>coral://state</resource>`;

await startAtom({
  systemPrompt: SYSTEM_PROMPT,
  localTools: [
    adaptAgentKitAction({
      name: "agentkit.get_token_info",
      description: "Fetch token info by address or ticker",
      parameters: tokenActions.getTokenInfoAction?.parameters as any,
      handler: async (args: any) => tokenActions.getTokenInfoAction?.handler({} as any, args),
    }),
    // ... port remaining actions the Gen 2 info atom exposed, preserving names
  ],
  initialPrompt: "Begin the info workflow.",
  wire: ({ env, coral }) => {
    const state = defineAtomState<InfoPhase, InfoStateData>({
      phase: "awaiting_handoff",
      handoffTokens: [],
      enrichedTokens: [],
      originRequester: null,
      lookupCalls: 0,
    });
    const gate = makeToolGate({
      runtimeManaged: INFO_RUNTIME_MANAGED as Set<string>,
      allowedByPhase: infoAllowedByPhase,
      state,
    });
    let agentRef: Agent | null = null;

    return {
      beforeToolCall: gate,
      afterToolCall: async (ctx) => {
        const name = ctx.toolCall.name;
        if (name === "coral_wait_for_message" && state.get().phase === "awaiting_handoff") {
          try {
            const text = (ctx.result.content?.[0] as any)?.text ?? "";
            const msg = decodeAtomMessage(text);
            if (msg.kind === "atom_result" && msg.to === "info") {
              const tokens = (msg.data as any).tokens ?? [];
              state.update((s) => ({
                ...s,
                phase: "enriching",
                handoffTokens: tokens,
                originRequester: msg.from,
              }));
            }
          } catch {
            // not ours, keep polling
          }
          return undefined;
        }
        if (name.startsWith("agentkit_") && state.get().phase === "enriching") {
          const next = state.get().lookupCalls + 1;
          try {
            const body = JSON.parse((ctx.result.content?.[0] as any)?.text ?? "{}");
            if (body?.status === "success" && body.data) {
              state.update((s) => ({
                ...s,
                lookupCalls: next,
                enrichedTokens: [...s.enrichedTokens, body.data],
              }));
            } else {
              state.update((s) => ({ ...s, lookupCalls: next }));
            }
          } catch {
            state.update((s) => ({ ...s, lookupCalls: next }));
          }
          const s = state.get();
          if (
            s.lookupCalls >= INFO_MAX_LOOKUP_CALLS ||
            s.enrichedTokens.length >= s.handoffTokens.length
          ) {
            state.update((x) => ({ ...x, phase: "ready_to_finalize" }));
          }
        }
        return undefined;
      },
      onStarted: (agent) => {
        agentRef = agent;
        state.subscribe(async (s) => {
          if (s.phase !== "ready_to_finalize" || !agentRef) return;
          state.update((x) => ({ ...x, phase: "sent" }));
          const result: AtomResultT = {
            kind: "atom_result",
            from: env.agentId,
            to: s.originRequester ?? "conductor",
            data: { enrichedTokens: s.enrichedTokens },
            summary: `Enriched ${s.enrichedTokens.length}/${s.handoffTokens.length} tokens across ${s.lookupCalls} lookups`,
          };
          await coral.callTool("coral_send_message", {
            mentions: [s.originRequester ?? "conductor"],
            content: encodeAtomMessage(result),
          });
          agentRef.abort();
        });
      },
    };
  },
});
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add agents/info/index.ts
git commit -m "feat(atoms): info entrypoint on pi-mono with state machine"
```

---

## Task 15: Full test suite run

**Files:** none (validation)

- [ ] **Step 1: Run all tests**

```bash
npx vitest run
```

Expected: all tests PASS (envelope, adapter, env, messages, resource-expand, coral-mcp, atom-state, debug). If any fail, fix before proceeding.

- [ ] **Step 2: Run typecheck on the whole repo**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 3: Confirm Gen 2 runtime is fully replaced — no residual `ai` SDK imports in `src/runtime/` or `src/agent-kit/` or atom entrypoints**

```bash
npx grep -r "from \"ai\"" src/ agents/ || true
npx grep -r "from '@ai-sdk" src/ agents/ || true
```

Expected: no matches. If anything remains, it's a Gen 2 import that slipped through; remove it.

- [ ] **Step 4: Commit (if any fixups were needed)**

```bash
git add -A
git commit -m "chore(pairwise-pi-mono): clean residual Vercel AI SDK imports" --allow-empty
```

---

## Task 16: Live pairwise run (H2 test)

**Files:** none (validation)

- [ ] **Step 1: Start Coral Server locally**

Run the Gradle path so the server streams live error/debug logs (use a background shell via `run_in_background: true` so the main session keeps progressing):

```bash
cd /Users/bambozlor/Desktop/product-lab/coral-server && CONFIG_FILE_PATH=./config.toml ./gradlew run
```

Expected: server binds `localhost:5555`. Auth key is `local` (set in `config.toml`). If an auth error appears, verify with `cat /Users/bambozlor/Desktop/product-lab/coral-server/config.toml` — the `[server.auth]` section is the source of truth.

When a live Coral run under test surfaces unexpected behavior, read the server log stream via the BashOutput tool against the background shell id — this is how you catch MCP connection errors, thread-routing issues, or session-creation failures in real time instead of inferring them from atom-side artifacts alone.

- [ ] **Step 2: Verify `.env` has `OPENAI_API_KEY` and `COINGECKO_API_KEY`**

```bash
cat .env | grep -E "OPENAI_API_KEY|COINGECKO_API_KEY"
```

Expected: both present. If not, populate from secure storage.

- [ ] **Step 3: Run the pairwise smoke test**

```bash
npx tsx scripts/run-pairwise.ts market-signal-pairwise
```

Expected: script prints the Coral session ID, launches two child atoms (`trends` and `info`), prints their MCP connect lines, streams tool calls, and (crucially) the `trends` atom's debug artifacts show a `coral_send_message` call emitted by the runtime once `ready_to_finalize` fires, and the `info` atom's `coral_wait_for_message` resolves with that message.

- [ ] **Step 4: Inspect the RunArtifact**

```bash
ls .coral-runs/
cat .coral-runs/market-signal-pairwise-*.json | jq '.failure_modes'
```

Expected: `failure_modes` does NOT include `message_non_execution` or `handoff_missing`. Either may be empty `[]` (ideal) or contain unrelated tags (e.g. `rate_limited_soft_fail` if CoinGecko throttled — acceptable for this test).

- [ ] **Step 5: Classify the result**

- **Green (H2 pass):** both atoms emitted an `atom_result`, the failure-modes free of the two target tags. Proceed to Task 17.
- **Red (H2 fail):** one or both atoms failed to emit. Do NOT iterate blindly. Capture the full RunArtifact + `.coral-debug/` dirs, write a new decomp note at `docs/decomposition/ts-coral-framework/pi-mono-pairwise-first-run.md` with the observed failure modes, and escalate for design review before modifying code.

- [ ] **Step 6: Commit the artifacts**

```bash
git add .coral-runs/ -f
git commit -m "test(pairwise-pi-mono): record first live run artifact"
```

---

## Task 17: Cleanup + merge gate

**Files:**
- Modify: `package.json` (remove Vercel AI SDK deps if present and unused)

- [ ] **Step 1: Confirm Vercel AI SDK is no longer imported anywhere**

```bash
npx grep -r "from \"ai\"" . --include="*.ts" | grep -v node_modules | grep -v "\.worktrees/" || true
```

Expected: no matches outside node_modules.

- [ ] **Step 2: Remove unused deps**

```bash
npm uninstall ai @ai-sdk/openai zod
npm run typecheck
```

Expected: typecheck clean. (If `zod` is still used by any remaining Gen 2 artifact outside the paths this plan touched, leave it in place and note which file in a follow-up.)

- [ ] **Step 3: Final test + typecheck**

```bash
npx vitest run && npm run typecheck
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(pairwise-pi-mono): drop vercel AI SDK + zod"
```

- [ ] **Step 5: Push branch for review**

```bash
git push -u origin pairwise-pi-mono
```

- [ ] **Step 6: Hand off to user**

Stop here. Do NOT merge to master. The user decides whether to merge based on the RunArtifact from Task 16. If H2 passed, the next plan (not in this document) is to update memory (`project_solana_aat_status.md`, `project_pairwise_green_red.md`) and write a Gen 3 spec at `docs/superpowers/specs/pi-mono/` consolidating the working pattern.

---

## Self-review checklist

Run through this after executing the plan (or before, during plan review):

1. **Spec coverage:** Every Koog primitive from the thesis (runtime-managed tool gating, runtime-driven finalization, per-iteration status, tool arg sanitization, result compaction, typed workflow state) maps to a concrete task above.
2. **No placeholders:** No "TBD," no "Add error handling," no "Similar to Task N." Where the Gen 2 import names for `@solana-agent-kit/plugin-misc` are unknown to this planner, the plan explicitly says "read `git show master:agents/trends/index.ts`" — that's a concrete action, not a placeholder.
3. **Type consistency:** `AgentTool` signature is consistent across Tasks 5, 10, 12, 14. `AtomStateHandle` is used consistently in Tasks 6, 12, 14. `encodeAtomMessage` / `decodeAtomMessage` are defined in Task 2 and used in Tasks 12, 14. `readCoralEnv` defined in Task 1, used in Task 8.
4. **TDD discipline:** Tasks 1–10 follow red-green-commit. Tasks 11–14 are integration-heavy (atoms) and skip unit TDD because mocking the full Coral + MCP stack at unit scale would be more brittle than the live pairwise run in Task 16 — which IS the test.
5. **Commits are granular:** One commit per task, bounded ~5-minute steps within.

---

## Follow-on (explicitly NOT in this plan)

- 10-run × 3-atom H2 validation bar from the thesis.
- Gen 3 spec consolidation at `docs/superpowers/specs/pi-mono/`.
- Extraction of `@coral-protocol/coral-pi-mcp`, `@coral-protocol/coral-atom` as workspace packages (Option C packaging).
- Second atom-type coverage (e.g. a non-Solana atom) for framework-generalization evidence.
