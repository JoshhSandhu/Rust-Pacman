import * as PIXI from 'pixi.js';
import {
  useGameStore,
  CHUNK_ROWS,
  CHUNK_COLS,
  MAX_CHUNKS,
  CELL_WALL,
  CELL_PELLET,
  CELL_POWER,
  ChunkState,
} from '../state/gameStore';
import {
  CameraState,
  createCamera,
  updateCamera,
  CELL_SIZE,
  CHUNK_HEIGHT,
  CHUNK_WIDTH,
  PERSPECTIVE_SKEW_Y,
  PERSPECTIVE_SCALE_Y,
} from './camera';
import {
  createPacMan,
  updatePacMan,
  createGhost,
  updateGhost,
  createPellet,
  createPowerPellet,
  updatePowerPellet,
} from './entities';
import { drawNeonWall, getWallNeighbors, createScoreText, drawGridOverlay } from './effects';

export interface GameRenderer {
  app: PIXI.Application;
  camera: CameraState;
  destroy: () => void;
}

interface RenderState {
  worldContainer: PIXI.Container;
  mazeGraphics: PIXI.Graphics;
  pelletContainer: PIXI.Container;
  entityContainer: PIXI.Container;
  uiContainer: PIXI.Container;
  gridOverlay: PIXI.Graphics;
  hazardContainer: PIXI.Container;
  hazardGraphics: PIXI.Graphics;
  boundaryLines: PIXI.Graphics;

  pacman: PIXI.Container;
  ghostSprites: Map<number, PIXI.Container>;
  otherPlayerSprites: Map<string, PIXI.Graphics>;
  pelletSprites: Map<string, PIXI.Graphics>;
  powerPelletSprites: Map<string, PIXI.Graphics>;
  scoreTexts: Map<number, PIXI.Text>;

  lastChunkHash: string;
  lastPowered: boolean;
}

function createRenderState(app: PIXI.Application): RenderState {
  const worldContainer = new PIXI.Container();
  worldContainer.sortableChildren = true;

  worldContainer.skew.set(0, PERSPECTIVE_SKEW_Y);
  worldContainer.scale.set(1, PERSPECTIVE_SCALE_Y);

  const mazeGraphics = new PIXI.Graphics();
  mazeGraphics.zIndex = 0;

  const gridOverlay = new PIXI.Graphics();
  gridOverlay.zIndex = -1;

  const pelletContainer = new PIXI.Container();
  pelletContainer.zIndex = 1;

  const entityContainer = new PIXI.Container();
  entityContainer.zIndex = 2;

  const hazardContainer = new PIXI.Container();
  hazardContainer.zIndex = 3;
  const hazardGraphics = new PIXI.Graphics();
  hazardContainer.addChild(hazardGraphics);

  // ✅ NEW: Boundary line graphics (sits above hazard layer)
  const boundaryLines = new PIXI.Graphics();
  boundaryLines.zIndex = 4;

  const uiContainer = new PIXI.Container();
  uiContainer.zIndex = 10;

  worldContainer.addChild(gridOverlay);
  worldContainer.addChild(mazeGraphics);
  worldContainer.addChild(pelletContainer);
  worldContainer.addChild(entityContainer);
  worldContainer.addChild(hazardContainer);
  worldContainer.addChild(boundaryLines);

  app.stage.addChild(worldContainer);
  app.stage.addChild(uiContainer);

  const pacman = createPacMan();
  entityContainer.addChild(pacman);

  return {
    worldContainer,
    mazeGraphics,
    pelletContainer,
    entityContainer,
    uiContainer,
    gridOverlay,
    hazardContainer,
    hazardGraphics,
    boundaryLines,
    pacman,
    ghostSprites: new Map(),
    otherPlayerSprites: new Map(),
    pelletSprites: new Map(),
    powerPelletSprites: new Map(),
    scoreTexts: new Map(),
    lastChunkHash: '',
    lastPowered: false,
  };
}

