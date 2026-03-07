import { useGameStore } from '../state/gameStore';

export default function HUD() {
  const player = useGameStore((s) => s.player);
  const world = useGameStore((s) => s.world);
  const isPowered = useGameStore((s) => s.isPowered);
  const currentSlot = useGameStore((s) => s.currentSlot);
  const connected = useGameStore((s) => s.connected);

  if (!connected) return null;

  const balanceSol = player ? (player.balanceLamports / 1_000_000_000).toFixed(4) : '0.0000';
  const powerSlotsLeft = player && isPowered
    ? Math.max(0, player.powerPelletUntilSlot - currentSlot)
    : 0;

  return (
    <div className="absolute top-0 left-0 right-0 z-20 pointer-events-none">
      <div className="flex items-center justify-between px-6 py-3">
        {/* Score / Balance */}
        <div className="pointer-events-auto">
          <div className="bg-black/70 border border-neon-blue/40 rounded px-4 py-2 backdrop-blur-sm">
            <p className="font-arcade text-[10px] text-neon-blue/70 mb-1">BALANCE</p>
            <p className="font-arcade text-lg text-pac-yellow neon-text-subtle">
              {balanceSol} SOL
            </p>
          </div>
        </div>

        {/* Center: Game title */}
        <div className="text-center">
          <h1 className="font-arcade text-xl text-pac-yellow neon-text tracking-wider">
            PAC-ROYALE
          </h1>
          {world && (
            <p className="font-arcade text-[8px] text-neon-blue/50 mt-1">
              {world.totalPlayers} PLAYER{world.totalPlayers !== 1 ? 'S' : ''} ONLINE
            </p>
          )}
        </div>

        {/* Power pellet timer */}
        <div className="pointer-events-auto">
          <div className="bg-black/70 border border-neon-blue/40 rounded px-4 py-2 backdrop-blur-sm">
            <p className="font-arcade text-[10px] text-neon-blue/70 mb-1">POWER</p>
            {isPowered ? (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-neon-pink animate-pulse-glow" />
                <p className="font-arcade text-sm text-neon-pink neon-text-subtle">
                  {powerSlotsLeft}
                </p>
              </div>
            ) : (
              <p className="font-arcade text-sm text-gray-600">OFF</p>
            )}
          </div>
        </div>
      </div>

      {/* Player status bar */}
      {player?.dead && (
        <div className="flex justify-center mt-2">
          <div className="bg-ghost-red/20 border border-ghost-red/60 rounded px-6 py-2 animate-pulse">
            <p className="font-arcade text-xs text-ghost-red">
              YOU DIED — PRESS SPACE TO RESPAWN
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
