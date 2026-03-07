import { PublicKey } from '@solana/web3.js';
import {
  useGameStore,
  CHUNK_ROWS,
  CHUNK_COLS,
  CELL_WALL,
  CELL_PELLET,
  CELL_POWER,
  CELL_EMPTY,
  DIR_RIGHT,
  ChunkState,
  GhostState,
  PlayerState,
  WorldState,
} from '../state/gameStore';

// 5 chunk templates matching the on-chain program
const CHUNK_TEMPLATES: number[][][] = [
  // Template 0: Classic corridors
  [
    [1, 0, 2, 2, 2, 2, 2, 2, 0, 1],
    [1, 0, 2, 1, 1, 1, 1, 2, 0, 1],
    [0, 0, 2, 0, 0, 0, 0, 2, 0, 0],
    [0, 0, 2, 0, 1, 1, 0, 2, 0, 0],
    [1, 0, 2, 1, 1, 1, 1, 2, 0, 1],
    [1, 0, 2, 2, 2, 3, 2, 2, 0, 1],
  ],
  // Template 1: Open arena
  [
    [0, 2, 2, 2, 0, 0, 2, 2, 2, 0],
    [2, 1, 0, 2, 0, 0, 2, 0, 1, 2],
    [2, 0, 0, 2, 2, 2, 2, 0, 0, 2],
    [2, 0, 0, 2, 2, 2, 2, 0, 0, 2],
    [2, 1, 0, 2, 0, 0, 2, 0, 1, 2],
    [0, 2, 2, 2, 0, 0, 2, 2, 2, 0],
  ],
  // Template 2: Zigzag
  [
    [2, 2, 0, 1, 1, 0, 2, 2, 0, 0],
    [0, 2, 0, 0, 0, 0, 0, 2, 0, 1],
    [0, 2, 2, 2, 1, 1, 0, 2, 0, 0],
    [0, 0, 2, 0, 1, 1, 2, 2, 0, 0],
    [1, 0, 2, 0, 0, 0, 0, 2, 0, 0],
    [0, 0, 2, 2, 0, 1, 1, 0, 2, 3],
  ],
  // Template 3: Box rooms
  [
    [1, 1, 0, 2, 2, 2, 2, 0, 1, 1],
    [1, 0, 0, 2, 1, 1, 2, 0, 0, 1],
    [0, 0, 2, 3, 1, 1, 3, 2, 0, 0],
    [0, 0, 2, 2, 0, 0, 2, 2, 0, 0],
    [1, 0, 0, 2, 1, 1, 2, 0, 0, 1],
    [1, 1, 0, 2, 2, 2, 2, 0, 1, 1],
  ],
  // Template 4: Cross pattern
  [
    [0, 0, 0, 1, 2, 2, 1, 0, 0, 0],
    [0, 1, 0, 0, 2, 2, 0, 0, 1, 0],
    [2, 2, 2, 0, 0, 0, 0, 2, 2, 2],
    [2, 2, 2, 0, 0, 0, 0, 2, 2, 2],
    [0, 1, 0, 0, 2, 2, 0, 0, 1, 0],
    [0, 0, 0, 1, 2, 3, 1, 0, 0, 0],
  ],
];

const DUMMY_PUBKEY = new PublicKey('11111111111111111111111111111111');

function makeChunk(physicalIndex: number, logicalIndex: number): ChunkState {
  const templateId = logicalIndex % CHUNK_TEMPLATES.length;
  const template = CHUNK_TEMPLATES[templateId];
  return {
    world: DUMMY_PUBKEY,
    physicalIndex,
    logicalIndex,
    templateId,
    grid: template.map((row) => [...row]),
  };
}

let demoAnimFrame: number | null = null;
let demoTime = 0;

