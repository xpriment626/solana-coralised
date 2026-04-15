import {
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

/**
 * Standard Solana wallet interface — matches the wallet-adapter contract
 * used by Turnkey, Privy, Crossmint, and SendAI's agent kit.
 * Any provider implementing these four members is a drop-in replacement.
 */
export interface Wallet {
  publicKey: PublicKey;
  signTransaction(
    tx: Transaction | VersionedTransaction
  ): Promise<Transaction | VersionedTransaction>;
  signAllTransactions(
    txs: (Transaction | VersionedTransaction)[]
  ): Promise<(Transaction | VersionedTransaction)[]>;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

/**
 * Dev-only wallet backed by a raw Keypair held in memory.
 * DO NOT use in production — use a managed wallet provider (Turnkey, Privy, etc.).
 */
export class KeypairWallet implements Wallet {
  private keypair: Keypair;
  publicKey: PublicKey;

  constructor(secretKey: Uint8Array) {
    this.keypair = Keypair.fromSecretKey(secretKey);
    this.publicKey = this.keypair.publicKey;
  }

  async signTransaction(
    tx: Transaction | VersionedTransaction
  ): Promise<Transaction | VersionedTransaction> {
    if (tx instanceof VersionedTransaction) {
      tx.sign([this.keypair]);
      return tx;
    }
    tx.partialSign(this.keypair);
    return tx;
  }

  async signAllTransactions(
    txs: (Transaction | VersionedTransaction)[]
  ): Promise<(Transaction | VersionedTransaction)[]> {
    return Promise.all(txs.map((tx) => this.signTransaction(tx)));
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    // Ed25519 detached signature using the keypair's secret key.
    // tweetnacl is a transitive dep of @solana/web3.js — always available.
    const nacl = await import("tweetnacl");
    return nacl.default.sign.detached(message, this.keypair.secretKey);
  }
}
