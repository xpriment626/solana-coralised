#!/bin/bash
# Link every agent in agents/ to the local Coral registry (~/.coral/agents/)
# so that any `npx coral-server` or local Gradle server discovers them automatically.
#
# Usage: bash scripts/link-all.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENTS_DIR="$SCRIPT_DIR/../agents"

echo "Linking all agents to local Coral registry…"
echo ""

count=0
for agent_dir in "$AGENTS_DIR"/*/; do
  if [ -f "$agent_dir/coral-agent.toml" ]; then
    agent_name=$(basename "$agent_dir")
    echo "  → linking $agent_name"
    (cd "$agent_dir" && npx @coral-protocol/coralizer@latest link .)
    count=$((count + 1))
  fi
done

echo ""
echo "Done. $count agents linked to ~/.coral/agents/"
echo "They will be discovered by any Coral server running on this machine."
