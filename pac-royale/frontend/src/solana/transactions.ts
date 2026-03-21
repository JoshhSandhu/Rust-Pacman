import { Program } from "@coral-xyz/anchor";
import { PublicKey, SendOptions, SystemProgram, Transaction } from "@solana/web3.js";
import {
  getWorldPda,
  getPlayerPda,
  getChunkPda,
  getGhostPda,
  getAnteroomPda,
  getVaultPda,
} from "./pda";
import {
  useGameStore,
  MAX_CHUNKS,
  CHUNK_ROWS,
  CHUNK_COLS,
} from "../state/gameStore";
import { sendWithRetry } from "./erClient";

const DELEGATION_PROGRAM_ID = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
);

async function sendProgramMethod(
  program: Program<any>,
  buildMethod: () => any,
): Promise<string> {
  const provider = program.provider as any;
  const connection = provider.connection;
  const wallet = provider.wallet;

  const tx = (await buildMethod().transaction()) as Transaction;
  tx.feePayer = tx.feePayer ?? wallet.publicKey;

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(
    provider.opts?.preflightCommitment ?? provider.opts?.commitment ?? "processed",
  );
  tx.recentBlockhash = blockhash;

  const signedTx = await wallet.signTransaction(tx);
  const rawTx = signedTx.serialize();
  const sendOptions: SendOptions = {
    skipPreflight: provider.opts?.skipPreflight,
    preflightCommitment:
      provider.opts?.preflightCommitment ?? provider.opts?.commitment,
    maxRetries: provider.opts?.maxRetries,
    minContextSlot: provider.opts?.minContextSlot,
  };

  const signature = await connection.sendRawTransaction(rawTx, sendOptions);
  await connection
    .confirmTransaction(
      {
        signature,
        blockhash,
        lastValidBlockHeight,
      },
      provider.opts?.commitment,
    )
    .catch(() => {});

  return signature;
}

export interface PlayerDelegationAccounts {
  buffer: PublicKey;
  delegationRecord: PublicKey;
  delegationMetadata: PublicKey;
}

function normalizeModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function getDirectionTarget(
  chunkIndex: number,
  row: number,
  col: number,
  direction: number,
): { chunkIndex: number; row: number; col: number } {
  let nextChunkIndex = chunkIndex;
  let nextRow = row;
  let nextCol = col;

  switch (direction) {
    case 0: {
      if (row === 0) {
        nextChunkIndex = chunkIndex - 1;
        nextRow = CHUNK_ROWS - 1;
      } else {
        nextRow = row - 1;
      }
      break;
    }
    case 1: {
      if (row >= CHUNK_ROWS - 1) {
        nextChunkIndex = chunkIndex + 1;
        nextRow = 0;
      } else {
        nextRow = row + 1;
      }
      break;
    }
    case 2: {
      nextCol = Math.max(0, col - 1);
      break;
    }
    case 3: {
      nextCol = Math.min(CHUNK_COLS - 1, col + 1);
      break;
    }
    default:
      break;
  }

  return { chunkIndex: nextChunkIndex, row: nextRow, col: nextCol };
}

function maybeDestinationChunkPda(
  worldPda: PublicKey,
  currentChunkPda: PublicKey,
  currentChunkIndex: number,
  targetChunkIndex: number,
  scrollOffset: number,
) : PublicKey {
  if (targetChunkIndex === currentChunkIndex) {
    return currentChunkPda;
  }

  const physicalIndex = normalizeModulo(
    targetChunkIndex - scrollOffset,
    MAX_CHUNKS,
  );
  return getChunkPda(worldPda, physicalIndex)[0];
}

