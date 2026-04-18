import type { AgentTool } from "@mariozechner/pi-agent-core";
import { buildSystemPrompt } from "./prompt.js";

export interface PreparedFirstTurnEnv {
  SYSTEM_PROMPT: string;
  EXTRA_SYSTEM_PROMPT: string;
}

export interface PreparedFirstTurnMcp {
  readResource: (uri: string) => Promise<string>;
  tools: AgentTool<any>[];
}

export interface PrepareFirstTurnConfig {
  mcp: PreparedFirstTurnMcp;
  env: PreparedFirstTurnEnv;
}

export interface PreparedFirstTurn {
  systemPrompt: string;
  instructionResource: string;
  stateResource: string;
  firstTurnTools: AgentTool<any>[];
}

// Fixture-1 headline finding: receive happens through the pre-loaded
// coral://state resource expanded into the system prompt, not through
// coral_wait_for_message. Attempt 1 surfaced the wait tools at iter-0 and the
// model latched on to a stale currentUnixTime, missing the seed permanently.
// The first turn therefore excludes every wait primitive.
const FIRST_TURN_TOOL_BLOCKLIST = new Set([
  "coral_wait_for_message",
  "coral_wait_for_mention",
  "coral_wait_for_agent",
]);

export async function prepareFirstTurn(
  config: PrepareFirstTurnConfig
): Promise<PreparedFirstTurn> {
  const [instructionResource, stateResource] = await Promise.all([
    config.mcp.readResource("coral://instruction"),
    config.mcp.readResource("coral://state"),
  ]);

  const systemPrompt = buildSystemPrompt({
    systemPrompt: config.env.SYSTEM_PROMPT,
    extraSystemPrompt: config.env.EXTRA_SYSTEM_PROMPT,
    instructionResource,
    stateResource,
  });

  const firstTurnTools = config.mcp.tools.filter(
    (t) => !FIRST_TURN_TOOL_BLOCKLIST.has(t.name)
  );

  return { systemPrompt, instructionResource, stateResource, firstTurnTools };
}
