import * as PIXI from 'pixi.js';
import { CELL_SIZE } from './camera';

// Neon wall drawing colors
export const NEON_BLUE = 0x2121DE;
export const NEON_BLUE_BRIGHT = 0x00BFFF;
export const NEON_PINK = 0xFF6EC7;
export const NEON_GREEN = 0x39FF14;

// Draw a single neon wall cell with glowing edges
export function drawNeonWall(
  g: PIXI.Graphics,
  x: number,
  y: number,
  neighbors: { top: boolean; bottom: boolean; left: boolean; right: boolean },
  isPoweredMode: boolean,
): void {
  const color = isPoweredMode ? NEON_PINK : NEON_BLUE;
  const glowColor = isPoweredMode ? 0xFF6EC7 : 0x00BFFF;
  const s = CELL_SIZE;
  const inset = 2;
  const lineW = 2.5;

  // Dark fill
  g.beginFill(0x0a0a2a, 0.9);
  g.drawRect(x + inset, y + inset, s - inset * 2, s - inset * 2);
  g.endFill();

  // Outer glow (faint)
  g.lineStyle(lineW + 3, glowColor, 0.12);
  if (!neighbors.top) {
    g.moveTo(x + inset, y + inset);
    g.lineTo(x + s - inset, y + inset);
  }
  if (!neighbors.bottom) {
    g.moveTo(x + inset, y + s - inset);
    g.lineTo(x + s - inset, y + s - inset);
  }
  if (!neighbors.left) {
    g.moveTo(x + inset, y + inset);
    g.lineTo(x + inset, y + s - inset);
  }
  if (!neighbors.right) {
    g.moveTo(x + s - inset, y + inset);
    g.lineTo(x + s - inset, y + s - inset);
  }

  // Bright neon edge
  g.lineStyle(lineW, color, 0.9);
  if (!neighbors.top) {
    g.moveTo(x + inset, y + inset);
    g.lineTo(x + s - inset, y + inset);
  }
  if (!neighbors.bottom) {
    g.moveTo(x + inset, y + s - inset);
    g.lineTo(x + s - inset, y + s - inset);
  }
  if (!neighbors.left) {
    g.moveTo(x + inset, y + inset);
    g.lineTo(x + inset, y + s - inset);
  }
  if (!neighbors.right) {
    g.moveTo(x + s - inset, y + inset);
    g.lineTo(x + s - inset, y + s - inset);
  }

  g.lineStyle(0);
}

// Get wall neighbors for a cell in a grid
export function getWallNeighbors(
  grid: number[][],
  row: number,
  col: number,
  rows: number,
  cols: number,
): { top: boolean; bottom: boolean; left: boolean; right: boolean } {
  const isWall = (r: number, c: number) =>
    r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c] === 1;

  return {
    top: isWall(row - 1, col),
    bottom: isWall(row + 1, col),
    left: isWall(row, col - 1),
    right: isWall(row, col + 1),
  };
}

// Create a floating score popup text
export function createScoreText(text: string, color: string): PIXI.Text {
  const style = new PIXI.TextStyle({
    fontFamily: '"Press Start 2P", monospace',
    fontSize: 14,
    fill: color,
    dropShadow: true,
    dropShadowColor: color,
    dropShadowBlur: 8,
    dropShadowDistance: 0,
  });
  const t = new PIXI.Text(text, style);
  t.anchor.set(0.5);
  return t;
}

// Neon grid line overlay for depth
export function drawGridOverlay(g: PIXI.Graphics, width: number, height: number): void {
  g.lineStyle(0.5, NEON_BLUE, 0.04);
  for (let x = 0; x < width; x += CELL_SIZE) {
    g.moveTo(x, 0);
    g.lineTo(x, height);
  }
  for (let y = 0; y < height; y += CELL_SIZE) {
    g.moveTo(0, y);
    g.lineTo(width, y);
  }
  g.lineStyle(0);
}

// Vignette overlay for arcade feel
export function createVignetteSprite(width: number, height: number): PIXI.Graphics {
  const g = new PIXI.Graphics();
  // Radial-like vignette using concentric rects
  const steps = 20;
  for (let i = 0; i < steps; i++) {
    const alpha = (i / steps) * 0.5;
    const inset = (1 - i / steps) * Math.min(width, height) * 0.3;
    g.beginFill(0x000000, alpha);
    g.drawRect(-inset, -inset, width + inset * 2, height + inset * 2);
    g.endFill();
  }
  return g;
}
