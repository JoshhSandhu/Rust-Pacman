import { useGameStore } from '../state/gameStore';

export default function Leaderboard() {
  const player = useGameStore((s) => s.player);
  const world = useGameStore((s) => s.world);
  const connected = useGameStore((s) => s.connected);
  const otherPlayers = useGameStore((s) => s.otherPlayers);
  const currentSlot = useGameStore((s) => s.currentSlot);
  const demoMode = useGameStore((s) => s.demoMode);

  if (!connected || !world) return null;

  const visibleOtherPlayers = Array.from(otherPlayers.entries()).filter(
    ([, value]) =>
      !value.dead &&
      (demoMode ||
        currentSlot === 0 ||
        currentSlot - value.lastMoveSlot <= 150),
  );

  const boardEntries = [
    {
      rankKey: 'you',
      name: 'YOU',
      balanceLamports: player?.balanceLamports ?? 0,
      you: true,
    },
    ...visibleOtherPlayers.map(([key, value]) => ({
      rankKey: key,
      name: key.slice(0, 4).toUpperCase(),
      balanceLamports: value.balanceLamports,
      you: false,
    })),
  ]
    .sort((a, b) => b.balanceLamports - a.balanceLamports)
    .slice(0, 5);

  return (
    <div className="absolute top-20 right-4 z-20 w-56">
      <div className="bg-black/80 border border-neon-blue/30 rounded-lg p-4 backdrop-blur-sm">
        <h2 className="font-arcade text-[10px] text-neon-blue mb-3 text-center tracking-wider">
          LEADERBOARD
        </h2>

        <div className="space-y-2">
          {boardEntries.map((entry, index) => {
            const score = (entry.balanceLamports / 1_000_000_000).toFixed(4);
            return (
              <div
                key={entry.rankKey}
                className={
                  entry.you
                    ? 'flex items-center justify-between bg-pac-yellow/10 border border-pac-yellow/20 rounded px-2 py-1.5'
                    : 'flex items-center justify-between px-2 py-1 opacity-70'
                }
              >
                <div className="flex items-center gap-2">
                  <span className={entry.you ? 'font-arcade text-[8px] text-pac-yellow' : 'font-arcade text-[8px] text-gray-500'}>
                    {index + 1}
                  </span>
                  <span className={entry.you ? 'font-arcade text-[8px] text-pac-yellow' : 'font-arcade text-[8px] text-neon-green'}>
                    {entry.name}
                  </span>
                </div>
                <span className={entry.you ? 'font-arcade text-[8px] text-pac-yellow' : 'font-arcade text-[8px] text-gray-400'}>
                  {score}
                </span>
              </div>
            );
          })}
          {boardEntries.length === 1 && (
            <p className="font-arcade text-[7px] text-gray-600 text-center py-1">WAITING FOR OTHERS</p>
          )}
        </div>

        {/* Stats */}
        <div className="mt-4 pt-3 border-t border-neon-blue/20">
          <div className="flex justify-between mb-1">
            <span className="font-arcade text-[7px] text-gray-500">PLAYERS</span>
            <span className="font-arcade text-[7px] text-neon-blue">
              {1 + visibleOtherPlayers.length}
            </span>
          </div>
          <div className="flex justify-between mb-1">
            <span className="font-arcade text-[7px] text-gray-500">SCROLL</span>
            <span className="font-arcade text-[7px] text-neon-blue">{world.scrollOffset}</span>
          </div>
          {player && (
            <div className="flex justify-between">
              <span className="font-arcade text-[7px] text-gray-500">CHUNK</span>
              <span className="font-arcade text-[7px] text-neon-blue">{player.chunkIndex}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
