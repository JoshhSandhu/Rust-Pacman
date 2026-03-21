import { PublicKey } from "@solana/web3.js";
import {
  useGameStore,
  CHUNK_ROWS,
  CHUNK_COLS,
  CELL_WALL,
  CELL_PELLET,
  CELL_POWER,
  CELL_EMPTY,
  DIR_UP,
  DIR_DOWN,
  DIR_LEFT,
  DIR_RIGHT,
  ChunkState,
  GhostState,
  PlayerState,
  WorldState,
  MAX_CHUNKS,
  LAMPORTS_PER_PELLET,
  LAMPORTS_PER_GHOST_KILL,
} from "../state/gameStore";
import { CHUNK_TEMPLATES } from "./chunkTemplates";

const DUMMY_PUBKEY = new PublicKey("11111111111111111111111111111111");

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

// Per-ghost direction state for demo mode (so they move consistently)
interface GhostDirection {
  row: number;
  col: number;
}
let ghostDirs: GhostDirection[] = [
  { row: 1, col: 0 },
  { row: 0, col: 1 },
  { row: -1, col: 0 },
  { row: 0, col: -1 },
];

function respawnDemoGhost(ghost: GhostState, world: WorldState): GhostState {
  return {
    ...ghost,
    chunkIndex: world.scrollOffset + Math.floor(MAX_CHUNKS / 2),
    row: Math.floor(CHUNK_ROWS / 2),
    col: Math.floor(CHUNK_COLS / 2),
    direction: DIR_UP,
  };
}

function applyDemoGhostCollisions(
  player: PlayerState,
  ghosts: GhostState[],
  world: WorldState,
  currentSlot: number,
): { player: PlayerState; ghosts: GhostState[] } {
  const collidingGhosts = ghosts.reduce<number[]>((hits, ghost, index) => {
    if (
      ghost.chunkIndex === player.chunkIndex &&
      ghost.row === player.rowInChunk &&
      ghost.col === player.col
    ) {
      hits.push(index);
    }
    return hits;
  }, []);

  if (collidingGhosts.length === 0) {
    return { player, ghosts };
  }

  if (currentSlot > player.powerPelletUntilSlot) {
    return {
      player: {
        ...player,
        balanceLamports: 0,
        dead: true,
      },
      ghosts,
    };
  }

  const collided = new Set(collidingGhosts);
  return {
    player: {
      ...player,
      balanceLamports:
        player.balanceLamports +
        collidingGhosts.length * LAMPORTS_PER_GHOST_KILL,
    },
    ghosts: ghosts.map((ghost, index) =>
      collided.has(index) ? respawnDemoGhost(ghost, world) : ghost,
    ),
  };
}