function buildChunkHash(chunks: Map<number, ChunkState>): string {
  let hash = '';
  const keys = Array.from(chunks.keys()).sort((a, b) => a - b);
  for (const idx of keys) {
    const chunk = chunks.get(idx);
    if (!chunk) continue;
    const gridHash = chunk.grid.map((row) => row.join('')).join('|');
    hash += `${idx}:${chunk.logicalIndex}:${chunk.templateId}:${gridHash};`;
  }
  return hash;
}

function createOtherPlayerSprite(): PIXI.Graphics {
  const g = new PIXI.Graphics();
  g.beginFill(0x39ff14, 0.95);
  g.drawCircle(0, 0, CELL_SIZE * 0.3);
  g.endFill();
  g.beginFill(0x39ff14, 0.2);
  g.drawCircle(0, 0, CELL_SIZE * 0.52);
  g.endFill();
  return g;
}

function renderMaze(state: RenderState, isPowered: boolean): void {
  const store = useGameStore.getState();
  const { chunks, world } = store;
  if (!world) return;

  const scrollOffset = world.scrollOffset;
  const chunkHash = buildChunkHash(chunks);

  if (chunkHash === state.lastChunkHash && isPowered === state.lastPowered) return;
  state.lastChunkHash = chunkHash;
  state.lastPowered = isPowered;

  state.mazeGraphics.clear();
  for (const child of state.pelletContainer.removeChildren()) {
    child.destroy();
  }
  state.pelletSprites.clear();
  state.powerPelletSprites.clear();

  const totalHeight = MAX_CHUNKS * CHUNK_HEIGHT;
  state.gridOverlay.clear();
  drawGridOverlay(state.gridOverlay, CHUNK_WIDTH, totalHeight);

  chunks.forEach((chunk, physicalIndex) => {
    const relativeIndex = chunk.logicalIndex - scrollOffset;
    if (relativeIndex < -2 || relativeIndex > MAX_CHUNKS + 2) return;

    const chunkY = relativeIndex * CHUNK_HEIGHT;

    for (let row = 0; row < CHUNK_ROWS; row++) {
      for (let col = 0; col < CHUNK_COLS; col++) {
        const cell = chunk.grid[row]?.[col] ?? 0;
        const px = col * CELL_SIZE;
        const py = chunkY + row * CELL_SIZE;

        if (cell === CELL_WALL) {
          const neighbors = getWallNeighbors(chunk.grid, row, col, CHUNK_ROWS, CHUNK_COLS);
          drawNeonWall(state.mazeGraphics, px, py, neighbors, isPowered);
        } else if (cell === CELL_PELLET) {
          const key = `${physicalIndex}_${row}_${col}`;
          const pellet = createPellet();
          pellet.x = px + CELL_SIZE / 2;
          pellet.y = py + CELL_SIZE / 2;
          state.pelletContainer.addChild(pellet);
          state.pelletSprites.set(key, pellet);
        } else if (cell === CELL_POWER) {
          const key = `${physicalIndex}_${row}_${col}`;
          const power = createPowerPellet();
          power.x = px + CELL_SIZE / 2;
          power.y = py + CELL_SIZE / 2;
          state.pelletContainer.addChild(power);
          state.powerPelletSprites.set(key, power);
        }
      }
    }
  });
}

