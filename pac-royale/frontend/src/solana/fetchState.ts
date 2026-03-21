import { Connection, PublicKey } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import {
  useGameStore,
  ChunkState,
  GhostState,
  PlayerState,
  WorldState,
  MAX_CHUNKS,
  NUM_GHOSTS,
  CHUNK_COLS,
  CHUNK_ROWS,
} from "../state/gameStore";
import { getWorldPda, getChunkPda, getGhostPda, getPlayerPda } from "./pda";
import { getSharedErConnection } from "./erClient";

// Anchor camel-cases account fields, but we defensively support both forms.
function grab(acc: any, camel: string, snake: string): any {
  return acc?.[camel] !== undefined ? acc[camel] : acc?.[snake];
}

function parseWorld(acc: any): WorldState {
  return {
    authority: grab(acc, "authority", "authority"),
    chunkCount: grab(acc, "chunkCount", "chunk_count"),
    scrollOffset: grab(acc, "scrollOffset", "scroll_offset"),
    nextScrollSlot: Number(grab(acc, "nextScrollSlot", "next_scroll_slot")),
    totalPlayers: grab(acc, "totalPlayers", "total_players"),
    frozen: acc.frozen,
  };
}

function parsePlayer(acc: any): PlayerState {
  return {
    authority: grab(acc, "authority", "authority") ?? null,
    world: acc.world,
    payoutWallet: grab(acc, "payoutWallet", "payout_wallet"),
    chunkIndex: grab(acc, "chunkIndex", "chunk_index"),
    rowInChunk: grab(acc, "rowInChunk", "row_in_chunk"),
    col: acc.col,
    direction: acc.direction,
    balanceLamports: Number(grab(acc, "balanceLamports", "balance_lamports")),
    powerPelletUntilSlot: Number(
      grab(acc, "powerPelletUntilSlot", "power_pellet_until_slot"),
    ),
    lastMoveSlot: Number(grab(acc, "lastMoveSlot", "last_move_slot")),
    dead: acc.dead,
    bump: acc.bump,
  };
}

function parseChunk(acc: any): ChunkState {
  const rawGrid: number[][] = grab(acc, "grid", "grid");

  let grid: number[][];
  if (rawGrid.length === CHUNK_ROWS && rawGrid[0]?.length === CHUNK_COLS) {
    grid = rawGrid.map((row: number[]) => [...row]);
  } else if (
    rawGrid.length === CHUNK_COLS &&
    rawGrid[0]?.length === CHUNK_ROWS
  ) {
    grid = Array.from({ length: CHUNK_ROWS }, (_, r) =>
      Array.from({ length: CHUNK_COLS }, (_, c) => rawGrid[c][r]),
    );
  } else {
    console.warn(
      "[fetchState] Unexpected grid shape:",
      rawGrid.length,
      rawGrid[0]?.length,
    );
    grid = Array.from({ length: CHUNK_ROWS }, () =>
      new Array(CHUNK_COLS).fill(0),
    );
  }

  return {
    world: acc.world,
    physicalIndex: grab(acc, "physicalIndex", "physical_index"),
    logicalIndex: grab(acc, "logicalIndex", "logical_index"),
    templateId: grab(acc, "templateId", "template_id"),
    grid,
  };
}

function parseGhost(acc: any): GhostState {
  return {
    world: acc.world,
    ghostId: grab(acc, "ghostId", "ghost_id"),
    chunkIndex: grab(acc, "chunkIndex", "chunk_index"),
    row: acc.row,
    col: acc.col,
    state: acc.state,
    direction: acc.direction,
  };
}

let pollInterval: ReturnType<typeof setInterval> | null = null;
let chunkPollInterval: ReturnType<typeof setInterval> | null = null;
let entityPollInterval: ReturnType<typeof setInterval> | null = null;
let pollInFlight = false;
let chunkPollInFlight = false;
let entityPollInFlight = false;

let playerSubscriptionId: number | null = null;
let worldSubscriptionId: number | null = null;
let ghostSubscriptionIds: number[] = [];
let activeSubscriptionConnection: Connection | null = null;

let knownPlayerAuthorities = new Set<string>();
let lastDiscoveredTotalPlayers = 0;
let lastObservedChunkIndex: number | null = null;