export function startDemoMode(): void {
  const store = useGameStore.getState();
  store.setDemoMode(true);
  store.setOtherPlayers(new Map());

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
    balanceLamports: 15_000_000,
    powerPelletUntilSlot: 0,
    lastMoveSlot: 0,
    dead: false,
    bump: 255,
  };
  store.setPlayer(player);
  store.setGameStarted(true);
  store.setConnected(true);
  store.setCurrentSlot(100);
  // Reset BR boundaries for demo
  store.resetBoundaries();
  store.setBrStartTime(Date.now());

  // Create ghosts — spread across adjacent chunks, each with a different direction
  const ghosts: GhostState[] = [
    {
      world: DUMMY_PUBKEY,
      ghostId: 0,
      chunkIndex: 15,
      row: 1,
      col: 3,
      state: 0,
      direction: DIR_DOWN,
    },
    {
      world: DUMMY_PUBKEY,
      ghostId: 1,
      chunkIndex: 16,
      row: 1,
      col: 7,
      state: 0,
      direction: DIR_LEFT,
    },
    {
      world: DUMMY_PUBKEY,
      ghostId: 2,
      chunkIndex: 17,
      row: 4,
      col: 2,
      state: 0,
      direction: DIR_UP,
    },
    {
      world: DUMMY_PUBKEY,
      ghostId: 3,
      chunkIndex: 18,
      row: 3,
      col: 8,
      state: 0,
      direction: DIR_RIGHT,
    },
  ];
  store.setGhosts(ghosts);

  // Demo animation loop — moves ghosts on both X and Y axes
  const GHOST_MOVE_INTERVAL = 0.5; // seconds per tile
  let lastGhostMove = 0;

  const animateDemo = () => {
    demoTime += 0.016;
    const s = useGameStore.getState();
    if (!s.player || !s.world) return;

    // Move ghosts every GHOST_MOVE_INTERVAL seconds
    if (demoTime - lastGhostMove >= GHOST_MOVE_INTERVAL) {
      lastGhostMove = demoTime;

      const updatedGhosts = s.ghosts.map((g, i) => {
        const dir = ghostDirs[i];
        let newRow = g.row + dir.row;
        let newCol = g.col + dir.col;
        let newChunk = g.chunkIndex;
        let newDir = { ...dir };

        // Handle row crossing chunk boundaries
        if (newRow < 0) {
          newRow = CHUNK_ROWS - 1;
          newChunk = Math.max(0, newChunk - 1);
        } else if (newRow >= CHUNK_ROWS) {
          newRow = 0;
          newChunk = Math.min(MAX_CHUNKS - 1, newChunk + 1);
        }

        // Handle col clamping — bounce off walls
        if (newCol < 0 || newCol >= CHUNK_COLS) {
          newDir.col = -dir.col;
          newCol = Math.max(0, Math.min(CHUNK_COLS - 1, newCol));
        }

        // Check wall collision in target chunk
        const physIdx = newChunk % MAX_CHUNKS;
        const chunk = s.chunks.get(physIdx);
        if (chunk && chunk.grid[newRow]?.[newCol] === CELL_WALL) {
          // Hit wall — turn 90 degrees or reverse
          if (dir.row !== 0) {
            // Was moving vertically — try horizontal
            newDir = { row: 0, col: Math.random() > 0.5 ? 1 : -1 };
          } else {
            // Was moving horizontally — try vertical
            newDir = { row: Math.random() > 0.5 ? 1 : -1, col: 0 };
          }
          newRow = g.row;
          newCol = g.col;
          newChunk = g.chunkIndex;
        }

        ghostDirs[i] = newDir;

        // Set direction enum
        let direction = g.direction;
        if (newDir.row > 0) direction = DIR_DOWN;
        else if (newDir.row < 0) direction = DIR_UP;
        else if (newDir.col > 0) direction = DIR_RIGHT;
        else if (newDir.col < 0) direction = DIR_LEFT;

        return {
          ...g,
          chunkIndex: newChunk,
          row: Math.max(0, Math.min(CHUNK_ROWS - 1, newRow)),
          col: Math.max(0, Math.min(CHUNK_COLS - 1, newCol)),
          direction,
        };
      });

      const collided = applyDemoGhostCollisions(
        s.player,
        updatedGhosts,
        s.world,
        s.currentSlot,
      );
      s.setGhosts(collided.ghosts);
      if (collided.player !== s.player) {
        s.setPlayer(collided.player);
      }
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
  demoTime = 0;
  const store = useGameStore.getState();
  store.setDemoMode(false);
  store.setOtherPlayers(new Map());
}

// Demo keyboard handler — moves player locally without blockchain
export function initDemoControls(): () => void {
  const handler = (e: KeyboardEvent) => {
    const store = useGameStore.getState();
    const player = store.player;
    const world = store.world;
    if (!player || !world) return;

    if (e.code === "Space" && player.dead) {
      e.preventDefault();
      store.setPlayer({
        ...player,
        chunkIndex: world.scrollOffset + Math.floor(MAX_CHUNKS / 2),
        rowInChunk: Math.floor(CHUNK_ROWS / 2),
        col: Math.floor(CHUNK_COLS / 2),
        direction: DIR_RIGHT,
        balanceLamports: 0,
        powerPelletUntilSlot: 0,
        dead: false,
      });
      store.setGhosts(
        store.ghosts.map((ghost) => respawnDemoGhost(ghost, world)),
      );
      return;
    }

    if (player.dead) return;

    let { chunkIndex, rowInChunk, col, direction } = player;

    switch (e.key) {
      case "ArrowUp":
      case "w":
      case "W":
        direction = DIR_UP;
        rowInChunk -= 1;
        if (rowInChunk < 0) {
          rowInChunk = CHUNK_ROWS - 1;
          chunkIndex -= 1;
        }
        break;
      case "ArrowDown":
      case "s":
      case "S":
        direction = DIR_DOWN;
        rowInChunk += 1;
        if (rowInChunk >= CHUNK_ROWS) {
          rowInChunk = 0;
          chunkIndex += 1;
        }
        break;
      case "ArrowLeft":
      case "a":
      case "A":
        direction = DIR_LEFT;
        col -= 1;
        if (col < 0) col = 0;
        break;
      case "ArrowRight":
      case "d":
      case "D":
        direction = DIR_RIGHT;
        col += 1;
        if (col >= CHUNK_COLS) col = CHUNK_COLS - 1;
        break;
      default:
        return;
    }

    e.preventDefault();

    // Wall collision check
    const physIdx =
      (((chunkIndex - world.scrollOffset) % MAX_CHUNKS) + MAX_CHUNKS) %
      MAX_CHUNKS;
    const chunk = store.chunks.get(physIdx);
    if (chunk && chunk.grid[rowInChunk]?.[col] === CELL_WALL) {
      return;
    }

    let nextPlayer: PlayerState = {
      ...player,
      chunkIndex,
      rowInChunk,
      col,
      direction,
    };

    // Eat pellet
    if (
      chunk &&
      (chunk.grid[rowInChunk]?.[col] === CELL_PELLET ||
        chunk.grid[rowInChunk]?.[col] === CELL_POWER)
    ) {
      const isPower = chunk.grid[rowInChunk][col] === CELL_POWER;
      const newGrid = chunk.grid.map((r) => [...r]);
      newGrid[rowInChunk][col] = CELL_EMPTY;
      store.setChunk(physIdx, { ...chunk, grid: newGrid });

      nextPlayer = {
        ...nextPlayer,
        balanceLamports: player.balanceLamports + LAMPORTS_PER_PELLET,
        powerPelletUntilSlot: isPower
          ? store.currentSlot + 200
          : player.powerPelletUntilSlot,
      };

      if (isPower) {
        store.setIsPowered(true);
        store.setCurrentSlot(store.currentSlot);
      }
    }

    const collided = applyDemoGhostCollisions(
      nextPlayer,
      store.ghosts,
      world,
      store.currentSlot,
    );
    if (collided.ghosts !== store.ghosts) {
      store.setGhosts(collided.ghosts);
    }
    store.setPlayer(collided.player);
    store.setLastDirection(direction);
  };

  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}
