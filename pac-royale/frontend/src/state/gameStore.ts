import { create } from 'zustand';
import { PublicKey } from '@solana/web3.js';

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
  x: number;
  y: number;
  text: string;
  color: string;
  createdAt: number;
}

export interface GameStore {
  // Connection state
  connected: boolean;
  playerPda: PublicKey | null;
  worldPda: PublicKey | null;

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

  // Actions
  setConnected: (connected: boolean) => void;
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
  addScorePopup: (popup: Omit<ScorePopup, 'id' | 'createdAt'>) => void;
  removeScorePopup: (id: number) => void;
  triggerScreenFlash: (color: string) => void;
  addOtherPlayer: (key: string, player: PlayerState) => void;
  removeOtherPlayer: (key: string) => void;
}

let popupIdCounter = 0;

export const useGameStore = create<GameStore>((set, get) => ({
  connected: false,
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

  setConnected: (connected) => set({ connected }),
  setPlayerPda: (pda) => set({ playerPda: pda }),
  setWorldPda: (pda) => set({ worldPda: pda }),
  setWorld: (world) => set({ world }),
  setPlayer: (player) => {
    const prev = get().player;
    // Detect balance increase for popup
    if (prev && player && player.balanceLamports > prev.balanceLamports) {
      const diff = player.balanceLamports - prev.balanceLamports;
      const isGhostKill = diff >= LAMPORTS_PER_GHOST_KILL;
      get().addScorePopup({
        x: 0, y: 0, // will be positioned by renderer
        text: isGhostKill ? `+${diff / 1_000_000}` : `+${diff / 1_000_000}`,
        color: isGhostKill ? '#00FFFF' : '#FFE600',
      });
    }
    // Detect death
    if (prev && !prev.dead && player && player.dead) {
      get().triggerScreenFlash('#FF0000');
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

  addScorePopup: (popup) => {
    const id = popupIdCounter++;
    set((state) => ({
      scorePopups: [...state.scorePopups, { ...popup, id, createdAt: Date.now() }],
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
}));
