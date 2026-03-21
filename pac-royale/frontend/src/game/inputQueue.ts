/**
 * inputQueue.ts — Serialized movement queue for ER transaction safety.
 *
 * Problem: fire-and-forget movement causes race conditions and state desync.
 * Solution: queue up to MAX_DEPTH directions; process one at a time, awaiting
 * each ER tx before sending the next. Old moves are dropped if queue fills up
 * (prevents lag accumulation).
 *
 * Usage:
 *   const queue = new InputQueue(async (dir) => sendMovementEr(erProgram, dir, phantomPk));
 *   queue.enqueue(DIR_RIGHT);
 */

export type DirectionValue = 0 | 1 | 2 | 3;

type MoveHandler = (direction: DirectionValue) => Promise<void>;

const MAX_QUEUE_DEPTH = 2; // drop old input if more than this queued

export class InputQueue {
    private pending: DirectionValue[] = [];
    private processing = false;
    private handler: MoveHandler;

    constructor(handler: MoveHandler) {
        this.handler = handler;
    }

    /** Enqueue a direction. Drops the oldest pending item if queue is full. */
    enqueue(direction: DirectionValue): void {
        if (this.pending.length >= MAX_QUEUE_DEPTH) {
            // Drop oldest to avoid lag accumulation — keep only the latest input intent
            this.pending.shift();
        }
        this.pending.push(direction);
        this._processNext();
    }

    /** Replace any pending input with this direction (useful for "hold key" repeat). */
    replaceOrEnqueue(direction: DirectionValue): void {
        if (this.processing) {
            // Only buffer one move while current is in flight
            this.pending = [direction];
        } else {
            this.enqueue(direction);
        }
    }

    private async _processNext(): Promise<void> {
        if (this.processing || this.pending.length === 0) return;
        this.processing = true;

        const direction = this.pending.shift()!;
        try {
            await this.handler(direction);
        } catch (err) {
            // Log but don't block the queue on errors (MoveTooFast, WrongChunk, etc.)
            const msg = String(err);
            // Filter common non-error ER responses
            if (
                !msg.includes('MoveTooFast') &&
                !msg.includes('PlayerDead') &&
                !msg.includes('WorldFrozen')
            ) {
                console.warn('[InputQueue] Move error:', err);
            }
        } finally {
            this.processing = false;
            // Continue processing remaining
            this._processNext();
        }
    }

    /** Clear all pending inputs (call on game end / death). */
    clear(): void {
        this.pending = [];
    }

    /** Returns true if a move is currently being processed. */
    get isProcessing(): boolean {
        return this.processing;
    }

    /** Returns current queue depth (does not include in-flight move). */
    get depth(): number {
        return this.pending.length;
    }
}
