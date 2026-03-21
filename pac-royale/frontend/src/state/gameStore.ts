import { create } from "zustand";
import { PublicKey } from "@solana/web3.js";

// --- On-chain types mirrored from Anchor program ---
export const CHUNK_ROWS = 6;
export const CHUNK_COLS = 10;
export const MAX_CHUNKS = 32;
export const NUM_GHOSTS = 4;
export const LAMPORTS_PER_PELLET = 1_000_000;
export const LAMPORTS_PER_GHOST_KILL = 10_000_000;

export const CELL_EMPTY = 0;
export const CELL_WALL = 1;
export const CELL_PELLET = 2;
export const CELL_POWER = 3;

export const DIR_UP = 0;
export const DIR_DOWN = 1;
export const DIR_LEFT = 2;
export const DIR_RIGHT = 3;

const BR_START_STORAGE_KEY = "pac-royale-br-start";

function loadStoredBrStartTime(): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(BR_START_STORAGE_KEY);
  if (!raw) return null;

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function persistBrStartTime(time: number | null): void {
  if (typeof window === "undefined") return;
  if (time === null) {
    window.sessionStorage.removeItem(BR_START_STORAGE_KEY);
    return;
  }
  window.sessionStorage.setItem(BR_START_STORAGE_KEY, String(time));
}

export interface WorldState {
  authority: PublicKey;
  chunkCount: number;
  scrollOffset: number;
  nextScrollSlot: number;
  totalPlayers: number;
  frozen: boolean;
}

export interface PlayerState {
  authority: PublicKey | null;
  world: PublicKey;
  payoutWallet: PublicKey;
  chunkIndex: number;
  rowInChunk: number;
  col: number;
  direction: number;
  balanceLamports: number;
  powerPelletUntilSlot: number;
  lastMoveSlot: number;
  dead: boolean;
  bump: number;
}

export interface ChunkState {
  world: PublicKey;
  physicalIndex: number;
  logicalIndex: number;
  templateId: number;
  grid: number[][];
}

export interface GhostState {
  world: PublicKey;
  ghostId: number;
  chunkIndex: number;
  row: number;
  col: number;
  state: number;
  direction: number;
}

export interface ScorePopup {
  id: number;
  text: string;
  color: string;
  createdAt: number;
}

export interface GameStore {
  // Connection state
  connected: boolean;
  demoMode: boolean;
  playerPda: PublicKey | null;
  worldPda: PublicKey | null;

  // Session key state (ER gameplay)
  sessionActive: boolean;
  sessionKeyPubkey: PublicKey | null;

  // On-chain data
  world: WorldState | null;
  player: PlayerState | null;
  chunks: Map<number, ChunkState>;
  ghosts: GhostState[];
  otherPlayers: Map<string, PlayerState>;

  // Local game state
  isPowered: boolean;
  currentSlot: number;
  screenFlash: string | null;
  scorePopups: ScorePopup[];
  lastDirection: number;
  gameStarted: boolean;
  loading: boolean;
  brStartTime: number | null;

  // ✅ NEW: Battle royale boundary tracking (logical chunk indices)
  // bottomBoundary: lowest safe logical chunk index (starts at 0, increases)
  // topBoundary: highest safe logical chunk index (starts at MAX_CHUNKS-1, decreases)
  bottomBoundary: number;
  topBoundary: number;
  // Set of logical chunk indices that have been destroyed (for fade-out animation)
  destroyedChunks: Set<number>;

  // Actions
  setConnected: (connected: boolean) => void;
  setDemoMode: (demoMode: boolean) => void;
  setPlayerPda: (pda: PublicKey | null) => void;
  setWorldPda: (pda: PublicKey | null) => void;
  setWorld: (world: WorldState | null) => void;
  setPlayer: (player: PlayerState | null) => void;
  setChunk: (physicalIndex: number, chunk: ChunkState) => void;
  setGhosts: (ghosts: GhostState[]) => void;
  setCurrentSlot: (slot: number) => void;
  setIsPowered: (powered: boolean) => void;
  setLastDirection: (dir: number) => void;
  setGameStarted: (started: boolean) => void;
  setLoading: (loading: boolean) => void;
  setBrStartTime: (time: number | null) => void;
  addScorePopup: (popup: Omit<ScorePopup, "id" | "createdAt">) => void;
  removeScorePopup: (id: number) => void;
  triggerScreenFlash: (color: string) => void;
  addOtherPlayer: (key: string, player: PlayerState) => void;
  removeOtherPlayer: (key: string) => void;
  setOtherPlayers: (players: Map<string, PlayerState>) => void;
  // ✅ NEW boundary actions
  setBottomBoundary: (idx: number) => void;
  setTopBoundary: (idx: number) => void;
  addDestroyedChunk: (logicalIdx: number) => void;
  resetBoundaries: () => void;
  // Session key actions
  setSessionActive: (active: boolean) => void;
  setSessionKeyPubkey: (pk: PublicKey | null) => void;
}

