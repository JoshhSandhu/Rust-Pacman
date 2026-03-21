/**
 * sessionManager.ts — Ephemeral session key lifecycle for ER gameplay.
 *
 * Flow:
 *  1. createSession(program, walletPublicKey) — generates Keypair, calls set_session_key (Phantom signs once)
 *  2. All gameplay txns signed by session Keypair via getSessionKeypair()
 *  3. destroySession(program) — calls set_session_key(null), clears storage
 *
 * Security:
 *  - sessionStorage is tab-scoped (cleared on tab close)
 *  - 30-minute TTL enforced client-side
 *  - Session key cannot call cash_out (program enforces Phantom authority there)
 */

import { Keypair, PublicKey } from '@solana/web3.js';
import { Program } from '@coral-xyz/anchor';
import { sendSetSessionKey } from './transactions';
import { createErProgramWithWallet } from './erClient';

const SESSION_STORAGE_KEY = 'pac_royale_session';
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface StoredSession {
    secretKey: number[];  // Uint8Array as number[] (JSON serializable)
    publicKey: string;
    phantomAuthority: string;
    expiresAt: number;
}

let _activeSession: Keypair | null = null;
let _phantomAuthority: PublicKey | null = null;

// ────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────

/**
 * Creates a session key and registers it on-chain via set_session_key.
 * Phantom signs one transaction. After this, all gameplay txns use the
 * returned Keypair — zero Phantom popups until session expires.
 */
export async function createSession(
    l1Program: Program,
    walletPublicKey: PublicKey,
): Promise<Keypair> {
    // 1. Generate ephemeral keypair
    const sessionKeypair = Keypair.generate();

    // 2. Register on-chain (Phantom signs this one time)
    await registerSessionKey(l1Program, walletPublicKey, sessionKeypair.publicKey);

    // 3. Persist to sessionStorage (tab-scoped)
    const stored: StoredSession = {
        secretKey: Array.from(sessionKeypair.secretKey),
        publicKey: sessionKeypair.publicKey.toBase58(),
        phantomAuthority: walletPublicKey.toBase58(),
        expiresAt: Date.now() + SESSION_TTL_MS,
    };
    try {
        sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(stored));
    } catch {
        // sessionStorage unavailable (e.g., private browsing) — keep in memory only
    }

    _activeSession = sessionKeypair;
    _phantomAuthority = walletPublicKey;

    console.log('[Session] Created session key:', sessionKeypair.publicKey.toBase58(), '(expires in 30min)');
    return sessionKeypair;
}

/**
 * Loads an existing valid session from sessionStorage, if available.
 * Call this on page load to resume without a popup if session hasn't expired.
 */
export function loadStoredSession(expectedAuthority?: PublicKey): Keypair | null {
    try {
        const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (!raw) return null;
        const stored: StoredSession = JSON.parse(raw);
        if (Date.now() > stored.expiresAt) {
            sessionStorage.removeItem(SESSION_STORAGE_KEY);
            _activeSession = null;
            _phantomAuthority = null;
            return null;
        }
        if (
            expectedAuthority &&
            stored.phantomAuthority !== expectedAuthority.toBase58()
        ) {
            sessionStorage.removeItem(SESSION_STORAGE_KEY);
            _activeSession = null;
            _phantomAuthority = null;
            return null;
        }
        const keypair = Keypair.fromSecretKey(Uint8Array.from(stored.secretKey));
        _activeSession = keypair;
        _phantomAuthority = new PublicKey(stored.phantomAuthority);
        console.log('[Session] Resumed session:', keypair.publicKey.toBase58());
        return keypair;
    } catch {
        return null;
    }
}

/**
 * Returns the active session Keypair, or null if not set / expired.
 */
export function getSessionKeypair(): Keypair | null {
    if (!_activeSession) return null;
    // TTL check from sessionStorage
    try {
        const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (raw) {
            const stored: StoredSession = JSON.parse(raw);
            if (Date.now() > stored.expiresAt) {
                _activeSession = null;
                return null;
            }
        }
    } catch {
        // ignore
    }
    return _activeSession;
}

/** Returns the Phantom wallet that authorized this session. */
export function getSessionPhantomAuthority(): PublicKey | null {
    return _phantomAuthority;
}

/** True if session exists and hasn't expired. */
export function isSessionValid(): boolean {
    return getSessionKeypair() !== null;
}

/**
 * Destroys the session: clears the on-chain session key (set to null)
 * and removes from sessionStorage. Call on disconnect / cash-out.
 */
export async function destroySession(
    l1Program: Program,
    walletPublicKey: PublicKey,
): Promise<void> {
    try {
        await registerSessionKey(l1Program, walletPublicKey, null);
    } catch (err) {
        console.warn('[Session] Failed to clear on-chain session key:', err);
    }
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    _activeSession = null;
    _phantomAuthority = null;
    console.log('[Session] Session destroyed');
}

// ────────────────────────────────────────────────────────────────
// Internal helper
// ────────────────────────────────────────────────────────────────

async function registerSessionKey(
    l1Program: Program,
    walletPublicKey: PublicKey,
    sessionKeyPubkey: PublicKey | null,
): Promise<string> {
    try {
        return await sendSetSessionKey(l1Program, walletPublicKey, sessionKeyPubkey);
    } catch (err) {
        const message = String(err);
        const delegatedPlayer =
            message.includes("AccountOwnedByWrongProgram") ||
            message.includes("Error Number: 3007") ||
            message.includes("custom program error: 0xbbf");

        if (!delegatedPlayer) {
            throw err;
        }

        const wallet = (l1Program.provider as any).wallet;
        const erProgram = createErProgramWithWallet(wallet);
        return await sendSetSessionKey(erProgram, walletPublicKey, sessionKeyPubkey);
    }
}
