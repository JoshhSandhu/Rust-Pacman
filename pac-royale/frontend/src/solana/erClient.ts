/**
 * erClient.ts — MagicBlock Ephemeral Rollup connection and program factory.
 *
 * All gameplay transactions (movement, eat_pellet, eat_ghost, eat_player) go
 * through the ER program returned by createErProgram(). They are signed by the
 * ephemeral session Keypair — never by Phantom.
 *
 * State reads (world, players, ghosts, chunks) are also polled from ER since
 * all game accounts are delegated to the ER during gameplay.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import IDL from "../../../target/idl/pac_royale.json";
import type { PacRoyale } from "../../../target/types/pac_royale";

// ────────────────────────────────────────────────────────────────
// ER Endpoints
// ────────────────────────────────────────────────────────────────

export const ER_RPC_ENDPOINT =
  import.meta.env.VITE_ER_RPC_URL || "https://devnet-as.magicblock.app/";
export const ER_WSS_ENDPOINT =
  import.meta.env.VITE_ER_WSS_URL || "wss://devnet-as.magicblock.app/";

let sharedErConnection: Connection | null = null;

// ────────────────────────────────────────────────────────────────
// Minimal NodeWallet shim (works in both browser and Node)
// ────────────────────────────────────────────────────────────────

class SessionWallet implements Wallet {
  constructor(readonly payer: Keypair) {}

  get publicKey(): PublicKey {
    return this.payer.publicKey;
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T> {
    if (tx instanceof VersionedTransaction) {
      tx.sign([this.payer]);
    } else {
      (tx as Transaction).partialSign(this.payer);
    }
    return tx;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[],
  ): Promise<T[]> {
    return txs.map((tx) => {
      if (tx instanceof VersionedTransaction) {
        tx.sign([this.payer]);
      } else {
        (tx as Transaction).partialSign(this.payer);
      }
      return tx;
    });
  }
}

// ────────────────────────────────────────────────────────────────
// Factory functions
// ────────────────────────────────────────────────────────────────

/** Creates a Connection to the MagicBlock ER node (processed commitment for low latency). */
export function createErConnection(): Connection {
  return new Connection(ER_RPC_ENDPOINT, {
    commitment: "processed",
    wsEndpoint: ER_WSS_ENDPOINT,
  });
}

/** Returns a shared ER connection for reactive reads/subscriptions. */
export function getSharedErConnection(): Connection {
  if (!sharedErConnection) {
    sharedErConnection = createErConnection();
  }
  return sharedErConnection;
}

/** Creates an Anchor Program pointed at the ER, signed by the session Keypair. */
export function createErProgram(sessionKeypair: Keypair): Program<PacRoyale> {
  const connection = getSharedErConnection();
  const wallet = new SessionWallet(sessionKeypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "processed",
    skipPreflight: true, // ER doesn't support preflight simulation
  });
  return new Program(IDL as PacRoyale, provider);
}

/** Creates an Anchor Program pointed at the ER, signed by the connected wallet. */
export function createErProgramWithWallet(
  wallet: AnchorWallet | Wallet,
): Program<PacRoyale> {
  const connection = getSharedErConnection();
  const provider = new AnchorProvider(connection, wallet as Wallet, {
    commitment: "processed",
    skipPreflight: true,
  });
  return new Program(IDL as PacRoyale, provider);
}

// ────────────────────────────────────────────────────────────────
// Retry wrapper
// ────────────────────────────────────────────────────────────────

/**
 * Wraps an async ER transaction call with simple retry logic.
 * ER nodes occasionally drop packets; 3 retries with 200ms backoff is sufficient.
 */
export async function sendWithRetry<T>(
  txFn: () => Promise<T>,
  maxRetries = 3,
  delayMs = 200,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await txFn();
    } catch (err) {
      lastErr = err;
      // Don't retry logic errors (NotAuthority, MoveTooFast, etc.)
      const msg = String(err);
      if (
        msg.includes("NotAuthority") ||
        msg.includes("MoveTooFast") ||
        msg.includes("PlayerDead") ||
        msg.includes("WrongChunk")
      ) {
        throw err;
      }
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

// ────────────────────────────────────────────────────────────────
// Health check
// ────────────────────────────────────────────────────────────────

/** Returns true if the ER node is reachable. */
export async function checkErHealth(): Promise<boolean> {
  try {
    const conn = getSharedErConnection();
    await conn.getSlot();
    return true;
  } catch {
    return false;
  }
}
