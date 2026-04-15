import { Connection } from "@solana/web3.js";

let _connection: Connection | null = null;

/**
 * Singleton Solana RPC connection from SOLANA_RPC_URL env var.
 * Shared across all tool handlers within an agent process.
 * One connection per agent, not per tool call.
 */
export function getConnection(): Connection {
  if (!_connection) {
    const url = process.env.SOLANA_RPC_URL;
    if (!url) {
      console.error("Missing SOLANA_RPC_URL environment variable");
      process.exit(1);
    }
    _connection = new Connection(url, "confirmed");
  }
  return _connection;
}