function getMovementAccountBundle(
  phantomAuthority: PublicKey,
  direction: number,
): {
  worldPda: PublicKey;
  playerPda: PublicKey;
  chunkPda: PublicKey;
  destinationChunk?: PublicKey;
  ghost0: PublicKey;
  ghost1: PublicKey;
  ghost2: PublicKey;
  ghost3: PublicKey;
} {
  const store = useGameStore.getState();
  const player = store.player;
  const world = store.world;
  if (!player || !world) throw new Error("Player or world not loaded");

  const [worldPda] = getWorldPda();
  const [playerPda] = getPlayerPda(worldPda, phantomAuthority);

  const currentPhysicalIndex = normalizeModulo(
    player.chunkIndex - world.scrollOffset,
    MAX_CHUNKS,
  );
  const [chunkPda] = getChunkPda(worldPda, currentPhysicalIndex);

  const target = getDirectionTarget(
    player.chunkIndex,
    player.rowInChunk,
    player.col,
    direction,
  );
  const destinationChunk = maybeDestinationChunkPda(
    worldPda,
    chunkPda,
    player.chunkIndex,
    target.chunkIndex,
    world.scrollOffset,
  );

  const [ghost0] = getGhostPda(worldPda, 0);
  const [ghost1] = getGhostPda(worldPda, 1);
  const [ghost2] = getGhostPda(worldPda, 2);
  const [ghost3] = getGhostPda(worldPda, 3);

  return {
    worldPda,
    playerPda,
    chunkPda,
    destinationChunk,
    ghost0,
    ghost1,
    ghost2,
    ghost3,
  };
}

function getGhostMoveAccountBundle(
  worldPda: PublicKey,
  ghost: { chunkIndex: number; row: number; col: number },
  world: { scrollOffset: number },
  direction: number,
): {
  chunkPda: PublicKey;
  destinationChunk?: PublicKey;
} {
  const currentPhysicalIndex = normalizeModulo(
    ghost.chunkIndex - world.scrollOffset,
    MAX_CHUNKS,
  );
  const [chunkPda] = getChunkPda(worldPda, currentPhysicalIndex);

  const target = getDirectionTarget(
    ghost.chunkIndex,
    ghost.row,
    ghost.col,
    direction,
  );
  const destinationChunk = maybeDestinationChunkPda(
    worldPda,
    chunkPda,
    ghost.chunkIndex,
    target.chunkIndex,
    world.scrollOffset,
  );

  return { chunkPda, destinationChunk };
}

// ─────────────────────────────────────────────────────────────
// L1 Instructions — signed by Phantom wallet
// ─────────────────────────────────────────────────────────────

export async function sendSpawnPlayer(program: Program<any>): Promise<string> {
  const authority = (program.provider as any).wallet.publicKey as PublicKey;
  const [worldPda] = getWorldPda();
  const [playerPda] = getPlayerPda(worldPda, authority);

  return await sendProgramMethod(program, () =>
    (program.methods as any).spawnPlayer().accounts({
      world: worldPda,
      player: playerPda,
      authority,
      systemProgram: SystemProgram.programId,
    }),
  );
}

export async function sendRespawnPlayer(
  program: Program<any>,
): Promise<string> {
  const authority = (program.provider as any).wallet.publicKey as PublicKey;
  const [worldPda] = getWorldPda();
  const [playerPda] = getPlayerPda(worldPda, authority);

  return await sendProgramMethod(program, () =>
    (program.methods as any).respawnPlayer().accounts({
      world: worldPda,
      player: playerPda,
      authority,
    }),
  );
}

/**
 * Register an ephemeral session key on-chain.
 * Pass null to clear (called on disconnect / cash-out).
 * Phantom signs this — called once per game session.
 */
export async function sendSetSessionKey(
  l1Program: Program<any>,
  phantomAuthority: PublicKey,
  sessionKeyPubkey: PublicKey | null,
): Promise<string> {
  const [worldPda] = getWorldPda();
  const [playerPda] = getPlayerPda(worldPda, phantomAuthority);

  return await sendProgramMethod(l1Program, () =>
    (l1Program.methods as any).setSessionKey(sessionKeyPubkey).accounts({
      world: worldPda,
      player: playerPda,
      authority: phantomAuthority,
    }),
  );
}

