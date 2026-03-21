# Pac-Royale (Anchor program)

Endless Pac-Man on Ephemeral Rollups — on-chain multiplayer battle royale.

## 🎮 Overview

Pac-Royale is a fully on-chain multiplayer Pac-Man battle royale built with Anchor on Solana. Players compete in an endless scrolling maze, collecting pellets, eating ghosts, and battling each other for SOL rewards.

**Status**: ✅ **Complete** - Program, tests, SDK, and deployment scripts ready

## 📦 What's Included

```
pac-royale/
├── programs/pac-royale/src/lib.rs  # Anchor program (720 lines)
├── tests/pac-royale.ts             # Comprehensive test suite
├── sdk/
│   ├── client.ts                   # TypeScript SDK
│   └── frontend-helpers.ts         # React/UI integration helpers
├── scripts/
│   └── deploy-and-init.ts          # Deployment & initialization
├── examples/
│   └── play-game.ts                # CLI game example
├── DEVELOPMENT.md                  # Complete dev guide
└── package.json                    # Dependencies & scripts
```

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
# or
yarn install
```

### 2. Build Program

```bash
anchor build
```

### 3. Run Tests

```bash
anchor test
```

### 4. Deploy & Initialize

```bash
# Local
anchor deploy
npm run init

# Devnet
anchor deploy --provider.cluster devnet
npm run init
```

### 5. Play (CLI Example)

```bash
ts-node examples/play-game.ts
```

## 💰 Economy (lamports)

| Action | Reward |
|--------|--------|
| **Pellet** | +1,000,000 lamports (0.001 SOL) |
| **Ghost kill** (powered) | +10,000,000 lamports (0.01 SOL) |
| **Player kill** (powered) | Victim's full balance transferred |

## 🎯 Game Mechanics

### Power Pellet Rules
- **Duration**: 200 slots (~10-20 seconds)
- **Abilities**: Eat ghosts (+0.01 SOL), eat other players (steal balance)
- **Restriction**: Cannot eat powered players

### Map System
- **32 chunks** in ring buffer (6 rows × 10 cols each)
- **5 templates** with different maze layouts
- **Scrolling**: Bottom chunk removed, new chunk added at top every 50 slots
- **Respawn**: Players in removed chunks respawn at top

### Ghost Behavior
- **4 ghosts** with chase/scatter/frightened states
- **Collision**: Touching ghost without power = death (balance lost)
- **Respawn**: Ghosts respawn at center when eaten

## 📋 Instructions

| Instruction | Description | Authority |
|-------------|-------------|-----------|
| `init_world` | Create World + Anteroom | Admin only |
| `init_chunk` | Initialize one chunk (0-31) | Admin only |
| `init_ghost` | Initialize one ghost (0-3) | Admin only |
| `spawn_player` | Join arena (no buy-in) | Any player |
| `movement` | Move in direction (0-3) | Player |
| `eat_pellet` | Collect pellet at position | Player |
| `eat_player` | Eat other player (when powered) | Player |
| `eat_ghost` | Eat ghost (when powered) | Player |
| `scroll_map` | Advance map scrolling | Any |
| `cash_out` | Withdraw balance to wallet | Player |
| `exit_player` | Leave game | Player |

## 🛠️ TypeScript SDK Usage

```typescript
import { createPacRoyaleClient, CONSTANTS } from "./sdk/client";

const client = createPacRoyaleClient(program, connection);

// Spawn player
await client.spawnPlayer(authority);

// Move
await client.movement(authority, CONSTANTS.DIR_RIGHT);

// Eat pellet
await client.eatPellet(authority);

// Eat ghost (when powered)
await client.eatGhost(authority, 0);

// Cash out
await client.cashOut(authority, payoutWallet);

// Fetch state
const world = await client.fetchWorld();
const player = await client.fetchPlayer(authority);
const ghosts = await client.fetchAllGhosts();
```

See `DEVELOPMENT.md` for complete SDK documentation.

## 🧪 Testing

The test suite covers all instructions:

```bash
anchor test
```

Tests include:
- ✅ World initialization
- ✅ All 32 chunks initialization
- ✅ All 4 ghosts initialization
- ✅ Player spawn & movement
- ✅ Pellet eating (normal & power)
- ✅ Ghost eating (with power check)
- ✅ Player vs Player combat
- ✅ Map scrolling
- ✅ Cash out & exit

## 🔧 Program ID

Current: `C5JxJHfHuWuCkyRJwen2gMcJ9XzEN8iBhjpZSdoMb57k`

To use your own:
1. `solana-keygen new -o target/deploy/pac_royale-keypair.json`
2. `anchor keys list`
3. Update `declare_id!` in `lib.rs` and `Anchor.toml`

## 📐 Architecture

### PDAs
- **World**: `["world"]`
- **Anteroom**: `["anteroom", world]`
- **Player**: `["player", world, authority]`
- **Chunk**: `["chunk", world, [physical_index]]`
- **Ghost**: `["ghost", world, [ghost_id]]`

### State Accounts
- **World**: Global arena state (scroll offset, player count, etc.)
- **Anteroom**: Vault and cash-out configuration
- **Player**: Position, balance, power state, authority
- **Chunk**: 6×10 grid with walls/pellets/power pellets
- **Ghost**: Position, state, direction

## 🐛 Troubleshooting

**Build Error: `edition2024` required**
```bash
rustup update stable
```

**Test Error: Account not found**
```bash
npm run init  # Initialize world/chunks/ghosts first
```

**Deployment Error: Insufficient funds**
```bash
solana airdrop 2
```

See `DEVELOPMENT.md` for complete troubleshooting guide.

## 📚 Documentation

- **[DEVELOPMENT.md](./DEVELOPMENT.md)** - Complete development guide
- **[../pac_royale_er_build_analysis.md](../pac_royale_er_build_analysis.md)** - Architecture & design doc
- **[SDK Client](./sdk/client.ts)** - TypeScript SDK source
- **[Frontend Helpers](./sdk/frontend-helpers.ts)** - React integration helpers

## 🎯 Next Steps

- [ ] Integrate with React frontend (see `sdk/frontend-helpers.ts`)
- [ ] Add Phantom wallet support
- [ ] Implement leaderboard backend
- [ ] Add ghost AI movement system
- [ ] Deploy to MagicBlock Ephemeral Rollup
- [ ] Add sound effects & animations

## 📄 License

MIT
