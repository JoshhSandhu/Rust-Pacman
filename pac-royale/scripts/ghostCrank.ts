import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SendOptions, Transaction } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const idl = require("../target/idl/pac_royale.json");

const PROGRAM_ID = new PublicKey("46gDjnJLeuMqKLJjHow4B4xt6BLspzf7owBydzSvSByH");
const DEVNET_RPC = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
const ER_RPC_ENDPOINT = process.env.ER_RPC_URL || "https://devnet-as.magicblock.app/";
const ER_WSS_ENDPOINT = process.env.ER_WSS_URL || "wss://devnet-as.magicblock.app/";
const KEYPAIR_PATH = process.env.ANCHOR_WALLET || path.join(os.homedir(), ".config/solana/id.json");

const MAX_CHUNKS = 32;
const CHUNK_ROWS = 6;
const CHUNK_COLS = 10;
const NUM_GHOSTS = 4;
const CELL_WALL = 1;
const DIR_UP = 0;
const DIR_DOWN = 1;
const DIR_LEFT = 2;
const DIR_RIGHT = 3;
const PLAYER_ACCOUNT_SIZE = 171;
const PLAYER_WORLD_FILTER_OFFSET = 8 + 33;
const LOOP_INTERVAL_MS = Number(process.env.GHOST_TICK_MS || 800);

type WorldState = {
  scrollOffset: number;
};

type ChunkState = {
  logicalIndex: number;
  grid: number[][];
  pda: PublicKey;
};

type GhostState = {
  ghostId: number;
  chunkIndex: number;
  row: number;
  col: number;
  direction: number;
  pda: PublicKey;
};

type PlayerState = {
  authority: PublicKey | null;
  chunkIndex: number;
  rowInChunk: number;
  col: number;
  dead: boolean;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function getWorldPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("world")], PROGRAM_ID);
}

function getChunkPda(worldPda: PublicKey, physicalIndex: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("chunk"), worldPda.toBuffer(), Buffer.from([physicalIndex])],
    PROGRAM_ID,
  );
}

function getGhostPda(worldPda: PublicKey, ghostId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("ghost"), worldPda.toBuffer(), Buffer.from([ghostId])],
    PROGRAM_ID,
  );
}

function normalizeModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function grab(acc: any, camel: string, snake: string): any {
  return acc?.[camel] !== undefined ? acc[camel] : acc?.[snake];
}

function parseChunk(acc: any, pda: PublicKey): ChunkState {
  const rawGrid: number[][] = grab(acc, "grid", "grid");
  return {
    logicalIndex: grab(acc, "logicalIndex", "logical_index"),
    grid: rawGrid.map((row: number[]) => [...row]),
    pda,
  };
}

function parseGhost(acc: any, pda: PublicKey): GhostState {
  return {
    ghostId: grab(acc, "ghostId", "ghost_id"),
    chunkIndex: grab(acc, "chunkIndex", "chunk_index"),
    row: acc.row,
    col: acc.col,
    direction: acc.direction,
    pda,
  };
}

function parsePlayer(acc: any): PlayerState {
  return {
    authority: grab(acc, "authority", "authority") ?? null,
    chunkIndex: grab(acc, "chunkIndex", "chunk_index"),
    rowInChunk: grab(acc, "rowInChunk", "row_in_chunk"),
    col: acc.col,
    dead: acc.dead,
  };
}

function tryDecodePlayer(program: Program<any>, data: Buffer): PlayerState | null {
  if (data.length !== PLAYER_ACCOUNT_SIZE) return null;

  try {
    const decoded = program.coder.accounts.decode("player", data);
    return parsePlayer(decoded);
  } catch {
    return null;
  }
}

async function sendProgramMethod(
  program: Program<any>,
  buildMethod: () => any,
): Promise<string> {
  const provider = program.provider as anchor.AnchorProvider;
  const tx = (await buildMethod().transaction()) as Transaction;
  tx.feePayer = tx.feePayer ?? provider.wallet.publicKey;

  const { blockhash, lastValidBlockHeight } = await provider.connection.getLatestBlockhash(
    provider.opts.preflightCommitment ?? provider.opts.commitment,
  );
  tx.recentBlockhash = blockhash;

  const signedTx = await provider.wallet.signTransaction(tx);
  const rawTx = signedTx.serialize();
  const sendOptions: SendOptions = {
    skipPreflight: provider.opts.skipPreflight,
    preflightCommitment:
      provider.opts.preflightCommitment ?? provider.opts.commitment,
    maxRetries: provider.opts.maxRetries,
    minContextSlot: provider.opts.minContextSlot,
  };

  const signature = await provider.connection.sendRawTransaction(rawTx, sendOptions);
  await provider.connection.confirmTransaction(
    {
      signature,
      blockhash,
      lastValidBlockHeight,
    },
    provider.opts.commitment,
  );
  return signature;
}