export async function sendCashOut(program: Program<any>): Promise<string> {
  const authority = (program.provider as any).wallet.publicKey as PublicKey;
  const [worldPda] = getWorldPda();
  const [playerPda] = getPlayerPda(worldPda, authority);
  const [anteroomPda] = getAnteroomPda(worldPda);
  const [vaultPda] = getVaultPda(worldPda);

  return await sendProgramMethod(program, () =>
    (program.methods as any).cashOut().accounts({
      player: playerPda,
      anteroom: anteroomPda,
      world: worldPda,
      vault: vaultPda,
      payout: authority,
      authority,
      systemProgram: SystemProgram.programId,
    }),
  );
}

/**
 * Delegate the player's PDA for ER gameplay.
 * The Phantom wallet must sign this.
 */
export async function sendDelegatePlayer(
  l1Program: Program<any>,
  phantomAuthority: PublicKey,
  delegation: PlayerDelegationAccounts,
): Promise<string> {
  const [worldPda] = getWorldPda();
  const [playerPda] = getPlayerPda(worldPda, phantomAuthority);

  return await sendProgramMethod(l1Program, () =>
    (l1Program.methods as any).delegatePlayer().accounts({
      world: worldPda,
      player: playerPda,
      authority: phantomAuthority,
      buffer: delegation.buffer,
      delegationRecord: delegation.delegationRecord,
      delegationMetadata: delegation.delegationMetadata,
      delegationProgram: DELEGATION_PROGRAM_ID,
      program: l1Program.programId,
      systemProgram: SystemProgram.programId,
    }),
  );
}

// ─────────────────────────────────────────────────────────────
// ER Instructions — signed by session key (no Phantom popup)
// ─────────────────────────────────────────────────────────────

/**
 * Send movement via ER. `erProgram` is signed by session Keypair.
 * `phantomAuthority` is the Phantom pubkey — passed as player_authority for PDA derivation.
 * Includes `destinationChunk` when crossing chunk boundaries.
 */
export async function sendMovementEr(
  erProgram: Program<any>,
  direction: number,
  phantomAuthority: PublicKey,
): Promise<string> {
  const sessionSigner = (erProgram.provider as any).wallet
    .publicKey as PublicKey;
  const {
    worldPda,
    playerPda,
    chunkPda,
    destinationChunk,
    ghost0,
    ghost1,
    ghost2,
    ghost3,
  } = getMovementAccountBundle(phantomAuthority, direction);

  return await sendWithRetry(() =>
    sendProgramMethod(erProgram, () =>
      (erProgram.methods as any).movement(direction).accounts({
        world: worldPda,
        player: playerPda,
        chunk: chunkPda,
        destinationChunk,
        authority: sessionSigner,
        playerAuthority: phantomAuthority,
        ghost0,
        ghost1,
        ghost2,
        ghost3,
      }),
    ),
  );
}

/**
 * Send eat_pellet via ER.
 * Kept for compatibility, though movement now auto-eats.
 */
export async function sendEatPelletEr(
  erProgram: Program<any>,
  phantomAuthority: PublicKey,
): Promise<string> {
  const sessionSigner = (erProgram.provider as any).wallet
    .publicKey as PublicKey;
  const store = useGameStore.getState();
  const player = store.player;
  const world = store.world;
  if (!player || !world) throw new Error("Player or world not loaded");

  const [worldPda] = getWorldPda();
  const [playerPda] = getPlayerPda(worldPda, phantomAuthority);

  const physicalIndex = normalizeModulo(
    player.chunkIndex - world.scrollOffset,
    MAX_CHUNKS,
  );
  const [chunkPda] = getChunkPda(worldPda, physicalIndex);

  return await sendWithRetry(() =>
    sendProgramMethod(erProgram, () =>
      (erProgram.methods as any).eatPellet().accounts({
        world: worldPda,
        player: playerPda,
        chunk: chunkPda,
        authority: sessionSigner,
        playerAuthority: phantomAuthority,
      }),
    ),
  );
}

