import { useGameStore, DIR_UP, DIR_DOWN, DIR_LEFT, DIR_RIGHT } from '../state/gameStore';

export type DirectionKey = typeof DIR_UP | typeof DIR_DOWN | typeof DIR_LEFT | typeof DIR_RIGHT;

type MoveCallback = (direction: DirectionKey) => void;

const KEY_MAP: Record<string, DirectionKey> = {
  ArrowUp: DIR_UP,
  ArrowDown: DIR_DOWN,
  ArrowLeft: DIR_LEFT,
  ArrowRight: DIR_RIGHT,
  w: DIR_UP,
  W: DIR_UP,
  s: DIR_DOWN,
  S: DIR_DOWN,
  a: DIR_LEFT,
  A: DIR_LEFT,
  d: DIR_RIGHT,
  D: DIR_RIGHT,
};

const MOVE_DEBOUNCE_MS = 320;

let lastMoveTime = 0;
let keydownHandler: ((e: KeyboardEvent) => void) | null = null;
let keyupHandler: ((e: KeyboardEvent) => void) | null = null;
let pendingDirection: DirectionKey | null = null;
let repeatTimer: ReturnType<typeof setInterval> | null = null;

export function initControls(onMove: MoveCallback): void {
  destroyControls();

  keydownHandler = (e: KeyboardEvent) => {
    const dir = KEY_MAP[e.key];
    if (dir === undefined) return;
    e.preventDefault();
    if (e.repeat) return;

    const store = useGameStore.getState();
    if (!store.gameStarted || !store.player || store.player.dead) return;

    store.setLastDirection(dir);
    pendingDirection = dir;

    const now = Date.now();
    if (now - lastMoveTime >= MOVE_DEBOUNCE_MS) {
      lastMoveTime = now;
      onMove(dir);
    }
  };

  window.addEventListener('keydown', keydownHandler);

  // Repeat movement while key is held
  repeatTimer = setInterval(() => {
    if (pendingDirection !== null) {
      const now = Date.now();
      if (now - lastMoveTime >= MOVE_DEBOUNCE_MS) {
        lastMoveTime = now;
        const store = useGameStore.getState();
        if (store.gameStarted && store.player && !store.player.dead) {
          onMove(pendingDirection);
        }
      }
    }
  }, 50);

  keyupHandler = (e: KeyboardEvent) => {
    const dir = KEY_MAP[e.key];
    if (dir !== undefined && dir === pendingDirection) {
      pendingDirection = null;
    }
  };
  window.addEventListener('keyup', keyupHandler);
}

export function destroyControls(): void {
  if (keydownHandler) {
    window.removeEventListener('keydown', keydownHandler);
    keydownHandler = null;
  }
  if (keyupHandler) {
    window.removeEventListener('keyup', keyupHandler);
    keyupHandler = null;
  }
  if (repeatTimer) {
    clearInterval(repeatTimer);
    repeatTimer = null;
  }
  pendingDirection = null;
}
