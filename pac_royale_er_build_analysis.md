# Pac-Royale: Endless Pac-Man on Ephemeral Rollups — Build Analysis

> **Goal:** Build a persistent multiplayer Pac-Man arena (Pac-Royale) using the same Ephemeral Rollup (ER) architecture as Supersize-Solana, with endless map chunks, power pellets, ghosts, and on-chain economy.

---

## 1. Architecture Mapping: Supersize ER → Pac-Royale

### 1.1 High-Level Comparison

| Aspect | Supersize (Reference) | Pac-Royale (Target) |
|--------|------------------------|----------------------|
| **Lobby** | Persistent; Map = session | Same — persistent arena, no rounds |
| **Client** | React + HTML5 Canvas, poll ER | Same stack or reuse pacman-dapp frontend |
| **Auth** | buy-in sets authority | Phantom login → authority = wallet; devnet funds |
| **Economy** | SPL token buy-in → vault; score = payout basis | No buy-in; earn in-play (pellets 10rs, ghost 100rs, kill = balance transfer); cash-out to wallet |
| **Spatial** | Section (food partitioning) | **Chunks** (6 rows each); 30 predefined chunk types; bottom destroyed, top spawned |
| **NPCs** | None | **Ghosts** — roam like classic Pac-Man, killable for 100rs when powered |
| **PvP** | eat-player (mass-based) | eat-player **only when** eater has power pellet active AND victim does not; powered vs powered = no eat |
| **State on ER** | Map, Player, Section | **World**, **Player**, **Chunk** (or ChunkRegistry), **Ghost** |

### 1.2 Three-Layer Diagram (Pac-Royale)

