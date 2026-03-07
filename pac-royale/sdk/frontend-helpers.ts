import { PublicKey } from "@solana/web3.js";
import { PacRoyaleClient, CONSTANTS, PlayerPosition, GhostPosition } from "./client";

/**
 * Frontend integration helpers for Pac-Royale
 * Provides higher-level functions for React/UI components
 */

export interface GameState {
  world: {
    totalPlayers: number;
    scrollOffset: number;
    nextScrollSlot: number;
    frozen: boolean;
  };
  player: {
    position: PlayerPosition;
    balance: number;
    balanceSOL: number;
    isPowered: boolean;
    powerEndsAt: number;
    dead: boolean;
  };
  chunks: ChunkData[];
  ghosts: GhostData[];
  otherPlayers: PlayerData[];
}

export interface ChunkData {
  physicalIndex: number;
  logicalIndex: number;
  templateId: number;
  grid: number[][];
}

export interface GhostData {
  ghostId: number;
  position: GhostPosition;
  state: number;
  direction: number;
}

export interface PlayerData {
  authority: string;
  position: PlayerPosition;
  balance: number;
  isPowered: boolean;
  dead: boolean;
}

/**
 * Fetch complete game state for rendering
 */
export async function fetchGameState(
  client: PacRoyaleClient,
  playerAuthority: PublicKey,
  currentSlot?: number
): Promise<GameState> {
  const [world, player, allPlayers, chunks, ghosts] = await Promise.all([
    client.fetchWorld(),
    client.fetchPlayer(playerAuthority),
    client.fetchAllPlayers(),
    client.fetchAllChunks(),
    client.fetchAllGhosts(),
  ]);

  const slot = currentSlot || (await client.connection.getSlot());

  return {
    world: {
      totalPlayers: world.totalPlayers,
      scrollOffset: world.scrollOffset,
      nextScrollSlot: world.nextScrollSlot.toNumber(),
      frozen: world.frozen,
    },
    player: {
      position: {
        chunkIndex: player.chunkIndex,
        rowInChunk: player.rowInChunk,
        col: player.col,
      },
      balance: player.balanceLamports.toNumber(),
      balanceSOL: player.balanceLamports.toNumber() / 1e9,
      isPowered: slot <= player.powerPelletUntilSlot.toNumber(),
      powerEndsAt: player.powerPelletUntilSlot.toNumber(),
      dead: player.dead,
    },
    chunks: chunks.map((chunk) => ({
      physicalIndex: chunk.physicalIndex,
      logicalIndex: chunk.logicalIndex,
      templateId: chunk.templateId,
      grid: chunk.grid,
    })),
    ghosts: ghosts.map((ghost) => ({
      ghostId: ghost.ghostId,
      position: {
        chunkIndex: ghost.chunkIndex,
        row: ghost.row,
        col: ghost.col,
      },
      state: ghost.state,
      direction: ghost.direction,
    })),
    otherPlayers: allPlayers
      .filter((p) => !p.authority.equals(playerAuthority))
      .map((p) => ({
        authority: p.authority.toBase58(),
        position: {
          chunkIndex: p.chunkIndex,
          rowInChunk: p.rowInChunk,
          col: p.col,
        },
        balance: p.balanceLamports.toNumber(),
        isPowered: slot <= p.powerPelletUntilSlot.toNumber(),
        dead: p.dead,
      })),
  };
}

/**
 * Get visible chunks for rendering (current player's view)
 */
export function getVisibleChunks(
  chunks: ChunkData[],
  playerChunkIndex: number,
  scrollOffset: number,
  viewRadius: number = 3
): ChunkData[] {
  const minLogical = Math.max(scrollOffset, playerChunkIndex - viewRadius);
  const maxLogical = playerChunkIndex + viewRadius;

  return chunks.filter(
    (chunk) => chunk.logicalIndex >= minLogical && chunk.logicalIndex <= maxLogical
  );
}

/**
 * Convert chunk grid to world coordinates for rendering
 */
export function chunkToWorldCoords(
  chunkIndex: number,
  rowInChunk: number,
  col: number
): { worldRow: number; col: number } {
  return {
    worldRow: chunkIndex * CONSTANTS.CHUNK_ROWS + rowInChunk,
    col,
  };
}

/**
 * Check if two positions are the same
 */
export function isSamePosition(
  pos1: { chunkIndex: number; rowInChunk?: number; row?: number; col: number },
  pos2: { chunkIndex: number; rowInChunk?: number; row?: number; col: number }
): boolean {
  const row1 = pos1.rowInChunk ?? pos1.row ?? 0;
  const row2 = pos2.rowInChunk ?? pos2.row ?? 0;
  return pos1.chunkIndex === pos2.chunkIndex && row1 === row2 && pos1.col === pos2.col;
}

/**
 * Get cell type at a position
 */
export function getCellAt(
  chunks: ChunkData[],
  chunkIndex: number,
  row: number,
  col: number,
  scrollOffset: number
): number {
  const physicalIndex = (chunkIndex - scrollOffset) % CONSTANTS.MAX_CHUNKS;
  const chunk = chunks.find((c) => c.physicalIndex === physicalIndex);
  
  if (!chunk || row < 0 || row >= CONSTANTS.CHUNK_ROWS || col < 0 || col >= CONSTANTS.CHUNK_COLS) {
    return CONSTANTS.CELL_WALL; // Out of bounds = wall
  }

  return chunk.grid[row][col];
}

/**
 * Calculate next position based on direction
 */
