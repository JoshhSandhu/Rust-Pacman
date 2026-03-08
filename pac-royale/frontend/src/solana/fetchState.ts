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

  const chunkPdas: PublicKey[] = [];
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const [chunkPda] = getChunkPda(worldPda, i);
    chunkPdas.push(chunkPda);
  }

  try {
    const chunkAccounts = await (program.account as any).chunk.fetchMultiple(chunkPdas);
    chunkAccounts.forEach((acc: any, index: number) => {
      if (!acc) return;
      store.setChunk(index, parseChunk(acc));
    });
  } catch {
    // Partial chunk availability is expected during initialization
  }
}

export async function fetchGhosts(program: Program): Promise<void> {
  const store = useGameStore.getState();
  const [worldPda] = getWorldPda();

  const ghostPdas: PublicKey[] = [];
  for (let i = 0; i < NUM_GHOSTS; i++) {
    const [ghostPda] = getGhostPda(worldPda, i);
    ghostPdas.push(ghostPda);
  }

  try {
    const ghostAccounts = await (program.account as any).ghost.fetchMultiple(ghostPdas);
    const ghosts = ghostAccounts.filter(Boolean).map((acc: any) => parseGhost(acc));
    store.setGhosts(ghosts);
  } catch {
    store.setGhosts([]);
  }
}

export async function fetchOtherPlayers(program: Program, authority: PublicKey): Promise<void> {
  const store = useGameStore.getState();
  const next = new Map<string, PlayerState>();

  try {
    const entries = await (program.account as any).player.all();
    for (const entry of entries) {
      const account = parsePlayer(entry.account);
      if (!account.authority) continue;
      if (account.authority.equals(authority)) continue;
      next.set(account.authority.toBase58(), account);
    }
  } catch {
    // ignore transient RPC errors
  }

  store.setOtherPlayers(next);
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
  fetchOtherPlayers(program, authority);
  fetchCurrentSlot(connection);

  let tick = 0;
  pollInterval = setInterval(async () => {
    tick += 1;
    const tasks: Promise<void>[] = [
      fetchPlayerState(program, authority),
      fetchGhosts(program),
      fetchCurrentSlot(connection),
    ];
    if (tick % 2 === 0) {
      tasks.push(fetchWorldState(program));
      tasks.push(fetchOtherPlayers(program, authority));
    }
    await Promise.all([
      ...tasks,
    ]);
  }, 1000);

  // Separate slower chunk poll
  chunkPollInterval = setInterval(() => {
    fetchVisibleChunks(program);
  }, 3000);
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