/**
 * Send eat_ghost via ER.
 */
export async function sendEatGhostEr(
  erProgram: Program<any>,
  ghostId: number,
  phantomAuthority: PublicKey,
): Promise<string> {
  const sessionSigner = (erProgram.provider as any).wallet
    .publicKey as PublicKey;
  const [worldPda] = getWorldPda();
  const [playerPda] = getPlayerPda(worldPda, phantomAuthority);
  const [ghostPda] = getGhostPda(worldPda, ghostId);

  return await sendWithRetry(() =>
    sendProgramMethod(erProgram, () =>
      (erProgram.methods as any).eatGhost(ghostId).accounts({
        world: worldPda,
        player: playerPda,
        ghost: ghostPda,
        authority: sessionSigner,
        playerAuthority: phantomAuthority,
      }),
    ),
  );
}

/**
 * Send eat_player via ER.
 */
export async function sendEatPlayerEr(
  erProgram: Program<any>,
  victimAuthority: PublicKey,
  phantomAuthority: PublicKey,
): Promise<string> {
  const sessionSigner = (erProgram.provider as any).wallet
    .publicKey as PublicKey;
  const [worldPda] = getWorldPda();
  const [eaterPda] = getPlayerPda(worldPda, phantomAuthority);
  const [victimPda] = getPlayerPda(worldPda, victimAuthority);

  return await sendWithRetry(() =>
    sendProgramMethod(erProgram, () =>
      (erProgram.methods as any).eatPlayer().accounts({
        eater: eaterPda,
        victim: victimPda,
        world: worldPda,
        authority: sessionSigner,
        playerAuthority: phantomAuthority,
        victimAuthority,
      }),
    ),
  );
}

/**
 * Move a ghost from the operator/world-authority signer.
 * Includes destination chunk automatically when the ghost crosses chunk boundaries.
 */
export async function sendMoveGhost(
  program: Program<any>,
  ghostId: number,
  direction: number,
): Promise<string> {
  const authority = (program.provider as any).wallet.publicKey as PublicKey;
  const store = useGameStore.getState();
  const world = store.world;
  const ghost = store.ghosts.find((g) => g.ghostId === ghostId);

  if (!world || !ghost) {
    throw new Error("World or ghost not loaded");
  }

  const [worldPda] = getWorldPda();
  const [ghostPda] = getGhostPda(worldPda, ghostId);
  const { chunkPda, destinationChunk } = getGhostMoveAccountBundle(
    worldPda,
    ghost,
    world,
    direction,
  );

  return await sendProgramMethod(program, () =>
    (program.methods as any).moveGhost(ghostId, direction).accounts({
      world: worldPda,
      ghost: ghostPda,
      chunk: chunkPda,
      destinationChunk,
      authority,
    }),
  );
}

// ─────────────────────────────────────────────────────────────
// Legacy L1 movement — kept for fallback / non-ER testing
// Sessions not set up yet or operator delegation pending.
// ─────────────────────────────────────────────────────────────

export async function sendMovement(
  program: Program<any>,
  direction: number,
): Promise<string> {
  const authority = (program.provider as any).wallet.publicKey as PublicKey;
  const {
    worldPda,
    playerPda,
    chunkPda,
    destinationChunk,
    ghost0,
    ghost1,
    ghost2,
    ghost3,
  } = getMovementAccountBundle(authority, direction);

  return await sendProgramMethod(program, () =>
    (program.methods as any).movement(direction).accounts({
      world: worldPda,
      player: playerPda,
      chunk: chunkPda,
      destinationChunk,
      authority,
      playerAuthority: authority,
      ghost0,
      ghost1,
      ghost2,
      ghost3,
    }),
  );
}
