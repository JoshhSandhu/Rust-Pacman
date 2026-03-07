# Pac-Royale Frontend

Neon arcade-style browser client for Pac-Royale — a multiplayer Pac-Man game on Solana.

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:3000 in your browser.

## Features

- **PixiJS** neon glow rendering with tilted camera perspective
- **Solana Wallet Adapter** (Phantom) for devnet
- **Anchor client** for on-chain game interactions
- **Zustand** state management mirroring on-chain data
- **Demo Mode** — play locally without a wallet connection
- Keyboard controls (WASD / Arrow keys)
- HUD with balance, power pellet timer, player count
- Leaderboard sidebar
- Score popups, screen flash on death, animated pellets

## Architecture

```
src/
├── App.tsx                 # Root: wallet providers, game lifecycle
├── main.tsx                # React entry point
├── index.css               # Tailwind + neon glow styles
├── components/
│   ├── GameCanvas.tsx       # PixiJS canvas + controls wiring
│   ├── HUD.tsx              # Top HUD overlay
│   ├── Leaderboard.tsx      # Right sidebar leaderboard
│   └── WalletButton.tsx     # Wallet connect button
├── game/
│   ├── renderer.ts          # Main PixiJS renderer + game loop
│   ├── camera.ts            # Camera follow + perspective tilt
│   ├── entities.ts          # Pac-Man, ghosts, pellets sprites
│   ├── effects.ts           # Neon walls, grid overlay, score text
│   ├── controls.ts          # Keyboard input with debounce
│   └── demoMode.ts          # Offline demo with mock data
├── solana/
│   ├── anchorClient.ts      # Anchor program setup + minimal IDL
│   ├── pda.ts               # PDA derivation helpers
│   ├── fetchState.ts        # On-chain state polling
│   └── transactions.ts      # Game transaction senders
└── state/
    └── gameStore.ts         # Zustand store mirroring on-chain state
```

## Controls

| Key | Action |
|-----|--------|
| W / ↑ | Move up |
| S / ↓ | Move down |
| A / ← | Move left |
| D / → | Move right |
| Space | Respawn (when dead) |

## Tech Stack

- React 18 + TypeScript + Vite 5
- PixiJS 7 for WebGL rendering
- TailwindCSS 3 with custom neon palette
- Zustand 4 for state management
- @solana/wallet-adapter for Phantom
- @coral-xyz/anchor for program interaction
