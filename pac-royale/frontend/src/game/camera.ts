import { CHUNK_ROWS, CHUNK_COLS } from '../state/gameStore';

// ✅ FIXED: Increased from 32 → 40 so tiles occupy more screen space at default zoom
export const CELL_SIZE = 40;
export const CHUNK_WIDTH = CHUNK_COLS * CELL_SIZE;   // 400px
export const CHUNK_HEIGHT = CHUNK_ROWS * CELL_SIZE;  // 240px

// Slight perspective tilt constants — kept subtle
export const PERSPECTIVE_SKEW_X = 0.0;
export const PERSPECTIVE_SKEW_Y = -0.05;
export const PERSPECTIVE_SCALE_Y = 0.94;

export const MAX_CHUNKS = 32;

export interface CameraState {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  zoom: number;
}

// ✅ FIXED: Initial zoom is 2.5 (not 1.0 which happened because the BR formula
// divided screen height by the 32-chunk world height: 900 / (6144 * 1.05) ≈ 0.14 → clamped to 1.0)
export function createCamera(): CameraState {
  return { x: 0, y: 0, targetX: 0, targetY: 0, zoom: 2.5 };
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
  brShrinkStage: number = 0,
): void {
  // Convert player's logical chunk position to world-pixel coordinates
  const relativeChunk = playerChunkIndex - scrollOffset;
  const worldX = playerCol * CELL_SIZE + CELL_SIZE / 2;
  const worldY = relativeChunk * CHUNK_HEIGHT + playerRow * CELL_SIZE + CELL_SIZE / 2;

  // ✅ FIXED zoom logic:
  // Phase 0 (no shrink yet): keep a fixed close-up zoom so the map feels like an arcade game.
  // Phase 1+ (shrinking): dynamically zoom to keep the safe zone visible.
  let targetZoom: number;
  if (brShrinkStage === 0) {
    // Fixed close-up — player sees ~4 chunks worth of content
    const closeViewChunks = 4;
    targetZoom = screenHeight / (closeViewChunks * CHUNK_HEIGHT);
    targetZoom = Math.max(2.0, Math.min(4.0, targetZoom));
  } else {
    const safeChunks = Math.max(2, MAX_CHUNKS - 2 * brShrinkStage);
    const safeZoneHeight = safeChunks * CHUNK_HEIGHT;
    const baseZoom = screenHeight / (safeZoneHeight * 1.1);
    targetZoom = Math.max(1.2, Math.min(4.0, baseZoom));
  }

  // Smooth zoom lerp
  const zoomLerp = 1 - Math.pow(0.01, dt);
  cam.zoom += (targetZoom - cam.zoom) * zoomLerp;

  // Center camera on player
  cam.targetX = screenWidth / 2 - worldX * cam.zoom;
  cam.targetY = screenHeight / 2 - worldY * cam.zoom;

  // Snap on first frame or after large teleports so the camera starts centered.
  if (
    (cam.x === 0 && cam.y === 0) ||
    Math.abs(cam.x - cam.targetX) > screenWidth ||
    Math.abs(cam.y - cam.targetY) > screenHeight
  ) {
    cam.x = cam.targetX;
    cam.y = cam.targetY;
    return;
  }

  // Smooth position lerp — feels snappy but not instant
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
