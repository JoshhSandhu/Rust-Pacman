import { Connection, PublicKey } from '@solana/web3.js';
import { Program } from '@coral-xyz/anchor';
import { useGameStore, ChunkState, GhostState, PlayerState, WorldState, MAX_CHUNKS, NUM_GHOSTS } from '../state/gameStore';
import { getWorldPda, getChunkPda, getGhostPda, getPlayerPda } from './pda';

function parseWorld(acc: any): WorldState {
  return {
    authority: acc.authority,
    chunkCount: acc.chunkCount,
    scrollOffset: acc.scrollOffset,
    nextScrollSlot: Number(acc.nextScrollSlot),
    totalPlayers: acc.totalPlayers,
    frozen: acc.frozen,
  };
}

function parsePlayer(acc: any): PlayerState {
  return {
    authority: acc.authority ?? null,
    world: acc.world,
    payoutWallet: acc.payoutWallet,
    chunkIndex: acc.chunkIndex,
    rowInChunk: acc.rowInChunk,
    col: acc.col,
    direction: acc.direction,
    balanceLamports: Number(acc.balanceLamports),
    powerPelletUntilSlot: Number(acc.powerPelletUntilSlot),
    lastMoveSlot: Number(acc.lastMoveSlot),
    dead: acc.dead,
    bump: acc.bump,
  };
}

function parseChunk(acc: any): ChunkState {
  return {
    world: acc.world,
    physicalIndex: acc.physicalIndex,
    logicalIndex: acc.logicalIndex,
    templateId: acc.templateId,
    grid: acc.grid.map((row: number[]) => [...row]),
  };
}

function parseGhost(acc: any): GhostState {
  return {
    world: acc.world,
    ghostId: acc.ghostId,
    chunkIndex: acc.chunkIndex,
    row: acc.row,
    col: acc.col,
    state: acc.state,
    direction: acc.direction,
  };
}

let pollInterval: ReturnType<typeof setInterval> | null = null;
let chunkPollInterval: ReturnType<typeof setInterval> | null = null;

export async function fetchWorldState(program: Program): Promise<void> {
  const store = useGameStore.getState();
  try {
    const [worldPda] = getWorldPda();
    const worldAcc = await (program.account as any).world.fetch(worldPda);
    store.setWorld(parseWorld(worldAcc));
    store.setWorldPda(worldPda);
  } catch (err) {
    console.warn('Failed to fetch world:', err);
  }
}

export async function fetchPlayerState(program: Program, authority: PublicKey): Promise<void> {
  const store = useGameStore.getState();
  const [worldPda] = getWorldPda();
  const [playerPda] = getPlayerPda(worldPda, authority);
  store.setPlayerPda(playerPda);

  try {
    const playerAcc = await (program.account as any).player.fetch(playerPda);
    store.setPlayer(parsePlayer(playerAcc));
  } catch {
    // Player doesn't exist yet
    store.setPlayer(null);
  }
}

export async function fetchVisibleChunks(program: Program): Promise<void> {
  const store = useGameStore.getState();
  const world = store.world;
  if (!world) return;

  const [worldPda] = getWorldPda();
  const scrollOffset = world.scrollOffset;

  // Fetch all 32 physical chunks — they map to logical indices via ring buffer
  const promises: Promise<void>[] = [];
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const [chunkPda] = getChunkPda(worldPda, i);
    promises.push(
      (program.account as any).chunk
        .fetch(chunkPda)
        .then((acc: any) => {
          store.setChunk(i, parseChunk(acc));
        })
        .catch(() => {}),
    );
  }
  await Promise.all(promises);
}

export async function fetchGhosts(program: Program): Promise<void> {
  const store = useGameStore.getState();
  const [worldPda] = getWorldPda();

  const ghosts: GhostState[] = [];
  for (let i = 0; i < NUM_GHOSTS; i++) {
    try {
      const [ghostPda] = getGhostPda(worldPda, i);
      const acc = await (program.account as any).ghost.fetch(ghostPda);
      ghosts.push(parseGhost(acc));
    } catch {
      // Ghost not initialized
    }
  }
  store.setGhosts(ghosts);
}

export async function fetchCurrentSlot(connection: Connection): Promise<void> {
  const store = useGameStore.getState();
  try {
    const slot = await connection.getSlot('confirmed');
    store.setCurrentSlot(slot);
  } catch {}
}

export function startPolling(program: Program, connection: Connection, authority: PublicKey) {
  stopPolling();

  // Initial fetch
  fetchWorldState(program);
  fetchPlayerState(program, authority);
  fetchVisibleChunks(program);
  fetchGhosts(program);
  fetchCurrentSlot(connection);

  pollInterval = setInterval(async () => {
    await Promise.all([
      fetchWorldState(program),
      fetchPlayerState(program, authority),
      fetchGhosts(program),
      fetchCurrentSlot(connection),
    ]);
  }, 250);

  // Separate slower chunk poll
  chunkPollInterval = setInterval(() => {
    fetchVisibleChunks(program);
  }, 1000);
}

export function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  if (chunkPollInterval) {
    clearInterval(chunkPollInterval);
    chunkPollInterval = null;
  }
}