export function startDemoMode(): void {
  const store = useGameStore.getState();

  // Set world
  const world: WorldState = {
    authority: DUMMY_PUBKEY,
    chunkCount: 32,
    scrollOffset: 0,
    nextScrollSlot: 999999,
    totalPlayers: 3,
    frozen: false,
  };
  store.setWorld(world);
  store.setWorldPda(DUMMY_PUBKEY);

  // Create 32 chunks
  for (let i = 0; i < 32; i++) {
    store.setChunk(i, makeChunk(i, i));
  }

  // Create player at chunk 16
  const player: PlayerState = {
    authority: DUMMY_PUBKEY,
    world: DUMMY_PUBKEY,
    payoutWallet: DUMMY_PUBKEY,
    chunkIndex: 16,
    rowInChunk: 3,
    col: 5,
    direction: DIR_RIGHT,
    balanceLamports: 15_000_000, // 0.015 SOL
    powerPelletUntilSlot: 0,
    lastMoveSlot: 0,
    dead: false,
    bump: 255,
  };
  store.setPlayer(player);
  store.setGameStarted(true);
  store.setConnected(true);
  store.setCurrentSlot(100);

  // Create ghosts
  const ghosts: GhostState[] = [
    { world: DUMMY_PUBKEY, ghostId: 0, chunkIndex: 15, row: 2, col: 3, state: 0, direction: 0 },
    { world: DUMMY_PUBKEY, ghostId: 1, chunkIndex: 16, row: 1, col: 7, state: 0, direction: 1 },
    { world: DUMMY_PUBKEY, ghostId: 2, chunkIndex: 17, row: 4, col: 2, state: 0, direction: 2 },
    { world: DUMMY_PUBKEY, ghostId: 3, chunkIndex: 18, row: 3, col: 8, state: 0, direction: 3 },
  ];
  store.setGhosts(ghosts);

  // Animate demo — move player and ghosts slowly
  const animateDemo = () => {
    demoTime += 0.016;
    const s = useGameStore.getState();
    if (!s.player) return;

    // Slow ghost drift
    if (Math.floor(demoTime * 2) % 2 === 0) {
      const updatedGhosts = s.ghosts.map((g) => {
        const newCol = g.col + (Math.random() > 0.5 ? 1 : -1);
        return {
          ...g,
          col: Math.max(0, Math.min(CHUNK_COLS - 1, newCol)),
        };
      });
      s.setGhosts(updatedGhosts);
    }

    demoAnimFrame = requestAnimationFrame(animateDemo);
  };

  demoAnimFrame = requestAnimationFrame(animateDemo);
}

export function stopDemoMode(): void {
  if (demoAnimFrame !== null) {
    cancelAnimationFrame(demoAnimFrame);
    demoAnimFrame = null;
  }
}

// Demo keyboard handler — moves player locally without blockchain
export function initDemoControls(): () => void {
  const handler = (e: KeyboardEvent) => {
    const store = useGameStore.getState();
    const player = store.player;
    const world = store.world;
    if (!player || !world || player.dead) return;

    let { chunkIndex, rowInChunk, col, direction } = player;

    switch (e.key) {
      case 'ArrowUp': case 'w': case 'W':
        direction = 0;
        rowInChunk -= 1;
        if (rowInChunk < 0) { rowInChunk = CHUNK_ROWS - 1; chunkIndex -= 1; }
        break;
      case 'ArrowDown': case 's': case 'S':
        direction = 1;
        rowInChunk += 1;
        if (rowInChunk >= CHUNK_ROWS) { rowInChunk = 0; chunkIndex += 1; }
        break;
      case 'ArrowLeft': case 'a': case 'A':
        direction = 2;
        col -= 1;
        if (col < 0) col = 0;
        break;
      case 'ArrowRight': case 'd': case 'D':
        direction = 3;
        col += 1;
        if (col >= CHUNK_COLS) col = CHUNK_COLS - 1;
        break;
      default:
        return;
    }

    e.preventDefault();

    // Check wall collision in the target chunk
    const physIdx = ((chunkIndex - world.scrollOffset) % 32 + 32) % 32;
    const chunk = store.chunks.get(physIdx);
    if (chunk && chunk.grid[rowInChunk]?.[col] === CELL_WALL) {
      return; // blocked by wall
    }

    // Eat pellet
    if (chunk && (chunk.grid[rowInChunk]?.[col] === CELL_PELLET || chunk.grid[rowInChunk]?.[col] === CELL_POWER)) {
      const isPower = chunk.grid[rowInChunk][col] === CELL_POWER;
      const newGrid = chunk.grid.map((r) => [...r]);
      newGrid[rowInChunk][col] = CELL_EMPTY;
      store.setChunk(physIdx, { ...chunk, grid: newGrid });

      const bonus = isPower ? 10_000_000 : 1_000_000;
      store.setPlayer({
        ...player,
        chunkIndex,
        rowInChunk,
        col,
        direction,
        balanceLamports: player.balanceLamports + bonus,
        powerPelletUntilSlot: isPower ? store.currentSlot + 200 : player.powerPelletUntilSlot,
      });

      if (isPower) {
        store.setIsPowered(true);
        store.setCurrentSlot(store.currentSlot); // recalc
      }

      store.addScorePopup({
        x: 0, y: 0,
        text: isPower ? '+10' : '+1',
        color: isPower ? '#00FFFF' : '#FFE600',
      });
      return;
    }

    store.setPlayer({ ...player, chunkIndex, rowInChunk, col, direction });
    store.setLastDirection(direction);
  };

  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}
