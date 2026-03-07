import * as PIXI from 'pixi.js';
import { useGameStore, CHUNK_ROWS, CHUNK_COLS, MAX_CHUNKS, CELL_WALL, CELL_PELLET, CELL_POWER, ChunkState } from '../state/gameStore';
import { CameraState, createCamera, updateCamera, CELL_SIZE, CHUNK_HEIGHT, CHUNK_WIDTH, PERSPECTIVE_SKEW_Y, PERSPECTIVE_SCALE_Y } from './camera';
import { createPacMan, updatePacMan, createGhost, updateGhost, createPellet, createPowerPellet, updatePowerPellet } from './entities';
import { drawNeonWall, getWallNeighbors, createScoreText, drawGridOverlay } from './effects';

export interface GameRenderer {
  app: PIXI.Application;
  camera: CameraState;
  destroy: () => void;
}

// Object pools for reuse
interface RenderState {
  worldContainer: PIXI.Container;
  mazeGraphics: PIXI.Graphics;
  pelletContainer: PIXI.Container;
  entityContainer: PIXI.Container;
  uiContainer: PIXI.Container;
  gridOverlay: PIXI.Graphics;

  pacman: PIXI.Container;
  ghostSprites: Map<number, PIXI.Container>;
  pelletSprites: Map<string, PIXI.Graphics>;
  powerPelletSprites: Map<string, PIXI.Graphics>;
  scoreTexts: Map<number, PIXI.Text>;

  lastChunkHash: string;
  lastPowered: boolean;
}

function createRenderState(app: PIXI.Application): RenderState {
  const worldContainer = new PIXI.Container();
  worldContainer.sortableChildren = true;

  // Apply perspective tilt
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

  const uiContainer = new PIXI.Container();
  uiContainer.zIndex = 10;

  worldContainer.addChild(gridOverlay);
  worldContainer.addChild(mazeGraphics);
  worldContainer.addChild(pelletContainer);
  worldContainer.addChild(entityContainer);

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
    pacman,
    ghostSprites: new Map(),
    pelletSprites: new Map(),
    powerPelletSprites: new Map(),
    scoreTexts: new Map(),
    lastChunkHash: '',
    lastPowered: false,
  };
}

function buildChunkHash(chunks: Map<number, ChunkState>): string {
  let hash = '';
  chunks.forEach((chunk, idx) => {
    hash += `${idx}:${chunk.logicalIndex}:${chunk.templateId};`;
  });
  return hash;
}

function renderMaze(state: RenderState, isPowered: boolean): void {
  const store = useGameStore.getState();
  const { chunks, world } = store;
  if (!world) return;

  const scrollOffset = world.scrollOffset;
  const chunkHash = buildChunkHash(chunks);

  // Only rebuild maze if chunks changed or power state flipped
  if (chunkHash === state.lastChunkHash && isPowered === state.lastPowered) return;
  state.lastChunkHash = chunkHash;
  state.lastPowered = isPowered;

  state.mazeGraphics.clear();

  // Clear old pellets
  state.pelletContainer.removeChildren();
  state.pelletSprites.clear();
  state.powerPelletSprites.clear();

  // Total world height for grid overlay
  const totalHeight = MAX_CHUNKS * CHUNK_HEIGHT;
  state.gridOverlay.clear();
  drawGridOverlay(state.gridOverlay, CHUNK_WIDTH, totalHeight);

  // Draw each chunk
  chunks.forEach((chunk, physicalIndex) => {
    // Position: logical chunk index maps to vertical position
    const relativeIndex = chunk.logicalIndex - scrollOffset;
    if (relativeIndex < -2 || relativeIndex > MAX_CHUNKS + 2) return; // culling

    const chunkY = relativeIndex * CHUNK_HEIGHT;

    for (let row = 0; row < CHUNK_ROWS; row++) {
      for (let col = 0; col < CHUNK_COLS; col++) {
        const cell = chunk.grid[row][col];
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

function renderEntities(state: RenderState, time: number): void {
  const store = useGameStore.getState();
  const { player, ghosts, world, isPowered } = store;
  if (!world || !player) {
    state.pacman.visible = false;
    return;
  }

  const scrollOffset = world.scrollOffset;

  // Pac-Man position
  if (!player.dead) {
    state.pacman.visible = true;
    const relChunk = player.chunkIndex - scrollOffset;
    state.pacman.x = player.col * CELL_SIZE + CELL_SIZE / 2;
    state.pacman.y = relChunk * CHUNK_HEIGHT + player.rowInChunk * CELL_SIZE + CELL_SIZE / 2;
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
    sprite.x = ghost.col * CELL_SIZE + CELL_SIZE / 2;
    sprite.y = relChunk * CHUNK_HEIGHT + ghost.row * CELL_SIZE + CELL_SIZE / 2;
    sprite.visible = relChunk >= -1 && relChunk <= MAX_CHUNKS + 1;

    updateGhost(sprite, time, isPowered, ghost.ghostId);
  }

  // Remove ghosts that no longer exist
  state.ghostSprites.forEach((sprite, id) => {
    if (!activeGhostIds.has(id)) {
      state.entityContainer.removeChild(sprite);
      sprite.destroy();
      state.ghostSprites.delete(id);
    }
  });
}

function renderPowerPelletAnimations(state: RenderState, time: number): void {
  state.powerPelletSprites.forEach((sprite) => {
    updatePowerPellet(sprite, time);
  });

  // Subtle pellet pulse
  state.pelletSprites.forEach((sprite) => {
    const pulse = 0.85 + Math.sin(time * 2 + sprite.x * 0.01) * 0.15;
    sprite.alpha = pulse;
  });
}

function renderScorePopups(state: RenderState, time: number): void {
  const store = useGameStore.getState();
  const { scorePopups } = store;

  // Remove old text sprites
  state.scoreTexts.forEach((text, id) => {
    if (!scorePopups.find((p) => p.id === id)) {
      state.uiContainer.removeChild(text);
      text.destroy();
      state.scoreTexts.delete(id);
    }
  });

  // Create/update popups
  for (const popup of scorePopups) {
    let text = state.scoreTexts.get(popup.id);
    if (!text) {
      text = createScoreText(popup.text, popup.color);
      // Position near pac-man
      text.x = state.pacman.x;
      text.y = state.pacman.y - 20;
      state.uiContainer.addChild(text);
      state.scoreTexts.set(popup.id, text);
    }

    const age = (Date.now() - popup.createdAt) / 900;
    text.y -= 0.5; // float up
    text.alpha = 1 - age;
    const scale = 1 + age * 0.5;
    text.scale.set(scale);
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

  // Handle resize
  const onResize = () => {
    app.renderer.resize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);

  // Main game loop
  let startTime = performance.now();
  app.ticker.add(() => {
    const now = performance.now();
    const time = (now - startTime) / 1000;
    const dt = app.ticker.deltaMS / 1000;

    const store = useGameStore.getState();
    const { player, world, isPowered } = store;

    // Update camera
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
      );
    }

    // Apply camera to world container
    renderState.worldContainer.x = camera.x;
    renderState.worldContainer.y = camera.y;
    renderState.worldContainer.scale.set(camera.zoom, camera.zoom * PERSPECTIVE_SCALE_Y);

    // Render layers
    renderMaze(renderState, isPowered);
    renderEntities(renderState, time);
    renderPowerPelletAnimations(renderState, time);
    renderScorePopups(renderState, time);

    // Power mode background tint
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
