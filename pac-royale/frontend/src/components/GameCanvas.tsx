import { useEffect, useRef } from 'react';
import { useGameStore } from '../state/gameStore';
import { createGameRenderer, GameRenderer } from '../game/renderer';
import { initControls, destroyControls } from '../game/controls';
import { sendMovement, sendEatPellet } from '../solana/transactions';
import { Program } from '@coral-xyz/anchor';

interface GameCanvasProps {
  program: Program | null;
}

export default function GameCanvas({ program }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GameRenderer | null>(null);
  const gameStarted = useGameStore((s) => s.gameStarted);
  const screenFlash = useGameStore((s) => s.screenFlash);
  const playerDead = useGameStore((s) => s.player?.dead ?? false);

  useEffect(() => {
    if (!canvasRef.current) return;

    let renderer: GameRenderer | null = null;
    try {
      renderer = createGameRenderer(canvasRef.current);
      rendererRef.current = renderer;
    } catch (err) {
      console.error('[Pac-Royale] PixiJS renderer init failed:', err);
    }

    return () => {
      if (renderer) {
        renderer.destroy();
        rendererRef.current = null;
      }
    };
  }, []);

  // Initialize controls when game starts
  useEffect(() => {
    if (!gameStarted || !program) return;

    initControls(async (direction) => {
      try {
        await sendMovement(program, direction);
        // After moving, try to eat pellet at new position
        try {
          await sendEatPellet(program);
        } catch {
          // No pellet at current position — expected
        }
      } catch (err) {
        console.warn('Movement failed:', err);
      }
    });

    return () => {
      destroyControls();
    };
  }, [gameStarted, program]);

  return (
    <div className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ imageRendering: 'pixelated' }}
      />

      {/* Screen flash overlay */}
      {screenFlash && (
        <div
          className="absolute inset-0 pointer-events-none screen-flash"
          style={{ backgroundColor: screenFlash }}
        />
      )}

      {/* Dead overlay */}
      {playerDead && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <p className="font-arcade text-3xl text-ghost-red neon-text mb-4">
              GAME OVER
            </p>
            <p className="font-arcade text-xs text-gray-400">
              Press SPACE to respawn
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
