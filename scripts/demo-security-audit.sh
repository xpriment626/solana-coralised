#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# Security Audit Demo — starts Coral server, creates session with code-recon +
# vulnhunter + puppet, creates a thread, and sends the audit planning prompt.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Coral server needs Java 24+
export JAVA_HOME=$(/usr/libexec/java_home -v 25 2>/dev/null || /usr/libexec/java_home)
export PATH="$JAVA_HOME/bin:$PATH"

BASE_URL="http://127.0.0.1:5555"
AUTH="dev"
REPO_PATH="/Users/bambozlor/Desktop/product-lab/lighthouse"
LOG_FILE="/tmp/coral-demo-server.log"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load .env for the OPENAI_API_KEY (required by agent TOML options)
if [ -f "$ROOT_DIR/.env" ]; then
  set -a; source "$ROOT_DIR/.env"; set +a
fi
OPENAI_KEY="${OPENAI_API_KEY:?OPENAI_API_KEY not set in .env}"

# ── Helpers ──────────────────────────────────────────────────────────────────

log()  { echo "[demo] $*"; }
fail() { echo "[demo] FAIL: $*" >&2; exit 1; }

api() {
  local method=$1 path=$2
  shift 2
  local response
  response=$(curl -s -w "\n%{http_code}" -X "$method" "$BASE_URL$path" \
    -H "Authorization: Bearer $AUTH" \
    -H "Content-Type: application/json" \
    "$@" 2>&1)
  local http_code body
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')
  if [[ "$http_code" -ge 400 ]]; then
    echo "[demo] API $method $path failed (HTTP $http_code):" >&2
    echo "$body" | jq . 2>/dev/null || echo "$body" >&2
    return 1
  fi
  echo "$body"
}

wait_for_server() {
  log "Waiting for Coral server on port 5555..."
  for i in $(seq 1 60); do
    if curl -s -o /dev/null "$BASE_URL" 2>/dev/null; then
      log "Server is up (took ${i}s)"
      return 0
    fi
    sleep 1
  done
  fail "Server did not start within 60s. Check $LOG_FILE"
}

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    log "Stopping Coral server (PID $SERVER_PID)..."
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ── 1. Start Coral server ───────────────────────────────────────────────────

log "Starting Coral server (logs → $LOG_FILE)..."
npx coralos-dev@1.1.0-SNAPSHOT-18 server start \
  -- --auth.keys="$AUTH" \
  --console.console-release-version="v0.3.10" \
  --registry.include-debug-agents=true \
  > "$LOG_FILE" 2>&1 &
SERVER_PID=$!
log "Server PID: $SERVER_PID"

wait_for_server

# ── 2. Create session with security agents + puppet ──────────────────────────

log "Creating session..."

# Build the JSON request with proper Coral types
SESSION_BODY=$(jq -n \
  --arg apiKey "$OPENAI_KEY" \
  '{
    agentGraphRequest: {
      agents: [
        {
          id: {
            name: "solana-code-recon",
            version: "0.1.0",
            registrySourceId: { type: "local" }
          },
          name: "solana-code-recon",
          provider: { type: "local", runtime: "executable" },
          options: {
            OPENAI_API_KEY: { type: "string", value: $apiKey }
          }
        },
        {
          id: {
            name: "solana-vulnhunter",
            version: "0.1.0",
            registrySourceId: { type: "local" }
          },
          name: "solana-vulnhunter",
          provider: { type: "local", runtime: "executable" },
          options: {
            OPENAI_API_KEY: { type: "string", value: $apiKey }
          }
        },
        {
          id: {
            name: "puppet",
            version: "1.0.0",
            registrySourceId: { type: "local" }
          },
          name: "puppet",
          provider: { type: "local", runtime: "function" }
        }
      ],
      groups: [["solana-code-recon", "solana-vulnhunter", "puppet"]]
    },
    namespaceProvider: {
      type: "create_if_not_exists",
      namespaceRequest: { name: "default" }
    },
    execution: {
      mode: "immediate"
    }
  }')

SESSION_RESPONSE=$(api POST "/api/v1/local/session" -d "$SESSION_BODY")

SESSION_ID=$(echo "$SESSION_RESPONSE" | jq -r '.sessionId')
NAMESPACE=$(echo "$SESSION_RESPONSE" | jq -r '.namespace')

if [[ "$SESSION_ID" == "null" || -z "$SESSION_ID" ]]; then
  log "Session response: $SESSION_RESPONSE"
  fail "Could not extract sessionId"
fi

log "Session created: namespace=$NAMESPACE, sessionId=$SESSION_ID"

# ── 3. Wait for agents to boot, fetch skills, and connect ───────────────────

log "Waiting 20s for agents to boot and connect..."
sleep 20

# Verify agents are connected
log "Checking session state..."
SESSION_STATE=$(api GET "/api/v1/local/session/$NAMESPACE/$SESSION_ID/extended" || echo "{}")
log "Session state:"
echo "$SESSION_STATE" | jq -c '.agents // empty' 2>/dev/null || echo "$SESSION_STATE" | head -5

# ── 4. Create thread via puppet ─────────────────────────────────────────────

log "Creating thread via puppet..."
THREAD_RESPONSE=$(api POST "/api/v1/puppet/$NAMESPACE/$SESSION_ID/puppet/thread" -d '{
  "threadName": "Security Audit Planning",
  "participantNames": ["solana-code-recon", "solana-vulnhunter"]
}')

THREAD_ID=$(echo "$THREAD_RESPONSE" | jq -r '.thread.id // .threadId // .id // empty' 2>/dev/null)

if [[ -z "$THREAD_ID" ]]; then
  log "Thread response: $THREAD_RESPONSE"
  fail "Could not extract threadId"
fi

log "Thread created: $THREAD_ID"

# ── 5. Send the audit planning message ──────────────────────────────────────

log "Sending audit message..."
MSG_RESPONSE=$(api POST "/api/v1/puppet/$NAMESPACE/$SESSION_ID/puppet/thread/message" -d "$(jq -n \
  --arg threadId "$THREAD_ID" \
  --arg content "@solana-code-recon @solana-vulnhunter Do an initial pass of this repo and collaborate to produce a security audit plan. The repo is at $REPO_PATH. Do NOT attempt a full audit — review the structure, identify the key trust boundaries and attack surface, and propose a phased plan for how to approach a thorough audit." \
  '{threadId: $threadId, content: $content, mentions: ["solana-code-recon", "solana-vulnhunter"]}')")

log "Message sent!"
echo "$MSG_RESPONSE" | jq . 2>/dev/null || echo "$MSG_RESPONSE"

# ── 6. Tail server logs ────────────────────────────────────────────────────

echo ""
log "=== Tailing server logs (Ctrl+C to stop) ==="
echo ""
tail -f "$LOG_FILE"
