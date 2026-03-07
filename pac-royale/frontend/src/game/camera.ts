import { CHUNK_ROWS, CHUNK_COLS } from '../state/gameStore';

export const CELL_SIZE = 32;
export const CHUNK_WIDTH = CHUNK_COLS * CELL_SIZE;  // 320px
export const CHUNK_HEIGHT = CHUNK_ROWS * CELL_SIZE; // 192px

// Slight perspective tilt constants
export const PERSPECTIVE_SKEW_X = 0.0;
export const PERSPECTIVE_SKEW_Y = -0.08; // ~5 degree tilt
export const PERSPECTIVE_SCALE_Y = 0.92;  // Slight vertical compression for depth

export interface CameraState {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  zoom: number;
}

export function createCamera(): CameraState {
  return { x: 0, y: 0, targetX: 0, targetY: 0, zoom: 1.0 };
}

export function updateCamera(
  cam: CameraState,
  playerChunkIndex: number,
  playerRow: number,
  playerCol: number,
  scrollOffset: number,
  screenWidth: number,
  screenHeight: number,
  dt: number,
): void {
  // Convert player world position to pixel coordinates
  // Each chunk stacks vertically; chunk 0 is at top
  const relativeChunk = playerChunkIndex - scrollOffset;
  const worldX = playerCol * CELL_SIZE + CELL_SIZE / 2;
  const worldY = relativeChunk * CHUNK_HEIGHT + playerRow * CELL_SIZE + CELL_SIZE / 2;

  cam.targetX = screenWidth / 2 - worldX * cam.zoom;
  cam.targetY = screenHeight / 2 - worldY * cam.zoom;

  // Smooth lerp
  const lerpSpeed = 1 - Math.pow(0.001, dt);
  cam.x += (cam.targetX - cam.x) * lerpSpeed;
  cam.y += (cam.targetY - cam.y) * lerpSpeed;
}

export function worldToScreen(
  cam: CameraState,
  worldX: number,
  worldY: number,
): { sx: number; sy: number } {
  return {
    sx: worldX * cam.zoom + cam.x,
    sy: worldY * cam.zoom + cam.y,
  };
}