function getDirectionDelta(direction: number): { row: number; col: number } {
  switch (direction) {
    case DIR_UP:
      return { row: -1, col: 0 };
    case DIR_DOWN:
      return { row: 1, col: 0 };
    case DIR_LEFT:
      return { row: 0, col: -1 };
    case DIR_RIGHT:
      return { row: 0, col: 1 };
    default:
      return { row: 0, col: 0 };
  }
}

function getCandidateDirections(currentDirection: number): number[] {
  const all = [DIR_UP, DIR_DOWN, DIR_LEFT, DIR_RIGHT];
  const withoutCurrent = all.filter((direction) => direction !== currentDirection);
  return [currentDirection, ...withoutCurrent.sort(() => Math.random() - 0.5)];
}

function getTargetPosition(ghost: GhostState, direction: number, world: WorldState) {
  let nextChunkIndex = ghost.chunkIndex;
  let nextRow = ghost.row;
  let nextCol = ghost.col;

  switch (direction) {
    case DIR_UP:
      if (ghost.row === 0) {
        if (ghost.chunkIndex === world.scrollOffset) return null;
        nextChunkIndex -= 1;
        nextRow = CHUNK_ROWS - 1;
      } else {
        nextRow -= 1;
      }
      break;
    case DIR_DOWN:
      if (ghost.row >= CHUNK_ROWS - 1) {
        nextChunkIndex += 1;
        nextRow = 0;
      } else {
        nextRow += 1;
      }
      break;
    case DIR_LEFT:
      if (ghost.col === 0) return null;
      nextCol -= 1;
      break;
    case DIR_RIGHT:
      if (ghost.col >= CHUNK_COLS - 1) return null;
      nextCol += 1;
      break;
    default:
      return null;
  }

  const topBoundary = world.scrollOffset + MAX_CHUNKS;
  if (nextChunkIndex < world.scrollOffset || nextChunkIndex >= topBoundary) {
    return null;
  }

  return { chunkIndex: nextChunkIndex, row: nextRow, col: nextCol };
}

function buildChunkMaps(chunks: ChunkState[]) {
  const byLogical = new Map<number, ChunkState>();
  for (const chunk of chunks) {
    byLogical.set(chunk.logicalIndex, chunk);
  }
  return byLogical;
}

function chooseDirection(
  ghost: GhostState,
  world: WorldState,
  chunkByLogical: Map<number, ChunkState>,
  players: PlayerState[],
  ghosts: GhostState[],
): { direction: number; destinationChunk: PublicKey } | null {
  let bestChoice: { direction: number; destinationChunk: PublicKey; score: number } | null = null;

  for (const direction of getCandidateDirections(ghost.direction)) {
    const target = getTargetPosition(ghost, direction, world);
    if (!target) continue;

    const destinationChunk = chunkByLogical.get(target.chunkIndex);
    if (!destinationChunk) continue;
    if (destinationChunk.grid[target.row]?.[target.col] === CELL_WALL) continue;

    const nearestPlayerDistance =
      players.length === 0
        ? 0
        : players.reduce((best, player) => {
            const distance =
              Math.abs(player.chunkIndex - target.chunkIndex) * CHUNK_ROWS +
              Math.abs(player.rowInChunk - target.row) +
              Math.abs(player.col - target.col);
            return Math.min(best, distance);
          }, Number.POSITIVE_INFINITY);

    let ghostSeparationPenalty = 0;
    let occupiedByGhost = false;
    for (const otherGhost of ghosts) {
      if (otherGhost.ghostId === ghost.ghostId) continue;
      const distance =
        Math.abs(otherGhost.chunkIndex - target.chunkIndex) * CHUNK_ROWS +
        Math.abs(otherGhost.row - target.row) +
        Math.abs(otherGhost.col - target.col);

      if (distance === 0) {
        occupiedByGhost = true;
        break;
      }
      if (distance === 1) {
        ghostSeparationPenalty += 25;
      } else if (distance === 2) {
        ghostSeparationPenalty += 8;
      }
    }

    if (occupiedByGhost) continue;

    const directionBias = direction === ghost.direction ? -0.25 : 0;
    const randomness = Math.random() * (players.length === 0 ? 4 : 0.5);
    const score =
      nearestPlayerDistance +
      ghostSeparationPenalty +
      directionBias +
      randomness;

    if (!bestChoice || score < bestChoice.score) {
      bestChoice = {
        direction,
        destinationChunk: destinationChunk.pda,
        score,
      };
    }
  }

  if (!bestChoice) return null;

  return {
    direction: bestChoice.direction,
    destinationChunk: bestChoice.destinationChunk,
  };
}