const PLAYER_WORLD_FILTER_OFFSET = 8 + 33;
const PLAYER_ACCOUNT_SIZE = 171;
const OTHER_PLAYER_ACTIVE_SLOT_WINDOW = 150;

function tryDecodePlayer(program: Program<any>, data: Buffer): PlayerState | null {
  if (data.length !== PLAYER_ACCOUNT_SIZE) {
    return null;
  }

  try {
    const decoded = program.coder.accounts.decode("player", data);
    return parsePlayer(decoded);
  } catch {
    return null;
  }
}

function resetPlayerDiscoveryState(currentAuthority?: PublicKey) {
  knownPlayerAuthorities.clear();
  if (currentAuthority) {
    knownPlayerAuthorities.add(currentAuthority.toBase58());
  }
  lastDiscoveredTotalPlayers = 0;
}

async function discoverOtherPlayers(
  program: Program<any>,
  authority: PublicKey,
): Promise<void> {
  const store = useGameStore.getState();
  const world = store.world;

  if (!world) return;

  const [worldPda] = getWorldPda();
  const knownPlayerCount = knownPlayerAuthorities.size;
  const shouldDiscover =
    world.totalPlayers > lastDiscoveredTotalPlayers ||
    knownPlayerCount < world.totalPlayers;

  if (!shouldDiscover) {
    knownPlayerAuthorities.delete(authority.toBase58());
    return;
  }

  try {
    const connection = program.provider.connection as Connection;
    const entries = await connection.getProgramAccounts(program.programId, {
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

    for (const entry of entries) {
      const account = tryDecodePlayer(program, entry.account.data);
      if (!account) continue;
      if (!account.authority) continue;
      knownPlayerAuthorities.add(account.authority.toBase58());
    }
    lastDiscoveredTotalPlayers = world.totalPlayers;
  } catch (err) {
    console.warn("[fetchState] Player discovery failed:", err);
  }

  // Keep your own authority out of the targeted refresh set.
  knownPlayerAuthorities.delete(authority.toBase58());
}

export async function fetchWorldState(program: Program<any>): Promise<void> {
  const store = useGameStore.getState();
  try {
    const [worldPda] = getWorldPda();
    const worldAcc = await (program.account as any).world.fetch(worldPda);
    const parsed = parseWorld(worldAcc);
    store.setWorld(parsed);
    store.setWorldPda(worldPda);
  } catch (err) {
    console.warn("[fetchState] Failed to fetch world:", err);
  }
}

export async function fetchPlayerState(
  program: Program<any>,
  authority: PublicKey,
): Promise<void> {
  const store = useGameStore.getState();
  const [worldPda] = getWorldPda();
  const [playerPda] = getPlayerPda(worldPda, authority);
  store.setPlayerPda(playerPda);

  try {
    const playerAcc = await (program.account as any).player.fetch(playerPda);
    const parsed = parsePlayer(playerAcc);
    const previousChunkIndex = lastObservedChunkIndex;
    lastObservedChunkIndex = parsed.chunkIndex;
    store.setPlayer(parsed);

    if (
      previousChunkIndex !== null &&
      previousChunkIndex !== parsed.chunkIndex
    ) {
      await fetchVisibleChunks(program);
    }
  } catch (err) {
    if (err instanceof RangeError) {
      console.warn("[fetchState] Skipping incompatible player account layout");
    }
    lastObservedChunkIndex = null;
    store.setPlayer(null);
  }
}

export async function fetchVisibleChunks(program: Program<any>): Promise<void> {
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
    const chunkAccounts = await (program.account as any).chunk.fetchMultiple(
      chunkPdas,
    );
    chunkAccounts.forEach((acc: any, index: number) => {
      if (!acc) return;
      store.setChunk(index, parseChunk(acc));
    });
  } catch (err) {
    console.warn("[fetchState] Chunk fetch error:", err);
  }
}

export async function fetchGhosts(program: Program<any>): Promise<void> {
  const store = useGameStore.getState();
  const [worldPda] = getWorldPda();

  const ghostPdas: PublicKey[] = [];
  for (let i = 0; i < NUM_GHOSTS; i++) {
    const [ghostPda] = getGhostPda(worldPda, i);
    ghostPdas.push(ghostPda);
  }

  try {
    const ghostAccounts = await (program.account as any).ghost.fetchMultiple(
      ghostPdas,
    );
    const ghosts = ghostAccounts
      .filter(Boolean)
      .map((acc: any) => parseGhost(acc));
    store.setGhosts(ghosts);
  } catch {
    store.setGhosts([]);
  }
}

export async function fetchOtherPlayers(
  program: Program<any>,
  authority: PublicKey,
): Promise<void> {
  const store = useGameStore.getState();
  const [worldPda] = getWorldPda();
  const { currentSlot, demoMode } = store;

  await discoverOtherPlayers(program, authority);

  const authorities = Array.from(knownPlayerAuthorities).filter(
    (key) => key !== authority.toBase58(),
  );

  if (authorities.length === 0) {
    store.setOtherPlayers(new Map());
    return;
  }

  const playerPdas = authorities.map(
    (key) => getPlayerPda(worldPda, new PublicKey(key))[0],
  );

  const next = new Map<string, PlayerState>();

  try {
    const accounts = await (program.account as any).player.fetchMultiple(
      playerPdas,
    );
    accounts.forEach((acc: any, index: number) => {
      const authorityKey = authorities[index];
      if (!acc) {
        knownPlayerAuthorities.delete(authorityKey);
        return;
      }
      const account = parsePlayer(acc);
      if (!account.authority) {
        knownPlayerAuthorities.delete(authorityKey);
        return;
      }
      if (account.authority.equals(authority)) return;
      if (!demoMode) {
        if (account.dead) return;
        if (
          currentSlot > 0 &&
          currentSlot - account.lastMoveSlot > OTHER_PLAYER_ACTIVE_SLOT_WINDOW
        ) {
          return;
        }
      }
      next.set(account.authority.toBase58(), account);
    });
  } catch (err) {
    console.warn("[fetchState] Other-player refresh failed:", err);
  }

  store.setOtherPlayers(next);
}

export async function fetchCurrentSlot(connection: Connection): Promise<void> {
  const store = useGameStore.getState();
  try {
    const slot = await connection.getSlot("confirmed");
    store.setCurrentSlot(slot);
  } catch {}
}

function clearSubscriptions(connection?: Connection | null) {
  const conn = connection ?? activeSubscriptionConnection ?? getSharedErConnection();

  if (playerSubscriptionId !== null) {
    void conn.removeAccountChangeListener(playerSubscriptionId).catch(() => {});
    playerSubscriptionId = null;
  }
  if (worldSubscriptionId !== null) {
    void conn.removeAccountChangeListener(worldSubscriptionId).catch(() => {});
    worldSubscriptionId = null;
  }
  if (ghostSubscriptionIds.length > 0) {
    for (const id of ghostSubscriptionIds) {
      void conn.removeAccountChangeListener(id).catch(() => {});
    }
    ghostSubscriptionIds = [];
  }

  activeSubscriptionConnection = null;
}

function setupSubscriptions(
  program: Program<any>,
  authority: PublicKey,
  commitment: "processed" | "confirmed",
) {
  const conn = program.provider.connection as Connection;
  clearSubscriptions(conn);
  activeSubscriptionConnection = conn;

  const [worldPda] = getWorldPda();
  const [playerPda] = getPlayerPda(worldPda, authority);

  worldSubscriptionId = conn.onAccountChange(
    worldPda,
    async (accountInfo) => {
      try {
        const decoded = program.coder.accounts.decode(
          "world",
          accountInfo.data,
        );
        const parsed = parseWorld(decoded);
        useGameStore.getState().setWorld(parsed);
        useGameStore.getState().setWorldPda(worldPda);
        if (commitment === "processed") {
          await fetchOtherPlayers(program, authority);
        }
      } catch (err) {
        console.warn("[fetchState] World subscription decode failed:", err);
      }
    },
    commitment,
  );

  playerSubscriptionId = conn.onAccountChange(
    playerPda,
    async (accountInfo) => {
      try {
        const parsed = tryDecodePlayer(program, accountInfo.data);
        if (!parsed) {
          useGameStore.getState().setPlayer(null);
          lastObservedChunkIndex = null;
          return;
        }
        const previousChunkIndex = lastObservedChunkIndex;
        lastObservedChunkIndex = parsed.chunkIndex;
        useGameStore.getState().setPlayer(parsed);

        if (
          previousChunkIndex !== null &&
          previousChunkIndex !== parsed.chunkIndex
        ) {
          await fetchVisibleChunks(program);
        }
      } catch {
        useGameStore.getState().setPlayer(null);
        lastObservedChunkIndex = null;
      }
    },
    commitment,
  );

  ghostSubscriptionIds = [];
  for (let i = 0; i < NUM_GHOSTS; i++) {
    const [ghostPda] = getGhostPda(worldPda, i);
    const id = conn.onAccountChange(
      ghostPda,
      async () => {
        try {
          await fetchGhosts(program);
        } catch (err) {
          console.warn("[fetchState] Ghost subscription refresh failed:", err);
        }
      },
      commitment,
    );
    ghostSubscriptionIds.push(id);
  }
}

/**
 * Start polling game state.
 * - L1 program (Phantom): used for spawn/cashout and initial setup
 * - erProgram (session key): used for fast gameplay state reads when session is active
 *
 * ER mode:
 * - subscriptions for player/world/ghosts
 * - slow fallback refresh for world/slot/other players
 * - chunk refresh on chunk changes, with a low-frequency safety refresh
 */
export function startPolling(
  l1Program: Program<any>,
  connection: Connection,
  authority: PublicKey,
  erProgram?: Program<any>,
) {
  stopPolling();

  const gameProgram = erProgram ?? l1Program;
  const slotConnection = erProgram ? getSharedErConnection() : connection;
  resetPlayerDiscoveryState(authority);

  // Initial fetch
  void fetchWorldState(gameProgram);
  void fetchPlayerState(gameProgram, authority);
  void fetchVisibleChunks(gameProgram);
  void fetchGhosts(gameProgram);
  if (erProgram) {
    void fetchOtherPlayers(gameProgram, authority);
  }
  void fetchCurrentSlot(slotConnection);

  if (erProgram) {
    try {
      setupSubscriptions(erProgram, authority, "processed");
    } catch (err) {
      console.warn("[fetchState] Failed to initialize ER subscriptions:", err);
      clearSubscriptions(slotConnection);
    }

    entityPollInterval = setInterval(async () => {
      if (entityPollInFlight) return;
      entityPollInFlight = true;
      try {
        await Promise.all([
          fetchPlayerState(erProgram, authority),
          fetchGhosts(erProgram),
        ]);
      } finally {
        entityPollInFlight = false;
      }
    }, 150);

    pollInterval = setInterval(async () => {
      if (pollInFlight) return;
      pollInFlight = true;
      try {
        await Promise.all([
          fetchWorldState(erProgram),
          fetchCurrentSlot(slotConnection),
          fetchOtherPlayers(erProgram, authority),
        ]);
      } finally {
        pollInFlight = false;
      }
    }, 3000);
  } else {
    try {
      setupSubscriptions(l1Program, authority, "confirmed");
    } catch (err) {
      console.warn("[fetchState] Failed to initialize L1 subscriptions:", err);
      clearSubscriptions(connection);
    }

    pollInterval = setInterval(async () => {
      if (pollInFlight) return;
      pollInFlight = true;
      try {
        const tasks: Promise<void>[] = [
          fetchPlayerState(l1Program, authority),
          fetchCurrentSlot(slotConnection),
          fetchWorldState(l1Program),
        ];
        await Promise.all(tasks);
      } finally {
        pollInFlight = false;
      }
    }, 10000);
  }

  chunkPollInterval = setInterval(() => {
    if (chunkPollInFlight) return;
    chunkPollInFlight = true;
    void fetchVisibleChunks(gameProgram).finally(() => {
      chunkPollInFlight = false;
    });
  }, erProgram ? 5000 : 15000);
}

export function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  if (entityPollInterval) {
    clearInterval(entityPollInterval);
    entityPollInterval = null;
  }
  if (chunkPollInterval) {
    clearInterval(chunkPollInterval);
    chunkPollInterval = null;
  }
  pollInFlight = false;
  chunkPollInFlight = false;
  entityPollInFlight = false;
  clearSubscriptions(activeSubscriptionConnection);
}
