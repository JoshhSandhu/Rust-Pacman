/**
 * controls.ts — Keyboard input handler using InputQueue for ER transaction safety.
 *
 * Debounce target: 80ms (~12 moves/sec). Movement is queued (max depth 2) so
 * keypresses while a move is in-flight are buffered, not dropped entirely.
 * The move callback should call sendMovementEr() (no Phantom popup) when
 * a session is active, or sendMovement() as fallback.
 */
import {
  useGameStore,
  DIR_UP,
  DIR_DOWN,
  DIR_LEFT,
  DIR_RIGHT,
} from "../state/gameStore";
import { InputQueue, type DirectionValue } from "./inputQueue";

export type DirectionKey =
  | typeof DIR_UP
  | typeof DIR_DOWN
  | typeof DIR_LEFT
  | typeof DIR_RIGHT;

type MoveCallback = (direction: DirectionKey) => Promise<void> | void;

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

// ✅ Reduced from 320ms to 80ms for snappy ER gameplay
const MOVE_REPEAT_INTERVAL_MS = 80;

let keydownHandler: ((e: KeyboardEvent) => void) | null = null;
let keyupHandler: ((e: KeyboardEvent) => void) | null = null;
let repeatTimer: ReturnType<typeof setInterval> | null = null;
let pendingDirection: DirectionKey | null = null;
let inputQueue: InputQueue | null = null;
let unsubscribePlayerState: (() => void) | null = null;

/**
 * Initialize keyboard controls. onMove is called with each dequeued direction.
 * When using ER, pass an async function; the InputQueue ensures no overlapping txns.
 */
export function initControls(onMove: MoveCallback): void {
  destroyControls();

  // Wrap the callback in an InputQueue for safe ER serialization
  inputQueue = new InputQueue(async (dir: DirectionValue) => {
    await onMove(dir);
  });

  unsubscribePlayerState = useGameStore.subscribe((state, prevState) => {
    const wasDead = prevState.player?.dead ?? false;
    const isDead = state.player?.dead ?? false;
    if (!wasDead && isDead) {
      inputQueue?.clear();
      pendingDirection = null;
    }
  });

  keydownHandler = (e: KeyboardEvent) => {
    const dir = KEY_MAP[e.key];
    if (dir === undefined) return;
    e.preventDefault();
    if (e.repeat) return; // handled by our own repeat timer

    const store = useGameStore.getState();
    if (!store.gameStarted || !store.player || store.player.dead) return;

    store.setLastDirection(dir);
    pendingDirection = dir;
    inputQueue!.enqueue(dir);
  };

  window.addEventListener("keydown", keydownHandler);

  // Key-hold repeat at MOVE_REPEAT_INTERVAL_MS
  repeatTimer = setInterval(() => {
    if (pendingDirection === null) return;
    const store = useGameStore.getState();
    if (!store.gameStarted || !store.player || store.player.dead) return;
    inputQueue!.replaceOrEnqueue(pendingDirection);
  }, MOVE_REPEAT_INTERVAL_MS);

  keyupHandler = (e: KeyboardEvent) => {
    const dir = KEY_MAP[e.key];
    if (dir !== undefined && dir === pendingDirection) {
      pendingDirection = null;
    }
  };
  window.addEventListener("keyup", keyupHandler);
}

export function destroyControls(): void {
  if (keydownHandler) {
    window.removeEventListener("keydown", keydownHandler);
    keydownHandler = null;
  }
  if (keyupHandler) {
    window.removeEventListener("keyup", keyupHandler);
    keyupHandler = null;
  }
  if (repeatTimer) {
    clearInterval(repeatTimer);
    repeatTimer = null;
  }
  if (unsubscribePlayerState) {
    unsubscribePlayerState();
    unsubscribePlayerState = null;
  }
  if (inputQueue) {
    inputQueue.clear();
    inputQueue = null;
  }
  pendingDirection = null;
}
