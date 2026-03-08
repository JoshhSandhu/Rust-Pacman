import { useMemo, useEffect, useState } from 'react';
import { ConnectionProvider, WalletProvider, useWallet, useAnchorWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import { Program } from '@coral-xyz/anchor';
import '@solana/wallet-adapter-react-ui/styles.css';

import { useGameStore } from './state/gameStore';
import { getProgram, resetProgram, DEVNET_RPC } from './solana/anchorClient';
import { startPolling, stopPolling, fetchPlayerState } from './solana/fetchState';
import { sendSpawnPlayer, sendRespawnPlayer } from './solana/transactions';
import { startDemoMode, initDemoControls, stopDemoMode } from './game/demoMode';

import GameCanvas from './components/GameCanvas';
import HUD from './components/HUD';
import Leaderboard from './components/Leaderboard';
import WalletButton from './components/WalletButton';

function GameRoot() {
  const wallet = useAnchorWallet();
  const { connection } = useConnection();
  const { connected, publicKey } = useWallet();
  const [program, setProgram] = useState<Program | null>(null);
  const [demoActive, setDemoActive] = useState(false);

  const store = useGameStore;
  const gameStarted = useGameStore((s) => s.gameStarted);
  const player = useGameStore((s) => s.player);
  const loading = useGameStore((s) => s.loading);

  // Setup program and polling on wallet connect
  useEffect(() => {
    if (!wallet || !publicKey) {
      store.getState().setConnected(false);
      store.getState().setGameStarted(false);
      resetProgram();
      stopPolling();
      stopDemoMode();
      setDemoActive(false);
      setProgram(null);
      return;
    }

    const prog = getProgram(wallet, connection);
    setProgram(prog);
    store.getState().setConnected(true);

    startPolling(prog, connection, publicKey);

    return () => {
      stopPolling();
    };
  }, [wallet, publicKey, connection]);

  // Auto-spawn or detect existing player
  useEffect(() => {
    if (!program || !publicKey || !connected) return;

    const checkAndSpawn = async () => {
      await fetchPlayerState(program, publicKey);
      const currentPlayer = store.getState().player;

      if (!currentPlayer) {
        // Player doesn't exist — spawn
        store.getState().setLoading(true);
        try {
          await sendSpawnPlayer(program);
          await fetchPlayerState(program, publicKey);
          store.getState().setGameStarted(true);
        } catch (err) {
          console.error('Failed to spawn:', err);
        } finally {
          store.getState().setLoading(false);
        }
      } else if (currentPlayer.dead) {
        // Player exists but dead — offer respawn
        store.getState().setGameStarted(true);
      } else {
        // Player exists and alive
        store.getState().setGameStarted(true);
      }
    };

    const timer = setTimeout(checkAndSpawn, 500);
    return () => clearTimeout(timer);
  }, [program, publicKey, connected]);

  // Demo mode controls
  useEffect(() => {
    if (!demoActive) return;
    const cleanup = initDemoControls();
    return () => {
      cleanup();
      stopDemoMode();
    };
  }, [demoActive]);

  // Wallet connection takes precedence over demo mode
  useEffect(() => {
    if (!connected || !demoActive) return;
    stopDemoMode();
    setDemoActive(false);
  }, [connected, demoActive]);

  // Respawn on SPACE key when dead
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const p = store.getState().player;
      if (!p?.dead || !program || !publicKey) return;

      e.preventDefault();
      store.getState().setLoading(true);
      try {
        await sendRespawnPlayer(program);
        await fetchPlayerState(program, publicKey);
      } catch (err) {
        console.error('Respawn failed:', err);
      } finally {
        store.getState().setLoading(false);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [program, publicKey]);

  return (
    <div className="w-screen h-screen relative bg-arcade-bg overflow-hidden">
      {/* Game canvas — always mounted */}
      <GameCanvas program={program} />

      {/* HUD overlay */}
      <HUD />

      {/* Leaderboard */}
      <Leaderboard />

      {/* Wallet button (top-right, over HUD) */}
      <WalletButton />

      {/* Loading spinner */}
      {loading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-neon-blue border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="font-arcade text-xs text-neon-blue neon-text-subtle">
              LOADING...
            </p>
          </div>
        </div>
      )}

      {/* Welcome screen when not connected and not in demo */}
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
                  <p className="font-arcade text-[7px] text-pac-yellow">PLAYER</p>
                </div>
                <div className="text-center">
                  <div className="w-6 h-6 rounded-full bg-ghost-red mx-auto mb-2 mt-1 animate-float" />
                  <p className="font-arcade text-[7px] text-ghost-red">BLINKY</p>
                </div>
                <div className="text-center">
                  <div className="w-6 h-6 rounded-full bg-ghost-pink mx-auto mb-2 mt-1 animate-float" style={{ animationDelay: '0.3s' }} />
                  <p className="font-arcade text-[7px] text-ghost-pink">PINKY</p>
                </div>
                <div className="text-center">
                  <div className="w-6 h-6 rounded-full bg-ghost-cyan mx-auto mb-2 mt-1 animate-float" style={{ animationDelay: '0.6s' }} />
                  <p className="font-arcade text-[7px] text-ghost-cyan">INKY</p>
                </div>
                <div className="text-center">
                  <div className="w-6 h-6 rounded-full bg-ghost-orange mx-auto mb-2 mt-1 animate-float" style={{ animationDelay: '0.9s' }} />
                  <p className="font-arcade text-[7px] text-ghost-orange">CLYDE</p>
                </div>
              </div>
            </div>

            <p className="font-arcade text-[9px] text-neon-blue animate-pulse mb-4">
              CONNECT WALLET TO PLAY
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

      {/* Bottom controls hint */}
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
