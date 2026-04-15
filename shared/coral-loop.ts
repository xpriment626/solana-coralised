/**
 * Shared Coral agent runtime.
 *
 * Each agent calls `runCoralAgent(config)` with its own system prompt.
 * The runtime:
 *   1. Connects to the Coral MCP server via CORAL_CONNECTION_URL
 *   2. Discovers available coral_* coordination tools
 *   3. Bridges them into the Vercel AI SDK so the LLM can call them
 *   4. Loops: wait-for-mention → LLM processes → responds → repeat
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { generateText, tool, jsonSchema } from "ai";
import { openai } from "@ai-sdk/openai";

// ── Types ────────────────────────────────────────────────────────────

export interface AgentConfig {
  /** Display name shown in logs */
  name: string;
  /** Full system prompt — domain expertise + Coral coordination instructions */
  systemPrompt: string;
  /**
   * Raw GitHub URL to this agent's SKILL.md from sendaifun/skills.
   * Fetched once at startup and appended to the system prompt.
   * e.g. "https://raw.githubusercontent.com/sendaifun/skills/main/skills/helius/SKILL.md"
   */
  skillUrl?: string;
  /** OpenAI model id (default: gpt-5.4-mini) */
  model?: string;
  /** Max tool-call steps per LLM invocation (default: 15) */
  maxSteps?: number;
  /** Agent-specific execution tools — merged with Coral coordination tools */
  tools?: Record<string, any>;
}

// ── Helpers ──────────────────────────────────────────────────────────

function requiredEnv(key: string): string {
  const v = process.env[key];
  if (!v) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
  return v;
}

/** Numeric constraint keywords that OpenAI validates and that MCP schemas sometimes
 *  set to absurd defaults (e.g. Number.MAX_SAFE_INTEGER). */
const NUMERIC_CONSTRAINT_KEYS = [
  "maxLength", "minLength", "maximum", "minimum",
  "exclusiveMaximum", "exclusiveMinimum",
  "maxItems", "minItems", "maxProperties", "minProperties",
];

/** Threshold above which a numeric constraint is stripped — OpenAI rejects these. */
const MAX_SANE_NUMERIC = 1_000_000;

/**
 * Recursively patch MCP tool schemas for OpenAI compatibility:
 *  - Add `additionalProperties: false` to every object-type schema
 *  - Strip absurdly large numeric constraints
 */
function patchSchemaForOpenAI(schema: any): any {
  if (schema == null || typeof schema !== "object") return schema;

  const patched = { ...schema };

  // If this level is type: "object" (or has "properties"), add the flag
  if (patched.type === "object" || patched.properties) {
    patched.additionalProperties = false;
  }

  // Strip numeric constraints that are too large for OpenAI
  for (const key of NUMERIC_CONSTRAINT_KEYS) {
    if (typeof patched[key] === "number" && Math.abs(patched[key]) > MAX_SANE_NUMERIC) {
      delete patched[key];
    }
  }

  // Recurse into properties
  if (patched.properties) {
    const props: Record<string, any> = {};
    for (const [key, val] of Object.entries(patched.properties)) {
      props[key] = patchSchemaForOpenAI(val);
    }
    patched.properties = props;
  }

  // Recurse into items (arrays)
  if (patched.items) {
    patched.items = patchSchemaForOpenAI(patched.items);
  }

  // Recurse into anyOf / oneOf / allOf
  for (const keyword of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(patched[keyword])) {
      patched[keyword] = patched[keyword].map(patchSchemaForOpenAI);
    }
  }

  return patched;
}

/** Convert MCP tool list → Vercel AI SDK tool map */
function bridgeTools(
  mcpTools: Array<{ name: string; description?: string; inputSchema?: unknown }>,
  client: Client
) {
  const out: Record<string, any> = {};

  for (const t of mcpTools) {
    // coral_wait_for_mention is handled by the outer loop, skip it
    if (t.name === "coral_wait_for_mention") continue;

    const patchedSchema = patchSchemaForOpenAI(t.inputSchema ?? { type: "object", properties: {} });

    out[t.name] = tool({
      description: t.description ?? t.name,
      parameters: jsonSchema(patchedSchema),
      execute: async (args: any) => {
        const result = await client.callTool({
          name: t.name,
          arguments: args,
        });
        return JSON.stringify(result.content);
      },
    });
  }
  return out;
}

// ── Main loop ────────────────────────────────────────────────────────

export async function runCoralAgent(config: AgentConfig): Promise<never> {
  const coralUrl = requiredEnv("CORAL_CONNECTION_URL");
  const agentId = requiredEnv("CORAL_AGENT_ID");

  // ── Load Solana Skill content ──
  let systemPrompt = config.systemPrompt;
  if (config.skillUrl) {
    console.log(`[${config.name}] Fetching skill from ${config.skillUrl}…`);
    try {
      const res = await fetch(config.skillUrl);
      if (res.ok) {
        const skillContent = await res.text();
        systemPrompt += `\n\n## Solana Skill Reference\n\nThe following is your authoritative skill reference. Use it as your primary source of truth for API endpoints, SDK patterns, code examples, and gotchas. When in doubt, follow this reference over general knowledge.\n\n${skillContent}`;
        console.log(
          `[${config.name}] Loaded skill (${(skillContent.length / 1024).toFixed(1)}KB)`
        );
      } else {
        console.warn(
          `[${config.name}] Failed to fetch skill (HTTP ${res.status}), continuing without it`
        );
      }
    } catch (err: any) {
      console.warn(
        `[${config.name}] Failed to fetch skill: ${err?.message}, continuing without it`
      );
    }
  }

  // ── Connect to Coral MCP ──
  const client = new Client({ name: agentId, version: "1.0.0" });

  const transport = new StreamableHTTPClientTransport(new URL(coralUrl));

  try {
    await client.connect(transport);
  } catch (err: any) {
    console.error(`[${config.name}] FATAL: MCP connect failed:`, err?.message ?? err);
    process.exit(1);
  }
  console.log(`[${config.name}] Connected to Coral`);

  // ── Discover and bridge tools ──
  const { tools: mcpTools } = await client.listTools();
  const coralTools = bridgeTools(mcpTools, client);
  const aiTools = { ...coralTools, ...(config.tools ?? {}) };
  const agentToolCount = Object.keys(config.tools ?? {}).length;
  console.log(
    `[${config.name}] Bridged ${Object.keys(coralTools).length} coral tools + ${agentToolCount} agent tools to AI SDK`
  );

  const model = openai(config.model ?? "gpt-5.4-mini");
  const maxSteps = config.maxSteps ?? 15;

  // ── Agent loop ──
  console.log(`[${config.name}] Entering main loop — waiting for mentions…`);

  while (true) {
    try {
      // 1. Block until another agent mentions us
      const mention = await client.callTool({
        name: "coral_wait_for_mention",
        arguments: {},
      });

      const mentionPayload = JSON.stringify(mention.content);
      console.log(
        `[${config.name}] Mentioned: ${mentionPayload.substring(0, 120)}…`
      );

      // 2. Let the LLM process and respond via coral tools
      await generateText({
        model,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              `<mention>\n${mentionPayload}\n</mention>`,
              `Process this mention. Use coral_send_message to respond on the correct thread. If you need to coordinate with other agents, use the coral tools available to you.`,
            ].join("\n\n"),
          },
        ],
        tools: aiTools,
        maxSteps,
      });

      console.log(`[${config.name}] Processed mention — returning to wait.`);
    } catch (err: any) {
      console.error(`[${config.name}] Error in loop:`, err?.message ?? err);
      // Brief backoff before retrying
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
