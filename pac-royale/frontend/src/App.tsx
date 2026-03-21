import { useMemo, useEffect, useState, useRef, useCallback } from "react";
import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
  useAnchorWallet,
  useConnection,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-wallets";
import { Keypair, PublicKey } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import {
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import "@solana/wallet-adapter-react-ui/styles.css";

import { useGameStore } from "./state/gameStore";
import { getProgram, resetProgram, DEVNET_RPC } from "./solana/anchorClient";
import {
  startPolling,
  stopPolling,
  fetchPlayerState,
  fetchGhosts,
} from "./solana/fetchState";
import {
  sendSpawnPlayer,
  sendRespawnPlayer,
  sendCashOut,
  sendMovementEr,
  sendDelegatePlayer,
} from "./solana/transactions";
import { startDemoMode, initDemoControls, stopDemoMode } from "./game/demoMode";
import {
  createSession,
  loadStoredSession,
  isSessionValid,
} from "./solana/sessionManager";
import { createErProgram, createErProgramWithWallet } from "./solana/erClient";
import { initControls, destroyControls } from "./game/controls";
import { getWorldPda, getPlayerPda } from "./solana/pda";

import GameCanvas from "./components/GameCanvas";
import HUD from "./components/HUD";
import Leaderboard from "./components/Leaderboard";
import WalletButton from "./components/WalletButton";

type RespawnChoice = "idle" | "confirm";

type DelegatePlayerMethod = {
  accounts: (accounts: Record<string, unknown>) => {
    rpc: () => Promise<string>;
  };
};

function GameRoot() {
  const wallet = useAnchorWallet();
  const { connection } = useConnection();
  const { connected, publicKey } = useWallet();

  const [l1Program, setL1Program] = useState<Program<any> | null>(null);
  const [erProgram, setErProgram] = useState<Program<any> | null>(null);
  const [demoActive, setDemoActive] = useState(false);
  const [sessionInitializing, setSessionInitializing] = useState(false);
  const [cashingOut, setCashingOut] = useState(false);
  const [respawnChoice, setRespawnChoice] = useState<RespawnChoice>("idle");

  const erProgramRef = useRef<Program<any> | null>(null);
  erProgramRef.current = erProgram;

  const store = useGameStore;
  const gameStarted = useGameStore((s) => s.gameStarted);
  const player = useGameStore((s) => s.player);
  const loading = useGameStore((s) => s.loading);
  const sessionActive = useGameStore((s) => s.sessionActive);

  const canCashOut =
    !!player && player.balanceLamports > 0 && !!l1Program && !!publicKey;

  const getPreferredReadProgram = useCallback(() => {
    return erProgramRef.current ?? l1Program;
  }, [l1Program]);

  const maybeDelegatePlayer = useCallback(
    async (prog: Program<any>, phantomPk: PublicKey) => {
      const methods = (prog.methods ?? {}) as Record<string, unknown>;
      const delegatePlayerMethod = methods.delegatePlayer as
        | DelegatePlayerMethod
        | undefined;
      if (!delegatePlayerMethod) return;

      try {
        const [worldPda] = getWorldPda();
        const [playerPda] = getPlayerPda(worldPda, phantomPk);
        await sendDelegatePlayer(prog, phantomPk, {
          buffer: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
            playerPda,
            prog.programId,
          ),
          delegationRecord: delegationRecordPdaFromDelegatedAccount(playerPda),
          delegationMetadata:
            delegationMetadataPdaFromDelegatedAccount(playerPda),
        });
      } catch (err: any) {
        const text = String(err);
        const ignorable =
          text.includes("already") ||
          text.includes("delegated") ||
          text.includes("AccountOwnedByWrongProgram") ||
          text.includes("0x0") ||
          text.includes("3007");
        if (!ignorable) {
          console.warn("[App] delegate_player hook failed:", err);
        }
      }
    },
    [],
  );

  const handleCashOut = useCallback(async () => {
    if (!l1Program || !publicKey || cashingOut) return;
    setCashingOut(true);
    store.getState().setLoading(true);
    try {
      await sendCashOut(l1Program);
      const readProgram = getPreferredReadProgram();
      if (readProgram) {
        await fetchPlayerState(readProgram, publicKey);
      }
      setRespawnChoice("idle");
    } catch (err) {
      console.error("[App] Cash out failed:", err);
    } finally {
      store.getState().setLoading(false);
      setCashingOut(false);
    }
  }, [l1Program, publicKey, cashingOut, store, getPreferredReadProgram]);

  const doRespawn = useCallback(async () => {
    if (!l1Program || !publicKey) return;
    store.getState().setLoading(true);
    try {
      let respawnProgram: Program<any> = l1Program;
      try {
        await sendRespawnPlayer(l1Program);
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
        respawnProgram = createErProgramWithWallet(wallet);
        await sendRespawnPlayer(respawnProgram);
      }

      await fetchPlayerState(erProgramRef.current ?? respawnProgram, publicKey);
      setRespawnChoice("idle");
    } catch (err) {
      console.error("Respawn failed:", err);
    } finally {
      store.getState().setLoading(false);
    }
  }, [l1Program, publicKey, store]);

  // ─── Setup program and polling on wallet connect ───────────────────────────
  useEffect(() => {
    if (!wallet || !publicKey) {
      store.getState().setConnected(false);
      store.getState().setDemoMode(false);
      store.getState().setGameStarted(false);
      store.getState().setSessionActive(false);
      store.getState().setSessionKeyPubkey(null);
      store.getState().setOtherPlayers(new Map());
      resetProgram();
      stopPolling();
      stopDemoMode();
      destroyControls();
      setDemoActive(false);
      setL1Program(null);
      setErProgram(null);
      setRespawnChoice("idle");
      return;
    }

    const prog = getProgram(wallet, connection);
    setL1Program(prog);
    store.getState().setConnected(true);
    store.getState().setDemoMode(false);

    const storedKeypair = loadStoredSession(publicKey);
    if (storedKeypair && isSessionValid()) {
      const erProg = createErProgram(storedKeypair);
      setErProgram(erProg);
      store.getState().setSessionActive(true);
      store.getState().setSessionKeyPubkey(storedKeypair.publicKey);
      startPolling(prog, connection, publicKey, erProg);
    } else {
      startPolling(prog, connection, publicKey);
    }

    return () => {
      stopPolling();
      destroyControls();
    };
  }, [wallet, publicKey, connection, store]);

  // ─── Auto-spawn + create session ──────────────────────────────────────────
  useEffect(() => {
    if (!l1Program || !publicKey || !connected) return;

    const checkAndSetup = async () => {
      await fetchPlayerState(l1Program, publicKey);
      let currentPlayer = store.getState().player;

      if (!currentPlayer) {
        store.getState().setLoading(true);
        try {
          await sendSpawnPlayer(l1Program);
          await fetchPlayerState(l1Program, publicKey);
          currentPlayer = store.getState().player;
          store.getState().setGameStarted(true);
        } catch (err) {
          console.error("Failed to spawn:", err);
        } finally {
          store.getState().setLoading(false);
        }
      } else if (currentPlayer.dead) {
        store.getState().setGameStarted(true);
      } else {
        store.getState().setGameStarted(true);
      }

      if (store.getState().gameStarted && !store.getState().brStartTime) {
        store.getState().setBrStartTime(Date.now());
      }

      if (currentPlayer && !store.getState().sessionActive) {
        await initErSession(l1Program, publicKey);
      }
    };

    const timer = setTimeout(checkAndSetup, 500);
    return () => clearTimeout(timer);
  }, [
    l1Program,
    publicKey,
    connected,
    maybeDelegatePlayer,
    store,
  ]);

  // ─── Wire controls to ER when session becomes active ──────────────────────
  useEffect(() => {
    if (!sessionActive || !erProgram || !publicKey) return;

    destroyControls();
    initControls(async (direction) => {
      const ep = erProgramRef.current;
      if (!ep) return;
      try {
        await sendMovementEr(ep, direction, publicKey);
        await Promise.all([
          fetchPlayerState(ep, publicKey),
          fetchGhosts(ep),
        ]);
      } catch (err: any) {
        if (
          !String(err).includes("MoveTooFast") &&
          !String(err).includes("PlayerDead")
        ) {
          console.warn("[Controls] Move failed:", err);
        }
      }
    });

    return () => destroyControls();
  }, [sessionActive, erProgram, publicKey]);

  // ─── Demo mode controls ───────────────────────────────────────────────────
  useEffect(() => {
    if (!demoActive) return;
    const cleanup = initDemoControls();
    return () => {
      cleanup();
      stopDemoMode();
    };
  }, [demoActive]);

  useEffect(() => {
    if (!connected || !demoActive) return;
    stopDemoMode();
    setDemoActive(false);
  }, [connected, demoActive]);

  // ─── Safe respawn on SPACE ────────────────────────────────────────────────
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const p = store.getState().player;
      if (!p?.dead || !l1Program || !publicKey) return;

      e.preventDefault();

      if (p.balanceLamports > 0) {
        setRespawnChoice("confirm");
        return;
      }

      await doRespawn();
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [l1Program, publicKey, store, doRespawn]);

  async function initErSession(l1SetupProgram: Program<any>, phantomPk: PublicKey) {
    if (sessionInitializing) return;
    setSessionInitializing(true);
    try {
      const sessionKeypair: Keypair = await createSession(l1SetupProgram, phantomPk);
      await maybeDelegatePlayer(l1SetupProgram, phantomPk);
      const erProg = createErProgram(sessionKeypair);
      setErProgram(erProg);
      store.getState().setSessionActive(true);
      store.getState().setSessionKeyPubkey(sessionKeypair.publicKey);
      startPolling(l1SetupProgram, connection, phantomPk, erProg);
      console.log("[App] ER session active. Gameplay now popup-free.");
    } catch (err) {
      console.error("[App] Failed to init ER session:", err);
    } finally {
      setSessionInitializing(false);
    }
  }

  const showRespawnWarning =
    player?.dead && player.balanceLamports > 0 && respawnChoice === "confirm";

  return (
    <div className="w-screen h-screen relative bg-arcade-bg overflow-hidden">
      <GameCanvas program={erProgram ?? l1Program} />
      <HUD
        onCashOut={canCashOut ? handleCashOut : undefined}
        cashingOut={cashingOut}
      />
      <Leaderboard />
      <WalletButton />

      {(loading || sessionInitializing || cashingOut) && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-neon-blue border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="font-arcade text-xs text-neon-blue neon-text-subtle">
              {cashingOut
                ? "CASHING OUT..."
                : sessionInitializing
                  ? "STARTING SESSION..."
                  : "LOADING..."}
            </p>
          </div>
        </div>
      )}

      {sessionActive && gameStarted && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
          <div className="bg-black/50 border border-neon-green/40 rounded px-3 py-1 backdrop-blur-sm">
            <p className="font-arcade text-[7px] text-neon-green animate-pulse">
              ⚡ ER SESSION ACTIVE
            </p>
          </div>
        </div>
      )}

      {showRespawnWarning && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 px-6">
          <div className="max-w-md w-full bg-black border border-pac-yellow/50 rounded-xl p-6 shadow-[0_0_35px_rgba(255,230,0,0.2)]">
            <h2 className="font-arcade text-sm text-pac-yellow mb-4 text-center">
              UNCLAIMED BALANCE
            </h2>
            <p className="font-arcade text-[9px] text-gray-300 leading-relaxed text-center mb-6">
              You have {(player.balanceLamports / 1_000_000_000).toFixed(4)} SOL
              unclaimed. Respawning will reset your balance to zero.
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={handleCashOut}
                disabled={cashingOut}
                className="font-arcade text-[9px] text-black bg-pac-yellow hover:bg-yellow-300 disabled:opacity-60 rounded px-4 py-3 transition-all"
              >
                CASH OUT FIRST
              </button>
              <button
                onClick={() => void doRespawn()}
                className="font-arcade text-[9px] text-ghost-red border border-ghost-red/60 hover:bg-ghost-red/10 rounded px-4 py-3 transition-all"
              >
                RESPAWN ANYWAY
              </button>
              <button
                onClick={() => setRespawnChoice("idle")}
                className="font-arcade text-[8px] text-gray-500 hover:text-gray-300 rounded px-4 py-2 transition-all"
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}

      {!connected && !demoActive && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-arcade-bg/95">
          <div className="text-center max-w-md px-8">
            <h1 className="font-arcade text-4xl text-pac-yellow neon-text mb-6 leading-relaxed">
              PAC-ROYALE
            </h1>
            <p className="font-arcade text-[10px] text-neon-blue/70 mb-2 leading-relaxed">
              MULTIPLAYER PAC-MAN ON SOLANA
            </p>
            <p className="font-arcade text-[8px] text-gray-500 mb-8 leading-relaxed">
              EAT PELLETS • AVOID GHOSTS • COLLECT SOL
            </p>

            <div className="mb-8">
              <div className="flex justify-center gap-6 mb-6">
                <div className="text-center">
                  <div className="w-8 h-8 rounded-full bg-pac-yellow mx-auto mb-2 animate-pulse-glow" />
                  <p className="font-arcade text-[7px] text-pac-yellow">
                    PLAYER
                  </p>
                </div>
                <div className="text-center">
                  <div className="w-6 h-6 rounded-full bg-ghost-red mx-auto mb-2 mt-1 animate-float" />
                  <p className="font-arcade text-[7px] text-ghost-red">
                    BLINKY
                  </p>
                </div>
                <div className="text-center">
                  <div
                    className="w-6 h-6 rounded-full bg-ghost-pink mx-auto mb-2 mt-1 animate-float"
                    style={{ animationDelay: "0.3s" }}
                  />
                  <p className="font-arcade text-[7px] text-ghost-pink">
                    PINKY
                  </p>
                </div>
                <div className="text-center">
                  <div
                    className="w-6 h-6 rounded-full bg-ghost-cyan mx-auto mb-2 mt-1 animate-float"
                    style={{ animationDelay: "0.6s" }}
                  />
                  <p className="font-arcade text-[7px] text-ghost-cyan">INKY</p>
                </div>
                <div className="text-center">
                  <div
                    className="w-6 h-6 rounded-full bg-ghost-orange mx-auto mb-2 mt-1 animate-float"
                    style={{ animationDelay: "0.9s" }}
                  />
                  <p className="font-arcade text-[7px] text-ghost-orange">
                    CLYDE
                  </p>
                </div>
              </div>
            </div>

            <p className="font-arcade text-[9px] text-neon-blue animate-pulse mb-2">
              CONNECT WALLET TO PLAY
            </p>
            <p className="font-arcade text-[7px] text-gray-600 mb-6">
              2 PHANTOM SIGNATURES • THEN ZERO POPUPS
            </p>

            <div className="flex flex-col items-center gap-4">
              <WalletButton />
              <button
                onClick={() => {
                  startDemoMode();
                  setDemoActive(true);
                }}
                className="font-arcade text-[9px] text-neon-green/70 hover:text-neon-green border border-neon-green/30 hover:border-neon-green/70 rounded px-4 py-2 transition-all hover:shadow-[0_0_15px_rgba(57,255,20,0.3)]"
              >
                ▶ DEMO MODE
              </button>
            </div>
          </div>
        </div>
      )}

      {gameStarted && !player?.dead && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
          <div className="bg-black/50 border border-neon-blue/20 rounded px-4 py-2 backdrop-blur-sm">
            <p className="font-arcade text-[7px] text-gray-500 text-center">
              WASD / ARROWS TO MOVE
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={DEVNET_RPC}>
      <WalletProvider wallets={wallets} autoConnect={false}>
        <WalletModalProvider>
          <GameRoot />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
