# Solana Coralised Agents

This repository is in a rewrite phase.

The previous skills-first implementation has been archived in Git as:

- Commit: `95e92e3` (`archive: checkpoint skills-first architecture`)
- Tag: `archive/skills-first-architecture`

That version generated one Coral agent per Solana skill and then added protocol tools after the fact. The postmortem in `docs/debugging-logs/postmortem-skills-first-architecture.md` explains why that produced agents that could discuss protocols but could not reliably execute multi-agent workflows.

## New Direction

The new architecture keeps the original thesis but changes the ownership boundary:

- SendAI `solana-agent-kit` owns Solana protocol actions.
- This repo owns Coral coordination, agent profiles, policy middleware, and runtime behavior.
- Skills documentation becomes reference material, not agent identity.

## Target Shape

```text
src/
  runtime/       Coral task loop and MCP coordination runtime
  agent-kit/     SendAI Agent Kit plugin loading, filtering, and tool adaptation
  policies/      approval, simulation, spend, rate-limit, and action-risk gates
  profiles/      workflow-oriented agent profiles

agents/
  market-intelligence/
    README.md    first read-only profile scaffold

docs/
  debugging-logs/
    postmortem-skills-first-architecture.md
```

## Rewrite Sequence

1. Archive and tag the old implementation.
2. Remove the generated skill-first agent surface from the active tree.
3. Scaffold the new runtime, Agent Kit, policy, and profile boundaries.
4. Build one read-only `market-intelligence` prototype using curated Agent Kit actions.
5. Add wallet/policy middleware before reintroducing signing or transaction-submitting actions.
6. Expand by workflow profiles, not by one-agent-per-protocol generation.

## Current Status

Only the rewrite skeleton is active. There are no runnable Coral agents yet.
