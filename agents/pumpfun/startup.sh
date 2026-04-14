#!/bin/bash
# Coral-launched startup for solana-pumpfun
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Load shared environment variables (API keys, RPC URLs, etc.)
if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  source "$ROOT_DIR/.env"
  set +a
fi

echo "=== solana-pumpfun ==="
echo "Agent ID:       $CORAL_AGENT_ID"
echo "Session ID:     $CORAL_SESSION_ID"
echo "Connection URL: $CORAL_CONNECTION_URL"

cd "$ROOT_DIR"
exec npx tsx "$SCRIPT_DIR/index.ts"