async function fetchPlayers(
  erProgram: Program<any>,
  worldPda: PublicKey,
): Promise<PlayerState[]> {
  const connection = erProgram.provider.connection as Connection;
  const entries = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [
      { dataSize: PLAYER_ACCOUNT_SIZE },
      {
        memcmp: {
          offset: PLAYER_WORLD_FILTER_OFFSET,
          bytes: worldPda.toBase58(),
        },
      },
    ],
  });

  return entries
    .map((entry) => tryDecodePlayer(erProgram, entry.account.data))
    .filter((player): player is PlayerState => !!player && !player.dead);
}

async function moveGhosts(): Promise<void> {
  const keypairFile = fs.readFileSync(KEYPAIR_PATH, "utf-8");
  const operator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(keypairFile)));

  const l1Connection = new Connection(DEVNET_RPC, "confirmed");
  const erConnection = new Connection(ER_RPC_ENDPOINT, {
    commitment: "processed",
    wsEndpoint: ER_WSS_ENDPOINT,
  });

  const wallet = new anchor.Wallet(operator);
  const l1Provider = new anchor.AnchorProvider(l1Connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const erProvider = new anchor.AnchorProvider(erConnection, wallet, {
    commitment: "processed",
    skipPreflight: true,
  });

  const l1Program = new Program(idl, l1Provider);
  const erProgram = new Program(idl, erProvider);
  const [worldPda] = getWorldPda();

  console.log("[ghost-crank] operator:", operator.publicKey.toBase58());
  console.log("[ghost-crank] L1:", DEVNET_RPC);
  console.log("[ghost-crank] ER:", ER_RPC_ENDPOINT);

  for (;;) {
    try {
      const worldAcc = await (l1Program.account as any).world.fetch(worldPda);
      const world: WorldState = {
        scrollOffset: grab(worldAcc, "scrollOffset", "scroll_offset"),
      };

      const chunkPdas: PublicKey[] = [];
      for (let i = 0; i < MAX_CHUNKS; i++) {
        chunkPdas.push(getChunkPda(worldPda, i)[0]);
      }
      const chunkAccounts = await (erProgram.account as any).chunk.fetchMultiple(chunkPdas);
      const chunks = chunkAccounts
        .map((acc: any, index: number) => (acc ? parseChunk(acc, chunkPdas[index]) : null))
        .filter((chunk: ChunkState | null): chunk is ChunkState => !!chunk);
      const chunkByLogical = buildChunkMaps(chunks);

      const ghostPdas: PublicKey[] = [];
      for (let i = 0; i < NUM_GHOSTS; i++) {
        ghostPdas.push(getGhostPda(worldPda, i)[0]);
      }
      const ghostAccounts = await (erProgram.account as any).ghost.fetchMultiple(ghostPdas);
      const ghosts = ghostAccounts
        .map((acc: any, index: number) => (acc ? parseGhost(acc, ghostPdas[index]) : null))
        .filter((ghost: GhostState | null): ghost is GhostState => !!ghost);

      const players = await fetchPlayers(erProgram, worldPda);

      for (const ghost of ghosts) {
        const choice = chooseDirection(ghost, world, chunkByLogical, players, ghosts);
        if (!choice) continue;

        const currentPhysicalIndex = normalizeModulo(
          ghost.chunkIndex - world.scrollOffset,
          MAX_CHUNKS,
        );
        const chunkPda = getChunkPda(worldPda, currentPhysicalIndex)[0];

        try {
          await sendProgramMethod(erProgram, () =>
            (erProgram.methods as any).moveGhost(ghost.ghostId, choice.direction).accounts({
              world: worldPda,
              ghost: ghost.pda,
              chunk: chunkPda,
              destinationChunk: choice.destinationChunk,
              authority: operator.publicKey,
            }),
          );
        } catch (err) {
          const text = String(err);
          if (
            !text.includes("WrongChunk") &&
            !text.includes("ChunkLogicalMismatch") &&
            !text.includes("MissingDestinationChunk")
          ) {
            console.warn(`[ghost-crank] ghost ${ghost.ghostId} move failed:`, err);
          }
        }
      }
    } catch (err) {
      console.error("[ghost-crank] tick failed:", err);
    }

    await sleep(LOOP_INTERVAL_MS);
  }
}

moveGhosts().catch((err) => {
  console.error("[ghost-crank] fatal:", err);
  process.exit(1);
});