export function getNextPosition(
  current: PlayerPosition,
  direction: number
): PlayerPosition {
  const next = { ...current };

  switch (direction) {
    case CONSTANTS.DIR_UP:
      if (next.rowInChunk > 0) {
        next.rowInChunk--;
      } else {
        next.chunkIndex--;
        next.rowInChunk = CONSTANTS.CHUNK_ROWS - 1;
      }
      break;
    case CONSTANTS.DIR_DOWN:
      if (next.rowInChunk < CONSTANTS.CHUNK_ROWS - 1) {
        next.rowInChunk++;
      } else {
        next.chunkIndex++;
        next.rowInChunk = 0;
      }
      break;
    case CONSTANTS.DIR_LEFT:
      next.col = Math.max(0, next.col - 1);
      break;
    case CONSTANTS.DIR_RIGHT:
      next.col = Math.min(CONSTANTS.CHUNK_COLS - 1, next.col + 1);
      break;
  }

  return next;
}

/**
 * Format balance for display
 */
export function formatBalance(lamports: number): string {
  const sol = lamports / 1e9;
  if (sol >= 1) {
    return `${sol.toFixed(3)} SOL`;
  } else if (sol >= 0.001) {
    return `${(sol * 1000).toFixed(1)}m SOL`;
  } else {
    return `${lamports.toLocaleString()} lamports`;
  }
}

/**
 * Get cell symbol for rendering
 */
export function getCellSymbol(cellType: number): string {
  const symbols = {
    [CONSTANTS.CELL_EMPTY]: " ",
    [CONSTANTS.CELL_WALL]: "█",
    [CONSTANTS.CELL_PELLET]: "·",
    [CONSTANTS.CELL_POWER]: "●",
  };
  return symbols[cellType] || " ";
}

/**
 * Get ghost state name
 */
export function getGhostStateName(state: number): string {
  const names = {
    [CONSTANTS.GHOST_CHASE]: "Chase",
    [CONSTANTS.GHOST_SCATTER]: "Scatter",
    [CONSTANTS.GHOST_FRIGHTENED]: "Frightened",
  };
  return names[state] || "Unknown";
}

/**
 * Calculate distance between two positions
 */
export function getDistance(
  pos1: { chunkIndex: number; rowInChunk?: number; row?: number; col: number },
  pos2: { chunkIndex: number; rowInChunk?: number; row?: number; col: number }
): number {
  const row1 = pos1.rowInChunk ?? pos1.row ?? 0;
  const row2 = pos2.rowInChunk ?? pos2.row ?? 0;
  
  const worldRow1 = pos1.chunkIndex * CONSTANTS.CHUNK_ROWS + row1;
  const worldRow2 = pos2.chunkIndex * CONSTANTS.CHUNK_ROWS + row2;
  
  return Math.abs(worldRow1 - worldRow2) + Math.abs(pos1.col - pos2.col);
}

/**
 * Check if player can eat another player
 */
export function canEatPlayer(
  eater: { isPowered: boolean },
  victim: { isPowered: boolean; dead: boolean }
): boolean {
  return eater.isPowered && !victim.isPowered && !victim.dead;
}

/**
 * Check if player can eat ghost
 */
export function canEatGhost(player: { isPowered: boolean }): boolean {
  return player.isPowered;
}

/**
 * Get leaderboard from players
 */
export function getLeaderboard(players: PlayerData[]): PlayerData[] {
  return [...players]
    .filter((p) => !p.dead)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 10);
}

/**
 * Estimate time until power pellet expires (in seconds)
 */
export function getPowerTimeRemaining(
  powerEndsAt: number,
  currentSlot: number,
  slotTime: number = 0.4
): number {
  const slotsRemaining = Math.max(0, powerEndsAt - currentSlot);
  return slotsRemaining * slotTime;
}

/**
 * Create a game loop subscription
 */
export function createGameLoop(
  client: PacRoyaleClient,
  playerAuthority: PublicKey,
  onUpdate: (state: GameState) => void,
  intervalMs: number = 100
): () => void {
  let running = true;

  const loop = async () => {
    while (running) {
      try {
        const state = await fetchGameState(client, playerAuthority);
        onUpdate(state);
      } catch (err) {
        console.error("Game loop error:", err);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  };

  loop();

  return () => {
    running = false;
  };
}

/**
 * Keyboard controls helper
 */
export function setupKeyboardControls(
  onMove: (direction: number) => void,
  onEatPellet: () => void,
  onEatGhost: () => void,
  onCashOut: () => void
): () => void {
  const handleKeyDown = (event: KeyboardEvent) => {
    switch (event.key) {
      case "ArrowUp":
      case "w":
      case "W":
        onMove(CONSTANTS.DIR_UP);
        break;
      case "ArrowDown":
      case "s":
      case "S":
        onMove(CONSTANTS.DIR_DOWN);
        break;
      case "ArrowLeft":
      case "a":
      case "A":
        onMove(CONSTANTS.DIR_LEFT);
        break;
      case "ArrowRight":
      case "d":
      case "D":
        onMove(CONSTANTS.DIR_RIGHT);
        break;
      case "e":
      case "E":
        onEatPellet();
        break;
      case "g":
      case "G":
        onEatGhost();
        break;
      case "c":
      case "C":
        onCashOut();
        break;
    }
  };

  window.addEventListener("keydown", handleKeyDown);

  return () => {
    window.removeEventListener("keydown", handleKeyDown);
  };
}