// ✅ REWRITTEN: Uses store bottomBoundary / topBoundary + destroyedChunks for proper BR system
function renderHazardZones(state: RenderState, scrollOffset: number, time: number): void {
  state.hazardGraphics.clear();
  state.boundaryLines.clear();

  const store = useGameStore.getState();
  const { bottomBoundary, topBoundary, destroyedChunks } = store;

  store.chunks.forEach((chunk) => {
    const logIdx = chunk.logicalIndex;
    const relativeIndex = logIdx - scrollOffset;
    if (relativeIndex < -2 || relativeIndex > MAX_CHUNKS + 2) return;

    const chunkY = relativeIndex * CHUNK_HEIGHT;
    const isHazard = logIdx < bottomBoundary || logIdx > topBoundary;
    const isDestroyed = destroyedChunks.has(logIdx);

    if (isHazard || isDestroyed) {
      const g = state.hazardGraphics;

      if (isDestroyed) {
        // Fully destroyed chunk: deep red + high-frequency glitch flicker
        const flicker = Math.random() > 0.3 ? 1 : 0;
        g.beginFill(0xFF0000, 0.6 * flicker);
        g.drawRect(0, chunkY, CHUNK_WIDTH, CHUNK_HEIGHT);
        g.endFill();
        // Dissolve scanlines
        g.lineStyle(1, 0xFF3300, 0.7);
        for (let y = chunkY; y < chunkY + CHUNK_HEIGHT; y += 4) {
          if (Math.random() > 0.5) {
            g.moveTo(0, y);
            g.lineTo(CHUNK_WIDTH * Math.random(), y);
          }
        }
      } else {
        // Hazard zone: pulsing red overlay
        const pulseAlpha = 0.20 + Math.sin(time * 12 + logIdx * 2) * 0.12;
        g.beginFill(0xFF0000, pulseAlpha);
        g.drawRect(0, chunkY, CHUNK_WIDTH, CHUNK_HEIGHT);
        g.endFill();

        // Vertical stripes for danger feel
        g.lineStyle(1, 0xFF0000, 0.3);
        for (let x = 0; x < CHUNK_WIDTH; x += 16) {
          g.moveTo(x, chunkY);
          g.lineTo(x, chunkY + CHUNK_HEIGHT);
        }
        g.lineStyle(0);
      }
    }
  });

  // ✅ Draw bright boundary lines at the safe/hazard edge
  const drawBoundaryAt = (logIdx: number) => {
    const relativeIndex = logIdx - scrollOffset;
    if (relativeIndex < -2 || relativeIndex > MAX_CHUNKS + 2) return;
    const chunkY = relativeIndex * CHUNK_HEIGHT;
    state.boundaryLines.lineStyle(3, 0xFF2200, 0.9 + Math.sin(time * 8) * 0.1);
    state.boundaryLines.moveTo(0, chunkY);
    state.boundaryLines.lineTo(CHUNK_WIDTH, chunkY);
    state.boundaryLines.lineStyle(0);
  };

  // Bottom boundary: draw line at top edge of bottomBoundary chunk
  drawBoundaryAt(bottomBoundary);
  // Top boundary: draw line at bottom edge of topBoundary chunk
  drawBoundaryAt(topBoundary + 1);
}

