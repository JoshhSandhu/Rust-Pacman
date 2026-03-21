import { AnchorProvider, Program, Idl } from '@coral-xyz/anchor';
import { Connection } from '@solana/web3.js';
import { AnchorWallet } from '@solana/wallet-adapter-react';
import type { PacRoyale } from '../../../target/types/pac_royale';

// ✅ Use the real generated IDL — imported at build time via Vite's JSON import.
// This fixes: "Accounts require `idl.types`" — the hand-written IDL was missing
// metadata + discriminators required by @coral-xyz/anchor >=0.30.
import PAC_ROYALE_IDL_JSON from '@idl/pac_royale.json';

const PAC_ROYALE_IDL = PAC_ROYALE_IDL_JSON as unknown as PacRoyale;

// --- Singleton with wallet-key guard ---
// Bug: the old singleton didn't check *which* wallet created it.
// If the user switches wallets we must recreate the provider.
let programInstance: Program<PacRoyale> | null = null;
let programWalletKey: string | null = null;

export function getProgram(wallet: AnchorWallet, connection: Connection): Program<PacRoyale> {
  const currentKey = wallet.publicKey.toBase58();

  // Bust singleton when wallet changes or is new
  if (programInstance && programWalletKey !== currentKey) {
    programInstance = null;
    programWalletKey = null;
  }

  if (!programInstance) {
    const provider = new AnchorProvider(connection, wallet, {
      commitment: 'confirmed',
      preflightCommitment: 'confirmed',
    });
    programInstance = new Program(PAC_ROYALE_IDL, provider);
    programWalletKey = currentKey;
  }

  return programInstance;
}

export function resetProgram() {
  programInstance = null;
  programWalletKey = null;
}

export const DEVNET_RPC =
  import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