let popupIdCounter = 0;

export const useGameStore = create<GameStore>((set, get) => ({
  connected: false,
  demoMode: false,
  playerPda: null,
  worldPda: null,

  world: null,
  player: null,
  chunks: new Map(),
  ghosts: [],
  otherPlayers: new Map(),

  isPowered: false,
  currentSlot: 0,
  screenFlash: null,
  scorePopups: [],
  lastDirection: DIR_RIGHT,
  gameStarted: false,
  loading: false,
  brStartTime: loadStoredBrStartTime(),

  // Session key state
  sessionActive: false,
  sessionKeyPubkey: null,

  // ✅ Battle royale boundaries
  bottomBoundary: 0,
  topBoundary: MAX_CHUNKS - 1,
  destroyedChunks: new Set(),

  setConnected: (connected) => set({ connected }),
  setDemoMode: (demoMode) => set({ demoMode }),
  setPlayerPda: (pda) => set({ playerPda: pda }),
  setWorldPda: (pda) => set({ worldPda: pda }),
  setWorld: (world) => set({ world }),
  setPlayer: (player) => {
    const prev = get().player;
    if (prev && player && player.balanceLamports > prev.balanceLamports) {
      const diff = player.balanceLamports - prev.balanceLamports;
      const isGhostKill = diff >= LAMPORTS_PER_GHOST_KILL;
      get().addScorePopup({
        text: isGhostKill
          ? `+${(diff / 1_000_000).toFixed(3)} SOL`
          : `+${diff / 1_000_000}`,
        color: isGhostKill ? "#00FFFF" : "#FFE600",
      });
    }
    if (prev && !prev.dead && player && player.dead) {
      get().triggerScreenFlash("#FF0000");
    }
    set({ player });
  },
  setChunk: (physicalIndex, chunk) =>
    set((state) => {
      const next = new Map(state.chunks);
      next.set(physicalIndex, chunk);
      return { chunks: next };
    }),
  setGhosts: (ghosts) => set({ ghosts }),
  setCurrentSlot: (slot) => {
    const player = get().player;
    const isPowered = player ? slot <= player.powerPelletUntilSlot : false;
    set({ currentSlot: slot, isPowered });
  },
  setIsPowered: (isPowered) => set({ isPowered }),
  setLastDirection: (dir) => set({ lastDirection: dir }),
  setGameStarted: (started) => set({ gameStarted: started }),
  setLoading: (loading) => set({ loading }),
  setBrStartTime: (time) => {
    persistBrStartTime(time);
    set({ brStartTime: time });
  },

  addScorePopup: (popup) => {
    const id = popupIdCounter++;
    set((state) => ({
      scorePopups: [
        ...state.scorePopups,
        { ...popup, id, createdAt: Date.now() },
      ],
    }));
    setTimeout(() => get().removeScorePopup(id), 900);
  },

  removeScorePopup: (id) =>
    set((state) => ({
      scorePopups: state.scorePopups.filter((p) => p.id !== id),
    })),

  triggerScreenFlash: (color) => {
    set({ screenFlash: color });
    setTimeout(() => set({ screenFlash: null }), 350);
  },

  addOtherPlayer: (key, player) =>
    set((state) => {
      const next = new Map(state.otherPlayers);
      next.set(key, player);
      return { otherPlayers: next };
    }),

  removeOtherPlayer: (key) =>
    set((state) => {
      const next = new Map(state.otherPlayers);
      next.delete(key);
      return { otherPlayers: next };
    }),

  setOtherPlayers: (players) => set({ otherPlayers: players }),

  // ✅ Battle royale boundary actions
  setBottomBoundary: (idx) => set({ bottomBoundary: idx }),
  setTopBoundary: (idx) => set({ topBoundary: idx }),
  addDestroyedChunk: (logicalIdx) =>
    set((state) => {
      const next = new Set(state.destroyedChunks);
      next.add(logicalIdx);
      return { destroyedChunks: next };
    }),
  resetBoundaries: () =>
    set({
      bottomBoundary: 0,
      topBoundary: MAX_CHUNKS - 1,
      destroyedChunks: new Set(),
    }),

  setSessionActive: (active) => set({ sessionActive: active }),
  setSessionKeyPubkey: (pk) => set({ sessionKeyPubkey: pk }),
}));
