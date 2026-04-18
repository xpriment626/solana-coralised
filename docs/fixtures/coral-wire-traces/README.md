# Coral Wire Trace Fixtures

**Purpose:** Capture executable wire traces from known-good Coral sessions. Any future TS Coral runtime implementation must replay these traces successfully before it is allowed to proceed past the receive-path checkpoint. The fixture is the spec; no plan document overrides it.

This directory exists because the pi-mono port attempt 1 (2026-04-18) regressed the receive path that Gen 2 (`atoms-runtime`) had working. There was no fixture to catch the regression. Fixing that gap is a precondition for any further runtime work. Background: [`docs/decomposition/ts-coral-framework/pi-mono-pairwise-first-run.md`](../../decomposition/ts-coral-framework/pi-mono-pairwise-first-run.md).

## Sources

### 1. atoms-runtime (Gen 2 TS) — receive path green

- **Worktree:** `.worktrees/atoms-runtime` (branch `atoms-runtime`, commit `ea3df49`)
- **Coral Server config:** the one in this repo (`coral-server/config.toml`) — currently points at `.worktrees/atoms-runtime/agents/{market-trends,token-info}` for the trends/info atoms.
- **What's green here:** atoms launch via `npx --yes tsx index.ts`, complete MCP/SSE handshake, **successfully receive the puppet seed `atom_request`**, and execute Agent Kit calls in response (46 in the original 2026-04-17 session).
- **What's red here (out of scope for fixture-1):** atoms never call `coral_send_message`. Capture stops once we've confirmed receive — send is the next milestone after fixture-1, not part of it.
- **Reference session:** `cd34fd31-7067-473c-b799-ab68e1138e41` (RunArtifact in worktree's `.coral-runs/`).

### 2. compliance-demo (Kotlin) — full end-to-end green

- **Repo:** `/Users/bambozlor/Desktop/content-lab/compliance-demo/`
- **Coral Server config:** `compliance-demo/coral-server/config.toml` (independent of this repo's config; same `./gradlew run` command, different `--config` path).
- **What's green here:** everything. Including `coral_send_message`, runtime-managed thread tools, runtime-driven finalization. This is the TS framework thesis target.
- **Why this trace is needed alongside fixture-1:** atoms-runtime cannot show us what a successful send/handoff looks like over the wire. Compliance-demo can.
- **Reference Kotlin:** `coral-sanctions-agent/src/main/kotlin/ai/coralprotocol/coral/koog/fullexample/Main.kt` (already referenced in memory `reference_coral_koog_agent.md`).

## Capture format (TBD — to be decided in the next session)

Goal: a format that any TS runtime can deterministically replay against, producing the same MCP request/response sequence. Open questions before settling on a format:

- **Granularity:** every MCP frame, or just the semantically meaningful exchanges (atom_request seed → first agent tool call → ...)?
- **Time:** capture wall-clock timestamps verbatim, or normalize to relative offsets so the replay isn't sensitive to `currentUnixTime`-style server expectations?
- **Mocking strategy:** does the fixture include the LLM tool-call decisions (i.e. replay both sides of the conversation), or just the Coral side (i.e. fixture asserts on what the runtime sends to Coral, but lets a live LLM drive the agent loop)?

The pi-mono attempt 1 failure mode (model picks `currentUnixTime` once and reuses it) suggests the LLM-driven side has its own determinism issues. A first cut probably captures the Coral side verbatim (server logs + MCP frames) and treats the LLM side as a separate concern.

## Files in this directory (as they land)

```
docs/fixtures/coral-wire-traces/
├── README.md                                      (this file)
├── 01-atoms-runtime-receive-seed/                 (TBD — fixture-1)
│   ├── coral-server.log
│   ├── puppet-seed.json
│   ├── trends-mcp-frames.jsonl
│   ├── info-mcp-frames.jsonl
│   └── README.md                                  (what this fixture asserts)
└── 02-compliance-demo-full-loop/                  (TBD — fixture-2)
    └── ...
```

## Non-negotiable rules

1. **No new runtime code lands before fixture-1 exists.** The point of this directory is to make the regression bar executable. Skipping the fixture and "just trying pi-mono again with the cutoff bug fixed" is exactly the anti-pattern this directory exists to prevent.
2. **Fixtures are append-only.** If a fixture turns out to be wrong, write a new fixture and supersede the old one in this README — don't edit the captured frames in place. We need to be able to compare what was vs what is.
3. **Preserve the trace sources.** Don't touch `.worktrees/atoms-runtime` or `compliance-demo` once captures begin. If either stops working, we lose the source.

## Status

- 2026-04-18: directory created; sources identified; format not yet captured. Next session: capture fixture-1.
