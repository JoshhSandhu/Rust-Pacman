import * as PIXI from 'pixi.js';
import { CELL_SIZE } from './camera';
import { DIR_UP, DIR_DOWN, DIR_LEFT, DIR_RIGHT } from '../state/gameStore';

// Ghost colors matching classic Pac-Man
export const GHOST_COLORS: Record<number, number> = {
  0: 0xFF0000, // Blinky - red
  1: 0xFFB8FF, // Pinky - pink
  2: 0x00FFFF, // Inky - cyan
  3: 0xFFB852, // Clyde - orange
};

export const GHOST_FRIGHTENED_COLOR = 0x2121DE;

// --- Pac-Man Entity ---
export function createPacMan(): PIXI.Container {
  const container = new PIXI.Container();

  // Glow (index 0)
  const glow = new PIXI.Graphics();
  glow.beginFill(0xFFE600, 0.15);
  glow.drawCircle(0, 0, CELL_SIZE * 0.7);
  glow.endFill();
  container.addChild(glow);

  // Body (index 1)
  const body = new PIXI.Graphics();
  body.beginFill(0xFFE600);
  body.drawCircle(0, 0, CELL_SIZE * 0.4);
  body.endFill();
  container.addChild(body);

  // Mouth (index 2 — animated via update)
  const mouth = new PIXI.Graphics();
  container.addChild(mouth);

  // Eye (index 3)
  const eye = new PIXI.Graphics();
  eye.beginFill(0x000000);
  eye.drawCircle(3, -6, 3);
  eye.endFill();
  container.addChild(eye);

  return container;
}

export function updatePacMan(
  container: PIXI.Container,
  direction: number,
  time: number,
): void {
  switch (direction) {
    case DIR_UP: container.rotation = -Math.PI / 2; break;
    case DIR_DOWN: container.rotation = Math.PI / 2; break;
    case DIR_LEFT: container.rotation = Math.PI; break;
    case DIR_RIGHT: container.rotation = 0; break;
  }

  // Animate mouth (index 2)
  const mouth = container.children[2] as PIXI.Graphics;
  if (mouth) {
    const mouthAngle = Math.abs(Math.sin(time * 8)) * 0.6 + 0.1;
    mouth.clear();
    mouth.beginFill(0x0a0a1a);
    mouth.moveTo(0, 0);
    mouth.arc(0, 0, CELL_SIZE * 0.42, -mouthAngle, mouthAngle);
    mouth.lineTo(0, 0);
    mouth.endFill();
  }

  // Animate glow pulse (index 0)
  const glow = container.children[0] as PIXI.Graphics;
  if (glow) {
    const pulse = 0.8 + Math.sin(time * 3) * 0.2;
    glow.alpha = 0.15 * pulse;
    glow.scale.set(pulse);
  }
}

// --- Ghost Entity ---
export function createGhost(ghostId: number): PIXI.Container {
  const container = new PIXI.Container();
  const color = GHOST_COLORS[ghostId] ?? 0xFF0000;

  // Glow (index 0)
  const glow = new PIXI.Graphics();
  glow.beginFill(color, 0.1);
  glow.drawCircle(0, 0, CELL_SIZE * 0.6);
  glow.endFill();
  container.addChild(glow);

  // Body (index 1)
  const body = new PIXI.Graphics();
  body.beginFill(color);
  body.moveTo(-CELL_SIZE * 0.35, CELL_SIZE * 0.3);
  body.lineTo(-CELL_SIZE * 0.35, -CELL_SIZE * 0.1);
  body.arc(0, -CELL_SIZE * 0.1, CELL_SIZE * 0.35, Math.PI, 0);
  body.lineTo(CELL_SIZE * 0.35, CELL_SIZE * 0.3);
  const w = CELL_SIZE * 0.7;
  const segments = 3;
  const segW = w / segments;
  for (let i = 0; i < segments; i++) {
    const x = CELL_SIZE * 0.35 - i * segW;
    body.lineTo(x - segW / 2, CELL_SIZE * 0.2);
    body.lineTo(x - segW, CELL_SIZE * 0.3);
  }
  body.closePath();
  body.endFill();
  container.addChild(body);

  // Eyes
  for (const xOff of [-6, 6]) {
    const eyeWhite = new PIXI.Graphics();
    eyeWhite.beginFill(0xFFFFFF);
    eyeWhite.drawEllipse(xOff, -CELL_SIZE * 0.1, 5, 6);
    eyeWhite.endFill();
    container.addChild(eyeWhite);

    const pupil = new PIXI.Graphics();
    pupil.beginFill(0x000088);
    pupil.drawCircle(xOff + 1, -CELL_SIZE * 0.08, 3);
    pupil.endFill();
    container.addChild(pupil);
  }

  // ✅ Store the initial _baseY on the container so the float animation
  // applies a relative offset rather than accumulating permanently.
  (container as any)._baseY = 0;

  return container;
}

// --- Pellet ---
export function createPellet(): PIXI.Graphics {
  const g = new PIXI.Graphics();
  // Inner dot
  g.beginFill(0xFFE600);
  g.drawCircle(0, 0, 3);
  g.endFill();
  // Outer glow
  g.beginFill(0xFFE600, 0.2);
  g.drawCircle(0, 0, 6);
  g.endFill();
  return g;
}

// --- Power Pellet ---
export function createPowerPellet(): PIXI.Graphics {
  const g = new PIXI.Graphics();
  // Core
  g.beginFill(0xFFE600);
  g.drawCircle(0, 0, 7);
  g.endFill();
  // Middle glow
  g.beginFill(0xFFE600, 0.35);
  g.drawCircle(0, 0, 11);
  g.endFill();
  // Outer glow
  g.beginFill(0xFFE600, 0.1);
  g.drawCircle(0, 0, 16);
  g.endFill();
  return g;
}

export function updatePowerPellet(g: PIXI.Graphics, time: number): void {
  const pulse = 0.7 + Math.sin(time * 4) * 0.3;
  g.scale.set(pulse);
  g.alpha = 0.7 + Math.sin(time * 3) * 0.3;
}

export function updateGhost(
  container: PIXI.Container,
  time: number,
  frightened: boolean,
  ghostId: number,
): void {
  // ✅ FIXED: Float animation now reads _baseY and applies offset WITHOUT mutation.
  // Old code: `container.y += Math.sin(...) * 0.3` accumulated every frame → jitter.
  const baseY = (container as any)._baseY ?? container.y;
  container.y = baseY + Math.sin(time * 2 + ghostId * 1.5) * 2.5;

  // Frightened mode: turn blue
  const body = container.children[1] as PIXI.Graphics;
  if (frightened && body) {
    body.tint = GHOST_FRIGHTENED_COLOR;
  } else if (body) {
    body.tint = 0xFFFFFF;
  }
}