function renderEntities(state: RenderState, time: number): void {
  const store = useGameStore.getState();
  const {
    player,
    ghosts,
    world,
    isPowered,
    otherPlayers,
    bottomBoundary,
    topBoundary,
    currentSlot,
    demoMode,
  } = store;
  if (!world || !player) {
    state.pacman.visible = false;
    return;
  }

  const scrollOffset = world.scrollOffset;
  const dt = 1 / 60;

  const lerp = (start: number, end: number, amt: number) => start + (end - start) * amt;
  const lerpSpeed = 1 - Math.pow(0.005, dt);

  // Pac-Man position
  if (!player.dead) {
    state.pacman.visible = true;
    const relChunk = player.chunkIndex - scrollOffset;

    const pacmanHazard = player.chunkIndex < bottomBoundary || player.chunkIndex > topBoundary;
    if (pacmanHazard) {
      state.pacman.alpha = 0.5 + Math.sin(time * 20) * 0.5;
      (state.pacman.children[1] as PIXI.Graphics).tint = 0xFF0000;
    } else {
      state.pacman.alpha = 1;
      (state.pacman.children[1] as PIXI.Graphics).tint = 0xFFFFFF;
    }

    const targetX = player.col * CELL_SIZE + CELL_SIZE / 2;
    const targetY = relChunk * CHUNK_HEIGHT + player.rowInChunk * CELL_SIZE + CELL_SIZE / 2;

    // Snap on initial placement or respawn teleport
    if (
      state.pacman.x === 0 && state.pacman.y === 0 ||
      Math.abs(state.pacman.x - targetX) > CELL_SIZE * 3 ||
      Math.abs(state.pacman.y - targetY) > CHUNK_HEIGHT
    ) {
      state.pacman.x = targetX;
      state.pacman.y = targetY;
    } else {
      state.pacman.x = lerp(state.pacman.x, targetX, lerpSpeed);
      state.pacman.y = lerp(state.pacman.y, targetY, lerpSpeed);
    }
    updatePacMan(state.pacman, player.direction, time);
  } else {
    state.pacman.visible = false;
  }

  // Ghosts
  const activeGhostIds = new Set<number>();
  for (const ghost of ghosts) {
    activeGhostIds.add(ghost.ghostId);

    let sprite = state.ghostSprites.get(ghost.ghostId);
    if (!sprite) {
      sprite = createGhost(ghost.ghostId);
      state.entityContainer.addChild(sprite);
      state.ghostSprites.set(ghost.ghostId, sprite);
    }

    const relChunk = ghost.chunkIndex - scrollOffset;
    const targetX = ghost.col * CELL_SIZE + CELL_SIZE / 2;
    const targetY = relChunk * CHUNK_HEIGHT + ghost.row * CELL_SIZE + CELL_SIZE / 2;

    // ✅ FIXED: Snap both X AND Y on initial placement (old code only checked sprite.x === 0)
    const needsSnap =
      ((sprite as any)._baseY === 0 && sprite.x === 0) ||
      Math.abs(sprite.x - targetX) > CELL_SIZE * 3 ||
      Math.abs((sprite as any)._baseY - targetY) > CHUNK_HEIGHT;

    if (needsSnap) {
      sprite.x = targetX;
      (sprite as any)._baseY = targetY;
      sprite.y = targetY;
    } else {
      sprite.x = lerp(sprite.x, targetX, lerpSpeed);
      const newBaseY = lerp((sprite as any)._baseY, targetY, lerpSpeed);
      (sprite as any)._baseY = newBaseY;
      // sprite.y is set inside updateGhost via _baseY
    }

    const ghostHazard = ghost.chunkIndex < bottomBoundary || ghost.chunkIndex > topBoundary;
    sprite.visible = !ghostHazard && relChunk >= -2 && relChunk <= MAX_CHUNKS + 2;

    updateGhost(sprite, time, isPowered, ghost.ghostId);
  }

  // Remove stale ghosts
  state.ghostSprites.forEach((sprite, id) => {
    if (!activeGhostIds.has(id)) {
      state.entityContainer.removeChild(sprite);
      sprite.destroy();
      state.ghostSprites.delete(id);
    }
  });

  // Other players
  const activeOtherPlayers = new Set<string>();
  otherPlayers.forEach((otherPlayer, key) => {
    if (otherPlayer.dead) return;
    if (
      !demoMode &&
      currentSlot > 0 &&
      currentSlot - otherPlayer.lastMoveSlot > 150
    ) {
      return;
    }
    activeOtherPlayers.add(key);

    let sprite = state.otherPlayerSprites.get(key);
    if (!sprite) {
      sprite = createOtherPlayerSprite();
      state.entityContainer.addChild(sprite);
      state.otherPlayerSprites.set(key, sprite);
    }

    const relChunk = otherPlayer.chunkIndex - scrollOffset;
    const targetX = otherPlayer.col * CELL_SIZE + CELL_SIZE / 2;
    const targetY = relChunk * CHUNK_HEIGHT + otherPlayer.rowInChunk * CELL_SIZE + CELL_SIZE / 2;

    if (sprite.x === 0 && sprite.y === 0 || Math.abs(sprite.x - targetX) > CELL_SIZE * 3) {
      sprite.x = targetX;
      sprite.y = targetY;
    } else {
      sprite.x = lerp(sprite.x, targetX, lerpSpeed);
      sprite.y = lerp(sprite.y, targetY, lerpSpeed);
    }

    sprite.visible = relChunk >= -2 && relChunk <= MAX_CHUNKS + 2;
  });

  state.otherPlayerSprites.forEach((sprite, key) => {
    if (!activeOtherPlayers.has(key)) {
      state.entityContainer.removeChild(sprite);
      sprite.destroy();
      state.otherPlayerSprites.delete(key);
    }
  });
}

function renderPowerPelletAnimations(state: RenderState, time: number): void {
  state.powerPelletSprites.forEach((sprite) => {
    updatePowerPellet(sprite, time);
  });
  state.pelletSprites.forEach((sprite) => {
    sprite.alpha = 0.85 + Math.sin(time * 2 + sprite.x * 0.01) * 0.15;
  });
}

