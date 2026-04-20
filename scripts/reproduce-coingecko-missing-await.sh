#!/usr/bin/env bash
# Reproducer for missing `await` in @solana-agent-kit/plugin-misc's
# GET_COINGECKO_TOKEN_PRICE_DATA_ACTION handler.
#
# Bug: the handler wraps `getTokenPriceData(agent, addresses)` without awaiting
# it. Because `getTokenPriceData` is async, the handler returns
# `{status: "success", result: Promise{...}}`. JSON.stringify serializes the
# Promise to `{}` (Promises have no enumerable own properties), so every caller
# sees an empty `result` even though the underlying fetch succeeded.
#
# This script calls the handler two ways back-to-back:
#   Call B — handler as shipped
#   Call A — same handler, but manually await the inner Promise before serializing
#
# Both use the same SolanaAgentKit instance, same Demo key, same URL. Any diff
# proves the bug is a missing `await` inside the handler, not a config or key
# issue.
#
# Usage:
#   COINGECKO_API_KEY=<demo_key> ./scripts/reproduce-coingecko-missing-await.sh
#
# Requires: solana-coralised deps installed (node_modules present).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -z "${COINGECKO_API_KEY:-}" ]]; then
  if [[ -f "$ROOT/.env" ]]; then
    set -a; source "$ROOT/.env"; set +a
  fi
fi

if [[ -z "${COINGECKO_API_KEY:-}" ]]; then
  echo "error: COINGECKO_API_KEY not set (export it or put it in $ROOT/.env)" >&2
  exit 1
fi

echo "===== Versions ====="
node -v
echo "solana-agent-kit          $(node -p "require('./node_modules/solana-agent-kit/package.json').version")"
echo "@solana-agent-kit/plugin-misc  $(node -p "require('./node_modules/@solana-agent-kit/plugin-misc/package.json').version")"
echo

node --import tsx -e "
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sak = require('solana-agent-kit');
const { Keypair } = require('@solana/web3.js');
const misc = require('@solana-agent-kit/plugin-misc');

const rpc = 'https://api.mainnet-beta.solana.com';
const wallet = new sak.KeypairWallet(Keypair.generate(), rpc);
let agent = new sak.SolanaAgentKit(wallet, rpc, {
  COINGECKO_DEMO_API_KEY: process.env.COINGECKO_API_KEY,
});
agent = agent.use(misc.default ?? misc);

const action = agent.actions.find(a => a.name === 'GET_COINGECKO_TOKEN_PRICE_DATA_ACTION');
if (!action) throw new Error('action not registered — plugin setup failed');
const SOL_MINT = 'So11111111111111111111111111111111111111112';

console.log('===== Call B: handler as shipped (buggy) =====');
const b = await action.handler(agent, { tokenAddresses: [SOL_MINT] });
console.log('typeof b.result:              ', typeof b.result);
console.log('b.result instanceof Promise:  ', b.result instanceof Promise);
console.log('JSON.stringify(b):            ', JSON.stringify(b));
console.log();

console.log('===== Call A: same handler + manually-awaited inner Promise =====');
const resolved = { status: b.status, result: await b.result };
console.log('JSON.stringify(resolved):     ', JSON.stringify(resolved));
console.log();

console.log('===== Diagnosis =====');
console.log('Call B returns a serialized Promise (appears as {}) because the');
console.log('handler in plugin-misc does:');
console.log('    result: getTokenPriceData(agent, input.tokenAddresses)');
console.log('where getTokenPriceData is async. One-line fix upstream:');
console.log('    result: await getTokenPriceData(agent, input.tokenAddresses)');
"
