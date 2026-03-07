# Pac-Royale Development Guide

Complete guide for developing, testing, and deploying the Pac-Royale program.

## Prerequisites

- **Rust & Cargo** (latest stable)
- **Solana CLI** v1.18+ 
- **Anchor CLI** v0.31.1
- **Node.js** v18+
- **Yarn** or **npm**

## Installation

### 1. Install Rust & Solana

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Solana
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# Verify installation
solana --version
```

### 2. Install Anchor

```bash
cargo install --git https://github.com/coral-xyz/anchor --tag v0.31.1 anchor-cli
anchor --version
```

### 3. Install Node Dependencies

```bash
cd pac-royale
npm install
# or
yarn install
```

## Building the Program

### Build

```bash
anchor build
```

This compiles the Rust program and generates TypeScript types in `target/types/`.

### Fix Toolchain Issues

If you see `edition2024` or `blake3` errors:

```bash
# Update Rust
rustup update stable

# Or use a specific Solana/Anchor Docker image
docker run --rm -v $(pwd):/workspace projectserum/build:v0.31.1 anchor build
```

## Testing

### Run All Tests

```bash
anchor test
```

This will:
1. Start a local validator
2. Deploy the program
3. Run all tests in `tests/pac-royale.ts`

### Run Specific Test Suites

```bash
# Run with verbose output
anchor test -- --grep "World Initialization"

# Run on devnet
anchor test --provider.cluster devnet
```

### Test Coverage

The test suite covers:
- ✅ World initialization
- ✅ Chunk initialization (all 32 chunks)
- ✅ Ghost initialization (all 4 ghosts)
- ✅ Player spawn and movement
- ✅ Pellet eating (normal & power pellets)
- ✅ Ghost eating (with power pellet)
- ✅ Player vs Player combat
- ✅ Map scrolling
- ✅ Player exit

## Deployment

### Local Deployment

```bash
# Start local validator
solana-test-validator

# In another terminal, deploy
anchor deploy

# Initialize world, chunks, and ghosts
npm run init
```

### Devnet Deployment

```bash
# Configure for devnet
solana config set --url devnet

# Airdrop SOL for deployment
solana airdrop 2

# Deploy
anchor deploy --provider.cluster devnet

# Initialize
npm run init
```

### Mainnet Deployment

```bash
# Configure for mainnet
solana config set --url mainnet-beta

# Deploy (ensure you have enough SOL)
anchor deploy --provider.cluster mainnet-beta

# Initialize
npm run init
```

## Using the TypeScript SDK

### Basic Setup

```typescript
import * as anchor from "@coral-xyz/anchor";
import { createPacRoyaleClient, CONSTANTS } from "./sdk/client";

const provider = anchor.AnchorProvider.env();
const program = anchor.workspace.PacRoyale;
const client = createPacRoyaleClient(program, provider.connection);
```

### Spawn a Player

```typescript
const authority = provider.wallet.publicKey;
const tx = await client.spawnPlayer(authority);
console.log("Player spawned:", tx);
```

### Move Player

```typescript
// Move right
await client.movement(authority, CONSTANTS.DIR_RIGHT);

// Move up
await client.movement(authority, CONSTANTS.DIR_UP);
```

### Eat Pellet

```typescript
await client.eatPellet(authority);
```

### Eat Ghost (when powered)

```typescript
const ghostId = 0;
await client.eatGhost(authority, ghostId);
```

### Eat Another Player (when powered)

```typescript
const victimAuthority = new PublicKey("...");
await client.eatPlayer(authority, victimAuthority);
```

### Cash Out

```typescript
const payoutWallet = provider.wallet.publicKey;
await client.cashOut(authority, payoutWallet);
```

### Fetch Game State

```typescript
// Get world state
const world = await client.fetchWorld();
console.log("Total players:", world.totalPlayers);
console.log("Scroll offset:", world.scrollOffset);