function renderScorePopups(state: RenderState): void {
  const store = useGameStore.getState();
  const { scorePopups } = store;

  state.scoreTexts.forEach((text, id) => {
    if (!scorePopups.find((p) => p.id === id)) {
      state.uiContainer.removeChild(text);
      text.destroy();
      state.scoreTexts.delete(id);
    }
  });

  for (const popup of scorePopups) {
    let text = state.scoreTexts.get(popup.id);
    if (!text) {
      text = createScoreText(popup.text, popup.color);
      text.x = state.pacman.x;
      text.y = state.pacman.y - 20;
      state.uiContainer.addChild(text);
      state.scoreTexts.set(popup.id, text);
    }

    const age = (Date.now() - popup.createdAt) / 900;
    text.y -= 0.5;
    text.alpha = 1 - age;
    text.scale.set(1 + age * 0.5);
  }
}

// ✅ Battle royale boundary update: called each tick to advance boundaries over time
function updateBattleRoyaleBoundaries(): void {
  const store = useGameStore.getState();
  const { brStartTime, gameStarted, bottomBoundary, topBoundary } = store;
  if (!gameStarted || !brStartTime) return;

  const elapsedSec = (Date.now() - brStartTime) / 1000;
  // 1 chunk inward from each side every 30 seconds
  const shrinkStage = Math.max(0, Math.floor(elapsedSec / 30));

  const newBottom = Math.min(shrinkStage, Math.floor(MAX_CHUNKS / 2) - 1);
  const newTop = Math.max(MAX_CHUNKS - 1 - shrinkStage, Math.ceil(MAX_CHUNKS / 2));

  if (newBottom > bottomBoundary) {
    // A new chunk was destroyed from the bottom
    for (let i = bottomBoundary; i < newBottom; i++) {
      store.addDestroyedChunk(i);
    }
    store.setBottomBoundary(newBottom);
  }

  if (newTop < topBoundary) {
    // A new chunk was destroyed from the top
    for (let i = newTop + 1; i <= topBoundary; i++) {
      store.addDestroyedChunk(i);
    }
    store.setTopBoundary(newTop);
  }
}

export function createGameRenderer(canvas: HTMLCanvasElement): GameRenderer {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;

  const app = new PIXI.Application({
    view: canvas,
    width: w,
    height: h,
    backgroundColor: 0x0a0a1a,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  const camera = createCamera();
  const renderState = createRenderState(app);

  const onResize = () => {
    app.renderer.resize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);

  let startTime = performance.now();
  app.ticker.add(() => {
    const now = performance.now();
    const time = (now - startTime) / 1000;
    const dt = app.ticker.deltaMS / 1000;

    const store = useGameStore.getState();
    const { player, world, isPowered } = store;

    // Update BR boundaries each tick
    updateBattleRoyaleBoundaries();

    // Update camera
    const shrinkStage = Math.max(0, store.bottomBoundary);
    if (player && world && !player.dead) {
      updateCamera(
        camera,
        player.chunkIndex,
        player.rowInChunk,
        player.col,
        world.scrollOffset,
        app.screen.width,
        app.screen.height,
        dt,
        shrinkStage,
      );
    }

    // Apply camera
    renderState.worldContainer.x = camera.x;
    renderState.worldContainer.y = camera.y;
    renderState.worldContainer.scale.set(camera.zoom, camera.zoom * PERSPECTIVE_SCALE_Y);

    // Render layers
    renderMaze(renderState, isPowered);
    renderHazardZones(renderState, world?.scrollOffset ?? 0, time);
    renderEntities(renderState, time);
    renderPowerPelletAnimations(renderState, time);
    renderScorePopups(renderState);

    // Power mode tint
    if (isPowered) {
      app.renderer.background.color = 0x0a0520;
    } else {
      app.renderer.background.color = 0x0a0a1a;
    }
  });

  return {
    app,
    camera,
    destroy: () => {
      window.removeEventListener('resize', onResize);
      app.destroy(true, { children: true, texture: true });
    },
  };
}