```
┌─────────────────────────────────────────────────────────────────┐
│                          CLIENT                                  │
│   React + Canvas (or existing pacman-dapp frontend)              │
│   - Phantom wallet connect (devnet)                              │
│   - Poll ER: World, Player[], Chunk[], Ghost[]                   │
│   - Send: movement, eat_pellet, eat_player (when valid), etc.   │
│   - Render: maze from chunks, pellets, power pellets, ghosts,    │
│             all players; score/balance UI; leaderboard (read)    │
└─────────────────┬────────────────────────────────────────────────┘
                  │ Anchor txns + getAccountInfo (ER RPC)
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│              MAGICBLOCK EPHEMERAL ROLLUP (bolt_lang)             │
│                                                                  │
│   COMPONENTS (delegated to ER):                                  │
│     World     — global arena config, chunk queue, tick/scroll    │
│     Player    — position, direction, balance_lamports,            │
│                 power_pellet_until_slot, authority, etc.         │
│     Chunk     — one account per chunk instance (6 rows of maze)  │
│     Ghost     — position, state (chase/scatter/frightened)       │
│     (Optional) PelletGrid — which cells have pellets (or in Chunk)│
│                                                                  │
│   L1 (not delegated):                                            │
│     Anteroom  — vault for SOL/SPL, cash-out config, devnet       │
│                                                                  │
│   SYSTEMS:                                                       │
│     init_world, init_chunk_pool (30 chunk templates)              │
│     spawn_player, exit_player                                    │
│     movement        — player + ghosts (authoritative)            │
│     eat_pellet      — collect pellet (10rs), maybe power pellet  │
│     eat_player      — when powered & victim not; transfer balance│
│     eat_ghost       — when powered; +100rs to player             │
│     scroll_map      — destroy bottom chunk, append top chunk     │
│     cash_out        — L1: send balance to wallet                │
└─────────────────┬────────────────────────────────────────────────┘
                  │ Undelegation on cash-out → commit state to L1
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SOLANA L1 (Devnet)                          │
│   Anteroom, vault (SOL or dev SPL), World registry               │
│   cash_out: read Player.balance from ER-committed PDA → transfer │
└─────────────────────────────────────────────────────────────────┘
                  │
┌─────────────────▼────────────────────────────────────────────────┐
│            LEADERBOARD BACKEND                                    │
│   Read "most money earned" (balance or historical cash-out)      │
│   Store in DB; expose API for client leaderboard.                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Concepts

### 2.1 Chunk Model (Like Crossy Road)

- **Chunk** = one section of the map = **6 rows** of maze.
- **30 predefined chunks**: each has a fixed layout (walls, pellet positions, power pellet positions). Stored as chunk *templates* (e.g. in World or separate ChunkTemplate accounts).
- **World** maintains an ordered list of *active* chunk instances (e.g. by chunk_id or PDA list). The visible map is a vertical (or horizontal) strip of these chunks.
- **Bottom chunk** is periodically “destroyed”: removed from the list, account closed or recycled.
- **Top chunk** is “added”: pick random template from 30, instantiate a new Chunk account, append to list.
- **Scrolling**: either camera moves (client) and world position is fixed, or world position of player/ghosts is in “world row” coords so that as chunks are removed at bottom, row indices shift. Preferred: **world row index** so that the same row always means the same logical position; when bottom chunk is removed, top chunk gets new rows and row numbering can be “chunk_id + row_in_chunk”.

### 2.2 Coordinate System

- **World**: list of chunks from bottom (index 0) to top (index N). Each chunk has 6 rows. So row index `r = chunk_index * 6 + row_in_chunk`.
- **Player / Ghost position**: `(chunk_index, row_in_chunk, col)` or a single `world_row, col` with chunk derived from `world_row / 6`.
- **Movement**: systems update position in these coordinates; collision with walls is determined by the chunk’s layout.

### 2.3 Economy (Devnet, “rs” = small SOL or game units)

- **1 rs ≈ 0.001 SOL** (reference for UI). **Normal pellet**: +**1_000_000 lamports** (0.001 SOL) per pellet eaten.
- **Ghost kill** (when player has power pellet active): +**10_000_000 lamports** (0.01 SOL).
- **Player kill**: killer receives the **entire balance** of the killed player (transfer within ER state: add to killer’s balance, set victim balance to 0; optionally mark victim as “dead”, then they can respawn with 0 balance).
- **No buy-in**: players join with 0 balance; they earn by pellets, ghost kills, and player kills. Devnet: users need devnet SOL for tx fees only; rewards are in game balance until cash-out.
- **Cash-out**: L1 program reads ER-committed `Player.balance_lamports`, transfers from vault to `Player.payout_wallet` (Phantom).

### 2.4 Power Pellet Rules

- When a player **eats a power pellet**, set `Player.power_pellet_until_slot = current_slot + N` (e.g. N = 200 slots ~ 10–20 seconds).
- **eat_player** system:
  - **Allowed** only if: eater’s `current_slot <= power_pellet_until_slot` AND victim’s `current_slot > power_pellet_until_slot` (eater powered, victim not).
  - **Disallowed** if both powered (they can’t eat each other).
- **eat_ghost**: allowed only when player has power pellet active; player gets +0.01 SOL (10_000_000 lamports); ghost respawns (position reset to a spawn in same or nearby chunk).

### 2.5 Ghosts (OG Pac-Man style)

- **Ghost** component: `position (chunk, row, col)`, `state` (chase / scatter / frightened), direction.
- **Ghost AI**: Like original Pac-Man — simple, not overly complex. Chase/scatter/frightened modes; movement toward or away from player (or random in frightened) using deterministic slot-based RNG. Authority = World/system; no client authority.
- **Determinism**: ghost movement uses slot-based RNG (e.g. `xorshift64(slot + ghost_id)`) so ER execution is deterministic.
- **Collision**:
  - **Player has power pellet**: player can eat ghost → `eat_ghost` (+0.01 SOL lamports), ghost respawns.
  - **Player does NOT have power pellet**: if player touches ghost → **player dies** (respawn with 0 balance, or lose all balance to vault — design: respawn with 0 balance and balance is lost / goes to vault).

### 2.6 Persistence and Join/Leave

- **Join**: Connect Phantom (devnet) → no buy-in; call `spawn_player` on ER (after delegation of Player PDA). Player starts at a spawn chunk/row (e.g. middle of current world), balance = 0.
- **Leave**: Player can call `exit_player` (or just disconnect); optionally `cash_out` first to withdraw balance to Phantom. Inactive players: after T seconds without movement, any player can call `exit_game` to force-remove (like Supersize); balance could be forfeit or sent to vault (design choice).

---

## 3. Component Design (ERC / BOLT Style)

### 3.1 World (Map)

- `authority`, `name`, `chunk_template_count` (30).
- `chunk_instance_ids[]` or PDA seeds for active chunks (bottom to top).
- `next_scroll_slot` — every K slots call `scroll_map` to pop bottom, push new random chunk.
- `total_players`, `frozen` (pause), etc.

### 3.2 Player

- `authority` (Phantom pubkey), `world`, `payout_wallet` (for cash-out).
- `chunk_index`, `row_in_chunk`, `col` (or `world_row`, `col`).
- `direction` (for animation and movement).
- `balance_lamports` (or balance_rs) — in-game earnings.
- `power_pellet_until_slot` — 0 or slot number until which power is active.
- `last_move_slot`, `scheduled_removal_time` (for exit_game).

### 3.3 Chunk

- `world`, `chunk_template_id` (0..29), `chunk_index` (position in world).
- `walls[6][W]` — compact bitfield or byte per cell (wall / empty / pellet / power pellet).
- Or: `pellets` as list of (row, col) for this chunk (reduced account size).

### 3.4 Ghost

- `world`, `ghost_id`, `chunk_index`, `row`, `col`, `state`, `rng_seed` or `target_player`.

### 3.5 Anteroom (L1)

- Same as Supersize: vault token account, token mint, min/max cash-out, devnet config.

---

## 4. System Design

### 4.1 movement

- **Player**: authority signs; update position by one cell in `direction`; check wall in current chunk (and adjacent chunk if crossing boundary). One transaction = one step (or multiple steps per tx to reduce tx count).
- **Ghost**: system-only; no signer; update each ghost’s position using deterministic AI.

### 4.2 eat_pellet

- Check player position overlaps pellet in current chunk; if normal pellet: add **1_000_000 lamports** (0.001 SOL) to `Player.balance_lamports`, clear pellet. If power pellet: set `Player.power_pellet_until_slot`, clear pellet, add same pellet reward.

### 4.3 eat_player

- Check eater has power active; victim does not; same cell or adjacent. Then: `eater.balance_lamports += victim.balance_lamports`; `victim.balance_lamports = 0`; victim respawn (reset position to safe spawn).

### 4.4 eat_ghost

- Check player has power active; player and ghost same cell. Then: `player.balance_lamports += 10_000_000` (0.01 SOL); ghost respawn.

### 4.4b Ghost kills player (no power)

- When a ghost and player occupy same cell and player does **not** have power: player dies — `player.balance_lamports` is zeroed (balance lost / to vault), player respawns at safe position with 0 balance. Handled in same collision pass as eat_ghost (or in movement/ghost system).

### 4.5 scroll_map

- Called by cron or any player every K slots. Pop bottom chunk (close account or mark inactive); choose random template 0..29; create new Chunk at top; append to World’s list. Adjust all Player and Ghost `chunk_index` (decrement by 1) so they stay in same logical row — or use global `world_row` so only chunk list changes.

### 4.6 cash_out (L1)

- Same as Supersize: ensure Player is undelegated (ER committed state); read `Player.balance_lamports`; transfer from vault to `Player.payout_wallet`; set balance to 0.

---

## 5. Client Flow (Phantom, Devnet)

1. **Connect**: Phantom wallet, switch to **Devnet**.
2. **Funding**: User adds devnet SOL (e.g. airdrop) for transaction fees only.
3. **Join**: No buy-in. Client delegates Player to ER (if not already), calls `spawn_player` on ER. Client polls World, all Player PDAs, Chunk PDAs, Ghost PDAs at ~100 ms.
4. **Play**: Send `movement` (direction) every frame or at fixed rate; when overlapping pellet, send `eat_pellet`; when overlapping ghost with power, send `eat_ghost`; when overlapping other player with power (and they’re not powered), send `eat_player`.
5. **Leave**: Optionally `cash_out` on L1 (after undelegation), then disconnect.

---

## 6. Leaderboard

- **Metric**: “Most money earned” — can be current `Player.balance` (in-game) or total withdrawn (historical). Simpler: leaderboard = top `Player.balance` among active players; on cash-out, backend records final balance and can add to “lifetime earned” table.
- **Backend**: Index L1/ER events or poll PDAs; write to Postgres (or similar); expose REST/API for client.
- **Display**: Top 10/100 in UI; show Phantom address (shortened) and balance/earned.

---

## 7. Implementation Phases (Suggested)

| Phase | Scope |
|-------|--------|
| **1. ER + World + Chunks** | Deploy BOLT world; define 30 chunk templates; implement chunk list, scroll_map (destroy bottom, add top). No ghosts yet. |
| **2. Player + Movement + Pellets** | Player component, movement system, eat_pellet (10 rs), power pellet state (power_pellet_until_slot). Single player test. |
| **3. Multiplayer + PvP** | eat_player with power rules; balance transfer; respawn. |
| **4. Ghosts** | Ghost component, ghost movement (deterministic AI), eat_ghost (+100 rs), ghost respawn. Death when touching ghost without power (define penalty). |
| **5. Economy + Cash-out** | Anteroom on L1, vault, cash_out; devnet SOL flow. |
| **6. Client** | Phantom connect, devnet, poll ER, render chunks + maze + pellets + ghosts + players; send all systems. |
| **7. Leaderboard** | Backend + API + UI. |

---

## 8. Economy Constants (Lamports)

| Reward            | Lamports     | SOL    |
|-------------------|-------------|--------|
| Normal pellet     | 1_000_000   | 0.001  |
| Ghost kill        | 10_000_000  | 0.01   |
| Player kill       | victim's full balance transferred to killer |

---

## 9. Differences from Supersize Summary

- **Chunks**: Explicit 6-row chunks, 30 templates, scroll (destroy bottom, add top).
- **Ghosts**: New NPC entity; movement and eat_ghost systems.
- **Power pellet**: Time-limited; gates eat_player and eat_ghost.
- **No buy-in**: Start at 0 balance; earn only in-game; cash-out to Phantom.
- **Devnet**: Target devnet; users need devnet SOL for fees.
- **Leaderboard**: “Most money earned” (balance or lifetime).

This gives a direct path from the existing Supersize ER analysis to building Pac-Royale as an endless, persistent Pac-Man arena on Ephemeral Rollups.