// Get player state
const player = await client.fetchPlayer(authority);
console.log("Balance:", player.balanceLamports.toString());
console.log("Position:", player.chunkIndex, player.rowInChunk, player.col);

// Get all players
const allPlayers = await client.fetchAllPlayers();

// Get chunk
const chunk = await client.fetchChunk(0);
console.log("Chunk grid:", chunk.grid);

// Get all ghosts
const ghosts = await client.fetchAllGhosts();
```

### Subscribe to Updates

```typescript
// Subscribe to player changes
const subscriptionId = client.subscribeToPlayer(authority, (player) => {
  console.log("Player updated:", player);
});

// Unsubscribe
await client.unsubscribe(subscriptionId);
```

## Program Architecture

### Accounts

- **World**: Global arena state (PDA: `["world"]`)
- **Anteroom**: Vault and cash-out config (PDA: `["anteroom", world]`)
- **Player**: Player state (PDA: `["player", world, authority]`)
- **Chunk**: Map chunk (PDA: `["chunk", world, [physical_index]]`)
- **Ghost**: Ghost NPC (PDA: `["ghost", world, [ghost_id]]`)

### Instructions

1. **init_world** - Initialize world and anteroom (authority only)
2. **init_chunk** - Initialize one chunk (authority only)
3. **init_ghost** - Initialize one ghost (authority only)
4. **spawn_player** - Join the game
5. **movement** - Move player in a direction
6. **eat_pellet** - Collect pellet at current position
7. **eat_player** - Eat another player (when powered)
8. **eat_ghost** - Eat a ghost (when powered)
9. **scroll_map** - Advance the map (remove bottom, add top)
10. **cash_out** - Withdraw balance to wallet
11. **exit_player** - Leave the game

### Economy

| Action | Reward |
|--------|--------|
| Eat pellet | +0.001 SOL (1,000,000 lamports) |
| Eat ghost (powered) | +0.01 SOL (10,000,000 lamports) |
| Eat player (powered) | Victim's full balance transferred |

### Power Pellet Rules

- Duration: 200 slots (~10-20 seconds)
- Can eat ghosts while powered
- Can eat other players while powered (if they're not powered)
- Cannot eat powered players

### Map Scrolling

- 32 chunks total (ring buffer)
- Each chunk: 6 rows × 10 columns
- Bottom chunk removed, new chunk added at top
- Happens every 50 slots (configurable)

## Troubleshooting

### Build Errors

**Error: `edition2024` required**
- Update Rust: `rustup update stable`
- Or use compatible Anchor version

**Error: Program ID mismatch**
- Run `anchor keys list`
- Update `declare_id!` in `lib.rs`
- Update `Anchor.toml`

### Test Errors

**Error: Account not found**
- Ensure world is initialized: `npm run init`
- Check you're on the right network

**Error: Insufficient funds**
- Airdrop SOL: `solana airdrop 2`

### Deployment Errors

**Error: Transaction too large**
- Chunks are initialized one at a time in the init script

**Error: Account already exists**
- World/chunks already initialized
- Use existing deployment or close accounts

## Development Workflow

1. **Make changes** to `programs/pac-royale/src/lib.rs`
2. **Build**: `anchor build`
3. **Test**: `anchor test`
4. **Deploy locally**: `anchor deploy`
5. **Initialize**: `npm run init`
6. **Test manually** with SDK or frontend

## Next Steps

- [ ] Integrate with frontend (React + Canvas)
- [ ] Add Phantom wallet support
- [ ] Implement leaderboard backend
- [ ] Add ghost AI movement system
- [ ] Deploy to Ephemeral Rollup (MagicBlock)
- [ ] Add sound effects and animations

## Resources

- [Anchor Documentation](https://www.anchor-lang.com/)
- [Solana Cookbook](https://solanacookbook.com/)
- [MagicBlock ER Docs](https://docs.magicblock.gg/)
- [Original Plan](../pac_royale_er_build_analysis.md)
