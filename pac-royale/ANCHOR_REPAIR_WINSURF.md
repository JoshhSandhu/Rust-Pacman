# Pac-Royale Anchor Repair Runbook (Winsurf)

This runbook is for applying and validating the remaining **on-chain Anchor** hardening work.

## Scope

Primary file:

- `programs/pac-royale/src/lib.rs`

Secondary files:

- `tests/pac-royale.ts`
- `scripts/deploy-and-init.ts`
- `.gitignore`
- `deployment-info.json`

---

## 1) Security Patches (Required)

### 1.1 Gate `init_world`

- Add a trusted initializer check in `init_world`.
- Recommended: constant pubkey allowlist or upgrade-authority verification.
- Reject unauthorized signer with a dedicated error (e.g. `UnauthorizedWorldInit`).

### 1.2 Program-owned vault PDA

- Replace free-form vault account model with program-owned PDA:
  - seed suggestion: `["vault", world]`
  - store vault in `Anteroom`.
- In `cash_out`, enforce vault PDA seeds + world match.
- Keep payout constrained to `player.payout_wallet`.

### 1.3 Remove leaked secrets from repo

- Remove `vaultSecretKey` from `deployment-info.json`.
- Add `deployment-info.json` to `.gitignore` or change script output path to non-committed location.

### 1.4 Safe `exit_player` semantics

- Prevent balance burn and repeated decrements:
  - require signer owns player
  - require `player.balance_lamports == 0`
  - close player account (recommended) or mark exited in a single-use-safe way.

### 1.5 Active chunk window invariant

- Add invariant helper:
  - `chunk_index >= world.scroll_offset`
  - `chunk_index < world.scroll_offset + MAX_CHUNKS`
- Enforce in movement/eat instructions.

---

## 2) Correctness Patches (Required)

### 2.1 Chunk logical index invariant

- In movement/eat paths, require:
  - `chunk.world == world.key()`
  - `chunk.logical_index == player.chunk_index`
  - `chunk.physical_index == (player.chunk_index - scroll_offset) mod MAX_CHUNKS`

### 2.2 Template selection truncation fix

Current risky pattern:

- `clock.slot as u8 % NUM_CHUNK_TEMPLATES`

Fix:

- `(clock.slot % NUM_CHUNK_TEMPLATES as u64) as u8`

### 2.3 Remove unnecessary writable accounts

- Convert read-only accounts from `mut` to non-`mut` to reduce lock contention:
  - `EatPellet.world`
  - `EatGhost.world`
  - `EatPlayer.world`
  - any others that are not modified.

### 2.4 Ghost collision ordering

- Evaluate collision on current cell and post-move cell.
- Do not skip death checks because of early-return movement blocks.

---

## 3) Suggested Grep Checklist

Run from `pac-royale/`:

```powershell
rg -n "init_world|cash_out|exit_player|scroll_map|logical_index|PlayerInRemovedChunk|clock.slot as u8|UnauthorizedWorldInit|vault" programs/pac-royale/src/lib.rs
```

---

## 4) Validation Commands

```powershell
anchor build
anchor test
```

If you need focused test runs:

```powershell
anchor test -- --grep "World Initialization"
anchor test -- --grep "Map Scrolling"
anchor test -- --grep "Exit Player"
```

---

## 5) Required Test Additions

Add/adjust tests for:

- Unauthorized `init_world` fails.
- Vault PDA is enforced in `cash_out`.
- `exit_player` with non-zero balance fails.
- Player outside active chunk window is rejected/handled safely.
- Scroll template selection remains bounded and deterministic.

---

## 6) Definition of Done

- [ ] `anchor build` passes
- [ ] `anchor test` passes
- [ ] no committed vault private keys in repository
- [ ] `init_world` cannot be taken over by arbitrary first caller
- [ ] `cash_out` only succeeds through valid vault PDA + payout checks
- [ ] movement/eat flows enforce chunk window + logical index invariants
- [ ] `exit_player` cannot burn funds or be repeatedly abused

