//! Pac-Royale: Endless Pac-Man on Ephemeral Rollups
//! ER Session Key support: gameplay instructions accept session key OR Phantom authority.

use crate::program::PacRoyale;
use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;
use ephemeral_rollups_sdk::cpi::{delegate_account, DelegateAccounts, DelegateConfig};

declare_id!("46gDjnJLeuMqKLJjHow4B4xt6BLspzf7owBydzSvSByH");

pub const LAMPORTS_PER_PELLET: u64 = 1_000_000;
pub const LAMPORTS_PER_GHOST_KILL: u64 = 10_000_000;
pub const CHUNK_ROWS: usize = 6;
pub const CHUNK_COLS: usize = 10;
pub const NUM_CHUNK_TEMPLATES: u8 = 10;
pub const MAX_CHUNKS: u8 = 32;
pub const KILL_MODE_DURATION_SLOTS: u64 = 38;
pub const NUM_GHOSTS: u8 = 4;
pub const SPAWN_SAFE_SLOTS: u64 = 8;

/// Table-driven player spawn positions: (chunk_offset_from_quarter, row, col)
/// All cells verified non-wall in every template.
const PLAYER_SPAWN_TABLE: [(u8, u8, u8); 6] = [
    (0, 2, 2), (0, 3, 7), (1, 2, 4),
    (1, 3, 5), (2, 2, 7), (2, 3, 2),
];

pub type Cell = u8;
pub const CELL_EMPTY: Cell = 0;
pub const CELL_WALL: Cell = 1;
pub const CELL_PELLET: Cell = 2;
pub const CELL_POWER: Cell = 3;

pub type Direction = u8;
pub const DIR_UP: Direction = 0;
pub const DIR_DOWN: Direction = 1;
pub const DIR_LEFT: Direction = 2;
pub const DIR_RIGHT: Direction = 3;

pub type GhostState = u8;
pub const GHOST_CHASE: GhostState = 0;
pub const GHOST_SCATTER: GhostState = 1;
pub const GHOST_FRIGHTENED: GhostState = 2;

// Accept Phantom authority OR registered session key
fn is_valid_signer(player: &Player, signer: &Pubkey) -> bool {
    player.authority == Some(*signer) || player.session_key == Some(*signer)
}

#[ephemeral]
#[program]
pub mod pac_royale {
    use super::*;

    pub fn init_world(ctx: Context<InitWorld>, name: Vec<u8>) -> Result<()> {
        let world = &mut ctx.accounts.world;
        require!(name.len() <= 64, PacRoyaleError::NameTooLong);
        world.authority = ctx.accounts.authority.key();
        let len = name.len().min(64);
        world.name[..len].copy_from_slice(&name[..len]);
        world.chunk_count = MAX_CHUNKS;
        world.scroll_offset = 0;
        world.next_scroll_slot = 0;
        world.total_players = 0;
        world.frozen = false;
        world.chase_target = None;
        world.bump = ctx.bumps.world;

        let anteroom = &mut ctx.accounts.anteroom;
        anteroom.world = world.key();
        anteroom.authority = ctx.accounts.authority.key();
        anteroom.vault = ctx.accounts.vault.key();
        anteroom.bump = ctx.bumps.anteroom;

        let vault = &mut ctx.accounts.vault;
        vault.world = world.key();
        vault.bump = ctx.bumps.vault;

        let clock = Clock::get()?;
        world.next_scroll_slot = clock.slot.saturating_add(100);
        Ok(())
    }

    pub fn init_chunk(ctx: Context<InitChunk>, physical_index: u8, template_id: u8) -> Result<()> {
        require!(
            physical_index < MAX_CHUNKS,
            PacRoyaleError::InvalidChunkIndex
        );
        require!(
            template_id < NUM_CHUNK_TEMPLATES,
            PacRoyaleError::InvalidTemplateId
        );
        let world = &ctx.accounts.world;
        let chunk = &mut ctx.accounts.chunk;
        chunk.world = world.key();
        chunk.physical_index = physical_index;
        chunk.logical_index = physical_index as u32;
        chunk.template_id = template_id;
        chunk.set_grid_from_template(template_id);
        Ok(())
    }

    pub fn spawn_player(ctx: Context<SpawnPlayer>) -> Result<()> {
        let world = &mut ctx.accounts.world;
        let player = &mut ctx.accounts.player;
        let clock = Clock::get()?;
        require!(!world.frozen, PacRoyaleError::WorldFrozen);
        player.authority = Some(ctx.accounts.authority.key());
        player.world = world.key();
        player.payout_wallet = ctx.accounts.authority.key();
        let spawn_idx = ((clock.slot as usize) + world.total_players as usize) % PLAYER_SPAWN_TABLE.len();
        let (chunk_offset, row, col) = PLAYER_SPAWN_TABLE[spawn_idx];
        player.chunk_index = world.scroll_offset.saturating_add((MAX_CHUNKS / 4) as u32 + chunk_offset as u32);
        player.row_in_chunk = row;
        player.col = col;
        player.direction = DIR_RIGHT;
        player.balance_lamports = 0;
        player.power_pellet_until_slot = 0;
        player.spawn_safe_until_slot = clock.slot.saturating_add(SPAWN_SAFE_SLOTS);
        player.kill_mode_until_slot = 0;
        player.last_move_slot = clock.slot;
        player.bump = ctx.bumps.player;
        player.dead = false;
        player.session_key = None;
        world.total_players = world.total_players.saturating_add(1);
        Ok(())
    }

    /// Register or clear a session key. Only Phantom authority can call this.
    pub fn set_session_key(ctx: Context<SetSessionKey>, session_key: Option<Pubkey>) -> Result<()> {
        let player = &mut ctx.accounts.player;
        require!(
            player.authority == Some(ctx.accounts.authority.key()),
            PacRoyaleError::NotAuthority
        );
        player.session_key = session_key;
        if session_key.is_some() {
            // Reset movement throttle when switching from L1-signed setup into ER gameplay.
            // L1 and ER slots are not guaranteed to be aligned, so carrying over the last
            // L1 slot can block the first ER move indefinitely with MoveTooFast.
            player.last_move_slot = 0;
        }
        Ok(())
    }

    pub fn respawn_player(ctx: Context<RespawnPlayer>) -> Result<()> {
        let world = &ctx.accounts.world;
        let player = &mut ctx.accounts.player;
        let clock = Clock::get()?;
        require!(
            player.authority == Some(ctx.accounts.authority.key()),
            PacRoyaleError::NotAuthority
        );
        require!(player.dead, PacRoyaleError::PlayerNotDead);
        require!(!world.frozen, PacRoyaleError::WorldFrozen);
        let spawn_idx = ((clock.slot as usize) + world.total_players as usize) % PLAYER_SPAWN_TABLE.len();
        let (chunk_offset, row, col) = PLAYER_SPAWN_TABLE[spawn_idx];
        player.chunk_index = world.scroll_offset.saturating_add((MAX_CHUNKS / 4) as u32 + chunk_offset as u32);
        player.row_in_chunk = row;
        player.col = col;
        player.direction = DIR_RIGHT;
        player.balance_lamports = 0;
        player.power_pellet_until_slot = 0;
        player.spawn_safe_until_slot = clock.slot.saturating_add(SPAWN_SAFE_SLOTS);
        player.kill_mode_until_slot = 0;
        player.last_move_slot = clock.slot;
        player.dead = false;
        Ok(())
    }

    /// Movement — authority may be session key; player_authority is Phantom pubkey for PDA.
    /// Auto-consumes pellets/power pellets on the final cell to halve transaction count.
    pub fn movement(ctx: Context<Movement>, direction: Direction) -> Result<()> {
        let clock = Clock::get()?;
        validate_direction(direction)?;
        let world = &ctx.accounts.world;

        {
            let player = &mut ctx.accounts.player;
            require!(
                is_valid_signer(player, &ctx.accounts.authority.key()),
                PacRoyaleError::NotAuthority
            );
            require!(!player.dead, PacRoyaleError::PlayerDead);
            require!(
                clock.slot > player.last_move_slot,
                PacRoyaleError::MoveTooFast
            );
            enforce_active_chunk_window(player.chunk_index, world)?;
            player.last_move_slot = clock.slot;

            let ghosts = [
                &ctx.accounts.ghost0,
                &ctx.accounts.ghost1,
                &ctx.accounts.ghost2,
                &ctx.accounts.ghost3,
            ];
            if resolve_ghost_collision(player, clock.slot, ghosts) {
                return Ok(());
            }
        }

        let start_chunk_index = ctx.accounts.player.chunk_index;
        let start_row = ctx.accounts.player.row_in_chunk;
        let start_col = ctx.accounts.player.col;

        validate_chunk_account(&ctx.accounts.chunk, world, start_chunk_index)?;

        let mut new_chunk_index = start_chunk_index;
        let mut new_row = start_row;
        let mut new_col = start_col;
        let mut blocked = false;

        match direction {
            DIR_UP => {
                if start_row == 0 {
                    if start_chunk_index == world.scroll_offset {
                        blocked = true;
                    } else {
                        new_chunk_index = start_chunk_index.saturating_sub(1);
                        new_row = (CHUNK_ROWS - 1) as u8;
                    }
                } else {
                    new_row = start_row.saturating_sub(1);
                }
            }
            DIR_DOWN => {
                if start_row >= (CHUNK_ROWS - 1) as u8 {
                    new_chunk_index = start_chunk_index.saturating_add(1);
                    new_row = 0;
                } else {
                    new_row = start_row.saturating_add(1);
                }
            }
            DIR_LEFT => {
                if start_col == 0 {
                    blocked = true;
                } else {
                    new_col = start_col.saturating_sub(1);
                }
            }
            DIR_RIGHT => {
                if start_col >= (CHUNK_COLS - 1) as u8 {
                    blocked = true;
                } else {
                    new_col = start_col.saturating_add(1);
                }
            }
            _ => {}
        }

        if !blocked && !is_chunk_in_active_window(new_chunk_index, world) {
            blocked = true;
        }

        if !blocked {
            if new_chunk_index == start_chunk_index {
                if ctx.accounts.chunk.grid[new_row as usize][new_col as usize] == CELL_WALL {
                    blocked = true;
                }
            } else {
                let destination_chunk = ctx
                    .accounts
                    .destination_chunk
                    .as_ref()
                    .ok_or(PacRoyaleError::MissingDestinationChunk)?;
                validate_chunk_account(destination_chunk, world, new_chunk_index)?;
                if destination_chunk.grid[new_row as usize][new_col as usize] == CELL_WALL {
                    blocked = true;
                }
            }
        }

        {
            let player = &mut ctx.accounts.player;
            if !blocked {
                player.chunk_index = new_chunk_index;
                player.row_in_chunk = new_row;
                player.col = new_col;
            }
            player.direction = direction;
        }

        let final_chunk_index = ctx.accounts.player.chunk_index;
        let final_row = ctx.accounts.player.row_in_chunk;
        let final_col = ctx.accounts.player.col;

        if final_chunk_index == start_chunk_index {
            consume_cell(
                &mut ctx.accounts.player,
                &mut ctx.accounts.chunk,
                final_row,
                final_col,
                clock.slot,
            );
        } else {
            let destination_chunk = ctx
                .accounts
                .destination_chunk
                .as_mut()
                .ok_or(PacRoyaleError::MissingDestinationChunk)?;
            consume_cell(
                &mut ctx.accounts.player,
                destination_chunk,
                final_row,
                final_col,
                clock.slot,
            );
        }

        {
            let player = &mut ctx.accounts.player;
            let ghosts = [
                &ctx.accounts.ghost0,
                &ctx.accounts.ghost1,
                &ctx.accounts.ghost2,
                &ctx.accounts.ghost3,
            ];
            resolve_ghost_collision(player, clock.slot, ghosts);
        }

        Ok(())
    }

    pub fn eat_pellet(ctx: Context<EatPellet>) -> Result<()> {
        let clock = Clock::get()?;
        let player = &mut ctx.accounts.player;
        let chunk = &mut ctx.accounts.chunk;
        let world = &ctx.accounts.world;
        require!(
            is_valid_signer(player, &ctx.accounts.authority.key()),
            PacRoyaleError::NotAuthority
        );
        require!(!player.dead, PacRoyaleError::PlayerDead);
        enforce_active_chunk_window(player.chunk_index, world)?;
        validate_chunk_account(chunk, world, player.chunk_index)?;
        let row = player.row_in_chunk;
        let col = player.col;
        consume_cell(player, chunk, row, col, clock.slot);
        Ok(())
    }

    pub fn eat_player(ctx: Context<EatPlayer>) -> Result<()> {
        let clock = Clock::get()?;
        let eater = &mut ctx.accounts.eater;
        let victim = &mut ctx.accounts.victim;
        let world = &ctx.accounts.world;
        require!(
            is_valid_signer(eater, &ctx.accounts.authority.key()),
            PacRoyaleError::NotAuthority
        );
        require!(!eater.dead && !victim.dead, PacRoyaleError::PlayerDead);
        enforce_active_chunk_window(eater.chunk_index, world)?;
        enforce_active_chunk_window(victim.chunk_index, world)?;
        // Eater must be in kill mode and NOT spawn-safe
        require!(
            clock.slot > eater.spawn_safe_until_slot,
            PacRoyaleError::SpawnSafe
        );
        require!(
            clock.slot <= eater.kill_mode_until_slot,
            PacRoyaleError::NotPowered
        );
        // Victim must not be spawn-safe or in kill mode
        require!(
            clock.slot > victim.spawn_safe_until_slot,
            PacRoyaleError::VictimSpawnSafe
        );
        require!(
            clock.slot > victim.kill_mode_until_slot,
            PacRoyaleError::VictimPowered
        );
        require!(
            eater.chunk_index == victim.chunk_index
                && eater.row_in_chunk == victim.row_in_chunk
                && eater.col == victim.col,
            PacRoyaleError::NotSameCell
        );
        let transfer = victim.balance_lamports;
        eater.balance_lamports = eater.balance_lamports.saturating_add(transfer);
        victim.balance_lamports = 0;
        victim.dead = true;
        Ok(())
    }

    pub fn init_ghost(ctx: Context<InitGhost>, ghost_id: u8) -> Result<()> {
        require!(ghost_id < NUM_GHOSTS, PacRoyaleError::InvalidGhostId);
        let world = &ctx.accounts.world;
        let ghost = &mut ctx.accounts.ghost;
        let clock = Clock::get()?;
        let (chunk_index, row, col, direction) =
            ghost_spawn_position(ghost_id, world, clock.slot);
        ghost.world = world.key();
        ghost.ghost_id = ghost_id;
        ghost.chunk_index = chunk_index;
        ghost.row = row;
        ghost.col = col;
        ghost.state = GHOST_CHASE;
        ghost.direction = direction;
        ghost.bump = ctx.bumps.ghost;
        Ok(())
    }

    /// Operator/world-authority ghost movement for on-chain ghost AI crank.
    pub fn move_ghost(ctx: Context<MoveGhost>, ghost_id: u8, direction: Direction) -> Result<()> {
        validate_direction(direction)?;
        let world = &ctx.accounts.world;
        let ghost = &mut ctx.accounts.ghost;
        require!(ghost.ghost_id == ghost_id, PacRoyaleError::InvalidGhostId);
        enforce_active_chunk_window(ghost.chunk_index, world)?;
        validate_chunk_account(&ctx.accounts.chunk, world, ghost.chunk_index)?;

        let start_chunk_index = ghost.chunk_index;
        let start_row = ghost.row;
        let start_col = ghost.col;

        let mut new_chunk_index = start_chunk_index;
        let mut new_row = start_row;
        let mut new_col = start_col;
        let mut blocked = false;

        match direction {
            DIR_UP => {
                if start_row == 0 {
                    if start_chunk_index == world.scroll_offset {
                        blocked = true;
                    } else {
                        new_chunk_index = start_chunk_index.saturating_sub(1);
                        new_row = (CHUNK_ROWS - 1) as u8;
                    }
                } else {
                    new_row = start_row.saturating_sub(1);
                }
            }
            DIR_DOWN => {
                if start_row >= (CHUNK_ROWS - 1) as u8 {
                    new_chunk_index = start_chunk_index.saturating_add(1);
                    new_row = 0;
                } else {
                    new_row = start_row.saturating_add(1);
                }
            }
            DIR_LEFT => {
                if start_col == 0 {
                    blocked = true;
                } else {
                    new_col = start_col.saturating_sub(1);
                }
            }
            DIR_RIGHT => {
                if start_col >= (CHUNK_COLS - 1) as u8 {
                    blocked = true;
                } else {
                    new_col = start_col.saturating_add(1);
                }
            }
            _ => {}
        }

        if !blocked && !is_chunk_in_active_window(new_chunk_index, world) {
            blocked = true;
        }

        if !blocked {
            if new_chunk_index == start_chunk_index {
                if ctx.accounts.chunk.grid[new_row as usize][new_col as usize] == CELL_WALL {
                    blocked = true;
                }
            } else {
                let destination_chunk = ctx
                    .accounts
                    .destination_chunk
                    .as_ref()
                    .ok_or(PacRoyaleError::MissingDestinationChunk)?;
                validate_chunk_account(destination_chunk, world, new_chunk_index)?;
                if destination_chunk.grid[new_row as usize][new_col as usize] == CELL_WALL {
                    blocked = true;
                }
            }
        }

        if !blocked {
            ghost.chunk_index = new_chunk_index;
            ghost.row = new_row;
            ghost.col = new_col;
        }
        ghost.direction = direction;
        Ok(())
    }

    pub fn eat_ghost(ctx: Context<EatGhost>, _ghost_id: u8) -> Result<()> {
        let clock = Clock::get()?;
        let player = &mut ctx.accounts.player;
        let ghost = &mut ctx.accounts.ghost;
        let world = &ctx.accounts.world;
        require!(
            is_valid_signer(player, &ctx.accounts.authority.key()),
            PacRoyaleError::NotAuthority
        );
        require!(!player.dead, PacRoyaleError::PlayerDead);
        enforce_active_chunk_window(player.chunk_index, world)?;
        require!(
            is_chunk_in_active_window(ghost.chunk_index, world),
            PacRoyaleError::ChunkOutsideActiveWindow
        );
        // Must be in kill mode and NOT spawn-safe
        require!(
            clock.slot > player.spawn_safe_until_slot,
            PacRoyaleError::SpawnSafe
        );
        require!(
            clock.slot <= player.kill_mode_until_slot,
            PacRoyaleError::NotPowered
        );
        require!(
            player.chunk_index == ghost.chunk_index
                && player.row_in_chunk == ghost.row
                && player.col == ghost.col,
            PacRoyaleError::NotSameCell
        );
        player.balance_lamports = player
            .balance_lamports
            .saturating_add(LAMPORTS_PER_GHOST_KILL);
        ghost_respawn(ghost, world, clock.slot)?;
        Ok(())
    }

    pub fn scroll_map(ctx: Context<ScrollMap>) -> Result<()> {
        let clock = Clock::get()?;
        let world = &mut ctx.accounts.world;
        require!(
            clock.slot >= world.next_scroll_slot,
            PacRoyaleError::ScrollNotDue
        );
        world.next_scroll_slot = clock.slot.saturating_add(50);
        let bottom_physical = (world.scroll_offset % MAX_CHUNKS as u32) as u8;
        let new_logical = world.scroll_offset + MAX_CHUNKS as u32;
        world.scroll_offset = world.scroll_offset.saturating_add(1);
        let chunk = &mut ctx.accounts.chunk;
        require!(
            chunk.physical_index == bottom_physical,
            PacRoyaleError::WrongChunk
        );
        chunk.logical_index = new_logical;
        let new_template_id = (clock.slot % NUM_CHUNK_TEMPLATES as u64) as u8;
        chunk.template_id = new_template_id;
        chunk.set_grid_from_template(new_template_id);
        Ok(())
    }

    /// cash_out requires Phantom authority — session key cannot cash out.
    pub fn cash_out(ctx: Context<CashOut>) -> Result<()> {
        let player = &mut ctx.accounts.player;
        let amount = player.balance_lamports;
        require!(
            player.authority == Some(ctx.accounts.authority.key()),
            PacRoyaleError::NotAuthority
        );
        require!(amount > 0, PacRoyaleError::ZeroBalance);
        let vault_lamports = ctx.accounts.vault.to_account_info().lamports();
        require!(vault_lamports >= amount, PacRoyaleError::VaultInsufficient);
        **ctx
            .accounts
            .vault
            .to_account_info()
            .try_borrow_mut_lamports()? -= amount;
        **ctx
            .accounts
            .payout
            .to_account_info()
            .try_borrow_mut_lamports()? += amount;
        player.balance_lamports = 0;
        Ok(())
    }

    pub fn exit_player(ctx: Context<ExitPlayer>) -> Result<()> {
        let world = &mut ctx.accounts.world;
        let player = &ctx.accounts.player;
        require!(
            player.authority == Some(ctx.accounts.authority.key()),
            PacRoyaleError::NotAuthority
        );
        require!(
            player.balance_lamports == 0,
            PacRoyaleError::BalanceMustBeZeroToExit
        );
        world.total_players = world
            .total_players
            .checked_sub(1)
            .ok_or(PacRoyaleError::PlayerCountUnderflow)?;
        Ok(())
    }

    pub fn delegate_world(ctx: Context<DelegateWorld>) -> Result<()> {
        let pda_signer_seeds: &[&[u8]] = &[b"world"];
        let delegate_accounts = DelegateAccounts {
            payer: &ctx.accounts.payer.to_account_info(),
            pda: &ctx.accounts.world.to_account_info(),
            owner_program: &ctx.accounts.program.to_account_info(),
            buffer: &ctx.accounts.buffer.to_account_info(),
            delegation_record: &ctx.accounts.delegation_record.to_account_info(),
            delegation_metadata: &ctx.accounts.delegation_metadata.to_account_info(),
            delegation_program: &ctx.accounts.delegation_program.to_account_info(),
            system_program: &ctx.accounts.system_program.to_account_info(),
        };
        delegate_account(
            delegate_accounts,
            pda_signer_seeds,
            DelegateConfig::default(),
        )?;
        Ok(())
    }

    pub fn delegate_chunk(ctx: Context<DelegateChunk>, physical_index: u8) -> Result<()> {
        let pda_signer_seeds: &[&[u8]] = &[
            b"chunk",
            ctx.accounts.world_info.key.as_ref(),
            &[physical_index],
        ];
        let delegate_accounts = DelegateAccounts {
            payer: &ctx.accounts.payer.to_account_info(),
            pda: &ctx.accounts.chunk.to_account_info(),
            owner_program: &ctx.accounts.program.to_account_info(),
            buffer: &ctx.accounts.buffer.to_account_info(),
            delegation_record: &ctx.accounts.delegation_record.to_account_info(),
            delegation_metadata: &ctx.accounts.delegation_metadata.to_account_info(),
            delegation_program: &ctx.accounts.delegation_program.to_account_info(),
            system_program: &ctx.accounts.system_program.to_account_info(),
        };
        delegate_account(
            delegate_accounts,
            pda_signer_seeds,
            DelegateConfig::default(),
        )?;
        Ok(())
    }

    pub fn delegate_ghost(ctx: Context<DelegateGhost>, ghost_id: u8) -> Result<()> {
        let pda_signer_seeds: &[&[u8]] =
            &[b"ghost", ctx.accounts.world_info.key.as_ref(), &[ghost_id]];
        let delegate_accounts = DelegateAccounts {
            payer: &ctx.accounts.payer.to_account_info(),
            pda: &ctx.accounts.ghost.to_account_info(),
            owner_program: &ctx.accounts.program.to_account_info(),
            buffer: &ctx.accounts.buffer.to_account_info(),
            delegation_record: &ctx.accounts.delegation_record.to_account_info(),
            delegation_metadata: &ctx.accounts.delegation_metadata.to_account_info(),
            delegation_program: &ctx.accounts.delegation_program.to_account_info(),
            system_program: &ctx.accounts.system_program.to_account_info(),
        };
        delegate_account(
            delegate_accounts,
            pda_signer_seeds,
            DelegateConfig::default(),
        )?;
        Ok(())
    }

    /// Delegate the player PDA so ER gameplay can write to it.
    /// Must be called by the player's Phantom authority.
    pub fn delegate_player(ctx: Context<DelegatePlayer>) -> Result<()> {
        require!(
            ctx.accounts.player.authority == Some(ctx.accounts.authority.key()),
            PacRoyaleError::NotAuthority
        );

        let world_key = ctx.accounts.world.key();
        let authority_key = ctx.accounts.authority.key();
        let pda_signer_seeds: &[&[u8]] = &[b"player", world_key.as_ref(), authority_key.as_ref()];

        let delegate_accounts = DelegateAccounts {
            payer: &ctx.accounts.authority.to_account_info(),
            pda: &ctx.accounts.player.to_account_info(),
            owner_program: &ctx.accounts.program.to_account_info(),
            buffer: &ctx.accounts.buffer.to_account_info(),
            delegation_record: &ctx.accounts.delegation_record.to_account_info(),
            delegation_metadata: &ctx.accounts.delegation_metadata.to_account_info(),
            delegation_program: &ctx.accounts.delegation_program.to_account_info(),
            system_program: &ctx.accounts.system_program.to_account_info(),
        };

        delegate_account(
            delegate_accounts,
            pda_signer_seeds,
            DelegateConfig::default(),
        )?;
        Ok(())
    }
}

fn is_chunk_in_active_window(chunk_index: u32, world: &Account<World>) -> bool {
    let upper_bound = world.scroll_offset.saturating_add(MAX_CHUNKS as u32);
    chunk_index >= world.scroll_offset && chunk_index < upper_bound
}

fn enforce_active_chunk_window(chunk_index: u32, world: &Account<World>) -> Result<()> {
    require!(
        chunk_index >= world.scroll_offset,
        PacRoyaleError::PlayerInRemovedChunk
    );
    require!(
        chunk_index < world.scroll_offset.saturating_add(MAX_CHUNKS as u32),
        PacRoyaleError::ChunkOutsideActiveWindow
    );
    Ok(())
}

fn expected_chunk_physical_index(chunk_index: u32, scroll_offset: u32) -> Result<u8> {
    let offset_chunk = chunk_index
        .checked_sub(scroll_offset)
        .ok_or(PacRoyaleError::PlayerInRemovedChunk)?;
    Ok((offset_chunk % MAX_CHUNKS as u32) as u8)
}

fn validate_direction(direction: Direction) -> Result<()> {
    require!(direction <= DIR_RIGHT, PacRoyaleError::InvalidDirection);
    Ok(())
}

fn validate_chunk_account(
    chunk: &Account<Chunk>,
    world: &Account<World>,
    logical_index: u32,
) -> Result<()> {
    require!(chunk.world == world.key(), PacRoyaleError::WrongChunk);
    require!(
        chunk.logical_index == logical_index,
        PacRoyaleError::ChunkLogicalMismatch
    );
    require!(
        chunk.physical_index == expected_chunk_physical_index(logical_index, world.scroll_offset)?,
        PacRoyaleError::WrongChunk
    );
    Ok(())
}

fn consume_cell(
    player: &mut Account<Player>,
    chunk: &mut Account<Chunk>,
    row: u8,
    col: u8,
    current_slot: u64,
) {
    let cell = chunk.grid[row as usize][col as usize];
    if cell == CELL_PELLET {
        player.balance_lamports = player.balance_lamports.saturating_add(LAMPORTS_PER_PELLET);
        chunk.grid[row as usize][col as usize] = CELL_EMPTY;
    } else if cell == CELL_POWER {
        player.balance_lamports = player.balance_lamports.saturating_add(LAMPORTS_PER_PELLET);
        player.power_pellet_until_slot = current_slot.saturating_add(POWER_PELLET_DURATION_SLOTS);
        chunk.grid[row as usize][col as usize] = CELL_EMPTY;
    }
}

fn resolve_ghost_collision(
    player: &mut Account<Player>,
    current_slot: u64,
    ghosts: [&Account<Ghost>; 4],
) -> bool {
    for ghost in ghosts {
        if ghost.chunk_index == player.chunk_index
            && ghost.row == player.row_in_chunk
            && ghost.col == player.col
        {
            if current_slot > player.power_pellet_until_slot {
                player.balance_lamports = 0;
                player.dead = true;
                return true;
            }
        }
    }
    false
}

fn ghost_respawn(ghost: &mut Account<Ghost>, world: &Account<World>, seed: u64) -> Result<()> {
    let (chunk_index, row, col, direction) = ghost_spawn_position(ghost.ghost_id, world, seed);
    ghost.chunk_index = chunk_index;
    ghost.row = row;
    ghost.col = col;
    ghost.state = GHOST_CHASE;
    ghost.direction = direction;
    Ok(())
}

fn ghost_spawn_position(
    ghost_id: u8,
    world: &Account<World>,
    seed: u64,
) -> (u32, u8, u8, Direction) {
    const SPAWN_POINTS: [(u8, u8, u8, Direction); 8] = [
        (2, 1, 1, DIR_RIGHT),
        (6, 1, 8, DIR_LEFT),
        (10, 4, 2, DIR_UP),
        (14, 4, 7, DIR_LEFT),
        (18, 3, 1, DIR_RIGHT),
        (22, 3, 8, DIR_LEFT),
        (26, 0, 4, DIR_DOWN),
        (30, 5, 5, DIR_UP),
    ];

    let spawn_index = ((seed as usize) + ghost_id as usize) % SPAWN_POINTS.len();
    let (chunk_offset, row, col, direction) = SPAWN_POINTS[spawn_index];
    let chunk_index = world.scroll_offset.saturating_add(chunk_offset as u32);
    (chunk_index, row, col, direction)
}

// --- Account structs ---

#[derive(Accounts)]
pub struct InitWorld<'info> {
    #[account(init, payer = authority, space = 8 + 32 + 64 + 1 + 4 + 8 + 4 + 1 + 33 + 1, seeds = [b"world"], bump)]
    pub world: Account<'info, World>,
    #[account(init, payer = authority, space = 8 + 32 + 32 + 32 + 1, seeds = [b"anteroom", world.key().as_ref()], bump)]
    pub anteroom: Account<'info, Anteroom>,
    #[account(init, payer = authority, space = 8 + 32 + 1, seeds = [b"vault", world.key().as_ref()], bump)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ PacRoyaleError::UnauthorizedWorldInit)]
    pub program: Program<'info, PacRoyale>,
    #[account(constraint = program_data.upgrade_authority_address == Some(authority.key()) @ PacRoyaleError::UnauthorizedWorldInit)]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(physical_index: u8, template_id: u8)]
pub struct InitChunk<'info> {
    #[account(has_one = authority @ PacRoyaleError::NotAuthority)]
    pub world: Account<'info, World>,
    #[account(init, payer = authority, space = 8 + 32 + 1 + 4 + 1 + (CHUNK_ROWS * CHUNK_COLS), seeds = [b"chunk", world.key().as_ref(), &[physical_index]], bump)]
    pub chunk: Account<'info, Chunk>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SpawnPlayer<'info> {
    #[account(mut)]
    pub world: Account<'info, World>,
    #[account(init, payer = authority, space = 8 + 33 + 32 + 32 + 4 + 1 + 1 + 1 + 8 + 8 + 8 + 1 + 1 + 33, seeds = [b"player", world.key().as_ref(), authority.key().as_ref()], bump)]
    pub player: Account<'info, Player>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetSessionKey<'info> {
    pub world: Account<'info, World>,
    #[account(mut, seeds = [b"player", world.key().as_ref(), authority.key().as_ref()], bump = player.bump)]
    pub player: Account<'info, Player>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Movement<'info> {
    pub world: Account<'info, World>,
    #[account(mut, seeds = [b"player", world.key().as_ref(), player_authority.key().as_ref()], bump = player.bump)]
    pub player: Account<'info, Player>,
    #[account(mut, constraint = chunk.world == world.key() @ PacRoyaleError::WrongChunk)]
    pub chunk: Account<'info, Chunk>,
    pub authority: Signer<'info>,
    /// CHECK: Phantom pubkey for PDA seed derivation only
    pub player_authority: UncheckedAccount<'info>,
    #[account(seeds = [b"ghost", world.key().as_ref(), &[0u8]], bump = ghost0.bump, constraint = ghost0.world == world.key())]
    pub ghost0: Account<'info, Ghost>,
    #[account(seeds = [b"ghost", world.key().as_ref(), &[1u8]], bump = ghost1.bump, constraint = ghost1.world == world.key())]
    pub ghost1: Account<'info, Ghost>,
    #[account(seeds = [b"ghost", world.key().as_ref(), &[2u8]], bump = ghost2.bump, constraint = ghost2.world == world.key())]
    pub ghost2: Account<'info, Ghost>,
    #[account(seeds = [b"ghost", world.key().as_ref(), &[3u8]], bump = ghost3.bump, constraint = ghost3.world == world.key())]
    pub ghost3: Account<'info, Ghost>,
    pub destination_chunk: Option<Account<'info, Chunk>>,
}

#[derive(Accounts)]
pub struct EatPellet<'info> {
    pub world: Account<'info, World>,
    #[account(mut, seeds = [b"player", world.key().as_ref(), player_authority.key().as_ref()], bump = player.bump)]
    pub player: Account<'info, Player>,
    #[account(mut, constraint = chunk.world == world.key() @ PacRoyaleError::WrongChunk)]
    pub chunk: Account<'info, Chunk>,
    pub authority: Signer<'info>,
    /// CHECK: Phantom pubkey for PDA seed derivation only
    pub player_authority: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct EatPlayer<'info> {
    #[account(mut, seeds = [b"player", world.key().as_ref(), player_authority.key().as_ref()], bump = eater.bump)]
    pub eater: Account<'info, Player>,
    #[account(mut, seeds = [b"player", world.key().as_ref(), victim_authority.key().as_ref()], bump = victim.bump, constraint = victim.world == world.key())]
    pub victim: Account<'info, Player>,
    pub world: Account<'info, World>,
    pub authority: Signer<'info>,
    /// CHECK: Phantom pubkey for PDA seed derivation only
    pub player_authority: UncheckedAccount<'info>,
    /// CHECK: Victim's Phantom pubkey for victim PDA seed
    pub victim_authority: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(ghost_id: u8)]
pub struct InitGhost<'info> {
    #[account(has_one = authority @ PacRoyaleError::NotAuthority)]
    pub world: Account<'info, World>,
    #[account(init, payer = authority, space = 8 + 32 + 1 + 4 + 1 + 1 + 1 + 1 + 1, seeds = [b"ghost", world.key().as_ref(), &[ghost_id]], bump)]
    pub ghost: Account<'info, Ghost>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(ghost_id: u8)]
pub struct MoveGhost<'info> {
    #[account(has_one = authority @ PacRoyaleError::NotAuthority)]
    pub world: Account<'info, World>,
    #[account(mut, seeds = [b"ghost", world.key().as_ref(), &[ghost_id]], bump = ghost.bump, constraint = ghost.world == world.key())]
    pub ghost: Account<'info, Ghost>,
    #[account(constraint = chunk.world == world.key() @ PacRoyaleError::WrongChunk)]
    pub chunk: Account<'info, Chunk>,
    pub authority: Signer<'info>,
    pub destination_chunk: Option<Account<'info, Chunk>>,
}

#[derive(Accounts)]
#[instruction(ghost_id: u8)]
pub struct EatGhost<'info> {
    pub world: Account<'info, World>,
    #[account(mut, seeds = [b"player", world.key().as_ref(), player_authority.key().as_ref()], bump = player.bump)]
    pub player: Account<'info, Player>,
    #[account(mut, seeds = [b"ghost", world.key().as_ref(), &[ghost_id]], bump = ghost.bump, constraint = ghost.world == world.key())]
    pub ghost: Account<'info, Ghost>,
    pub authority: Signer<'info>,
    /// CHECK: Phantom pubkey for PDA seed derivation only
    pub player_authority: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ScrollMap<'info> {
    #[account(mut, has_one = authority @ PacRoyaleError::NotAuthority)]
    pub world: Account<'info, World>,
    #[account(mut, constraint = chunk.world == world.key() @ PacRoyaleError::WrongChunk, constraint = chunk.physical_index == (world.scroll_offset % MAX_CHUNKS as u32) as u8 @ PacRoyaleError::WrongChunk)]
    pub chunk: Account<'info, Chunk>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct CashOut<'info> {
    #[account(mut, seeds = [b"player", world.key().as_ref(), authority.key().as_ref()], bump = player.bump)]
    pub player: Account<'info, Player>,
    #[account(seeds = [b"anteroom", world.key().as_ref()], bump = anteroom.bump, constraint = anteroom.world == world.key() @ PacRoyaleError::WrongChunk)]
    pub anteroom: Account<'info, Anteroom>,
    pub world: Account<'info, World>,
    #[account(mut, seeds = [b"vault", world.key().as_ref()], bump = vault.bump, constraint = vault.world == world.key() @ PacRoyaleError::InvalidVault, constraint = vault.key() == anteroom.vault @ PacRoyaleError::InvalidVault)]
    pub vault: Account<'info, Vault>,
    /// CHECK: Payout wallet
    #[account(mut, constraint = payout.key() == player.payout_wallet @ PacRoyaleError::InvalidPayout)]
    pub payout: AccountInfo<'info>,
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RespawnPlayer<'info> {
    pub world: Account<'info, World>,
    #[account(mut, seeds = [b"player", world.key().as_ref(), authority.key().as_ref()], bump = player.bump)]
    pub player: Account<'info, Player>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ExitPlayer<'info> {
    #[account(mut)]
    pub world: Account<'info, World>,
    #[account(mut, close = authority, seeds = [b"player", world.key().as_ref(), authority.key().as_ref()], bump = player.bump)]
    pub player: Account<'info, Player>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct DelegateWorld<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [b"world"], bump = world.bump)]
    pub world: Account<'info, World>,
    /// CHECK: MagicBlock buffer PDA
    #[account(mut)]
    pub buffer: AccountInfo<'info>,
    /// CHECK: MagicBlock delegation record PDA
    #[account(mut)]
    pub delegation_record: AccountInfo<'info>,
    /// CHECK: MagicBlock delegation metadata PDA
    #[account(mut)]
    pub delegation_metadata: AccountInfo<'info>,
    /// CHECK: MagicBlock delegation program
    #[account(executable)]
    pub delegation_program: AccountInfo<'info>,
    /// CHECK: this program's own ID
    #[account(address = crate::ID)]
    pub program: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(physical_index: u8)]
pub struct DelegateChunk<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: used for seeds
    pub world_info: AccountInfo<'info>,
    #[account(mut, seeds = [b"chunk", world_info.key().as_ref(), &[physical_index]], bump)]
    pub chunk: Account<'info, Chunk>,
    /// CHECK: MagicBlock buffer PDA
    #[account(mut)]
    pub buffer: AccountInfo<'info>,
    /// CHECK: MagicBlock delegation record PDA
    #[account(mut)]
    pub delegation_record: AccountInfo<'info>,
    /// CHECK: MagicBlock delegation metadata PDA
    #[account(mut)]
    pub delegation_metadata: AccountInfo<'info>,
    /// CHECK: MagicBlock delegation program
    #[account(executable)]
    pub delegation_program: AccountInfo<'info>,
    /// CHECK: this program's own ID
    #[account(address = crate::ID)]
    pub program: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(ghost_id: u8)]
pub struct DelegateGhost<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: used for seeds
    pub world_info: AccountInfo<'info>,
    #[account(mut, seeds = [b"ghost", world_info.key().as_ref(), &[ghost_id]], bump = ghost.bump)]
    pub ghost: Account<'info, Ghost>,
    /// CHECK: MagicBlock buffer PDA
    #[account(mut)]
    pub buffer: AccountInfo<'info>,
    /// CHECK: MagicBlock delegation record PDA
    #[account(mut)]
    pub delegation_record: AccountInfo<'info>,
    /// CHECK: MagicBlock delegation metadata PDA
    #[account(mut)]
    pub delegation_metadata: AccountInfo<'info>,
    /// CHECK: MagicBlock delegation program
    #[account(executable)]
    pub delegation_program: AccountInfo<'info>,
    /// CHECK: this program's own ID
    #[account(address = crate::ID)]
    pub program: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DelegatePlayer<'info> {
    pub world: Account<'info, World>,
    #[account(mut, seeds = [b"player", world.key().as_ref(), authority.key().as_ref()], bump = player.bump)]
    pub player: Account<'info, Player>,
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: MagicBlock buffer PDA
    #[account(mut)]
    pub buffer: AccountInfo<'info>,
    /// CHECK: MagicBlock delegation record PDA
    #[account(mut)]
    pub delegation_record: AccountInfo<'info>,
    /// CHECK: MagicBlock delegation metadata PDA
    #[account(mut)]
    pub delegation_metadata: AccountInfo<'info>,
    /// CHECK: MagicBlock delegation program
    #[account(executable)]
    pub delegation_program: AccountInfo<'info>,
    /// CHECK: this program's own ID
    #[account(address = crate::ID)]
    pub program: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

// --- State ---

#[account]
pub struct World {
    pub authority: Pubkey,
    pub name: [u8; 64],
    pub chunk_count: u8,
    pub scroll_offset: u32,
    pub next_scroll_slot: u64,
    pub total_players: u32,
    pub frozen: bool,
    pub chase_target: Option<Pubkey>,
    pub bump: u8,
}

#[account]
pub struct Anteroom {
    pub world: Pubkey,
    pub authority: Pubkey,
    pub vault: Pubkey,
    pub bump: u8,
}

#[account]
pub struct Vault {
    pub world: Pubkey,
    pub bump: u8,
}

#[account]
pub struct Player {
    pub authority: Option<Pubkey>,
    pub world: Pubkey,
    pub payout_wallet: Pubkey,
    pub chunk_index: u32,
    pub row_in_chunk: u8,
    pub col: u8,
    pub direction: Direction,
    pub balance_lamports: u64,
    pub power_pellet_until_slot: u64,
    pub last_move_slot: u64,
    pub bump: u8,
    pub dead: bool,
    /// Optional session key — allows ER gameplay without Phantom popup.
    /// Set via set_session_key(); cleared on game end.
    pub session_key: Option<Pubkey>,
}

#[account]
pub struct Chunk {
    pub world: Pubkey,
    pub physical_index: u8,
    pub logical_index: u32,
    pub template_id: u8,
    pub grid: [[Cell; CHUNK_COLS]; CHUNK_ROWS],
}

impl Chunk {
    fn set_grid_from_template(&mut self, template_id: u8) {
        let t = template_id as usize;
        for r in 0..CHUNK_ROWS {
            for c in 0..CHUNK_COLS {
                self.grid[r][c] = CHUNK_TEMPLATES[t % CHUNK_TEMPLATES.len()][r][c];
            }
        }
    }
}

#[account]
pub struct Ghost {
    pub world: Pubkey,
    pub ghost_id: u8,
    pub chunk_index: u32,
    pub row: u8,
    pub col: u8,
    pub state: GhostState,
    pub direction: Direction,
    pub bump: u8,
}

const CHUNK_TEMPLATES: [[[Cell; CHUNK_COLS]; CHUNK_ROWS]; 10] = [
    [
        [1, 1, 0, 0, 0, 0, 0, 0, 1, 1],
        [1, 2, 2, 0, 2, 2, 0, 2, 2, 1],
        [1, 0, 1, 0, 2, 2, 0, 1, 0, 1],
        [1, 2, 0, 2, 3, 2, 2, 0, 2, 1],
        [1, 2, 2, 0, 2, 2, 0, 2, 2, 1],
        [1, 1, 0, 0, 0, 0, 0, 0, 1, 1],
    ],
    [
        [1, 1, 0, 0, 0, 0, 0, 0, 1, 1],
        [1, 2, 0, 2, 2, 2, 2, 0, 2, 1],
        [1, 2, 1, 0, 0, 0, 0, 1, 2, 1],
        [1, 0, 2, 2, 3, 2, 2, 2, 0, 1],
        [1, 2, 0, 1, 0, 0, 1, 0, 2, 1],
        [1, 1, 0, 0, 0, 0, 0, 0, 1, 1],
    ],
    [
        [1, 1, 0, 0, 0, 0, 0, 0, 1, 1],
        [1, 2, 2, 2, 0, 0, 2, 2, 2, 1],
        [1, 0, 0, 0, 2, 2, 0, 0, 0, 1],
        [1, 2, 1, 2, 3, 2, 2, 1, 2, 1],
        [1, 0, 2, 0, 0, 0, 0, 2, 0, 1],
        [1, 1, 0, 0, 0, 0, 0, 0, 1, 1],
    ],
    [
        [1, 1, 0, 0, 0, 0, 0, 0, 1, 1],
        [1, 0, 2, 2, 0, 0, 2, 2, 0, 1],
        [1, 2, 0, 0, 2, 2, 0, 0, 2, 1],
        [1, 2, 0, 2, 3, 0, 2, 0, 2, 1],
        [1, 0, 2, 0, 2, 2, 0, 2, 0, 1],
        [1, 1, 0, 0, 0, 0, 0, 0, 1, 1],
    ],
    [
        [1, 1, 0, 0, 0, 0, 0, 0, 1, 1],
        [1, 2, 2, 0, 0, 0, 0, 2, 2, 1],
        [1, 0, 1, 0, 2, 2, 0, 1, 0, 1],
        [1, 2, 0, 2, 3, 2, 2, 0, 2, 1],
        [1, 2, 0, 0, 2, 2, 0, 0, 2, 1],
        [1, 1, 0, 0, 0, 0, 0, 0, 1, 1],
    ],
    [
        [1, 1, 0, 0, 0, 0, 0, 0, 1, 1],
        [1, 2, 0, 2, 0, 0, 2, 0, 2, 1],
        [1, 2, 1, 2, 0, 0, 2, 1, 2, 1],
        [1, 0, 2, 2, 3, 2, 2, 2, 0, 1],
        [1, 2, 0, 0, 2, 2, 0, 0, 2, 1],
        [1, 1, 0, 0, 0, 0, 0, 0, 1, 1],
    ],
    [
        [1, 1, 0, 0, 0, 0, 0, 0, 1, 1],
        [1, 0, 2, 2, 2, 2, 2, 2, 0, 1],
        [1, 2, 0, 0, 1, 1, 0, 0, 2, 1],
        [1, 2, 0, 2, 3, 2, 0, 2, 2, 1],
        [1, 0, 2, 2, 0, 0, 2, 2, 0, 1],
        [1, 1, 0, 0, 0, 0, 0, 0, 1, 1],
    ],
    [
        [1, 1, 0, 0, 0, 0, 0, 0, 1, 1],
        [1, 2, 2, 2, 2, 2, 2, 2, 2, 1],
        [1, 0, 1, 0, 0, 0, 0, 1, 0, 1],
        [1, 2, 0, 2, 3, 2, 0, 2, 2, 1],
        [1, 0, 2, 0, 2, 2, 0, 2, 0, 1],
        [1, 1, 0, 0, 0, 0, 0, 0, 1, 1],
    ],
    [
        [1, 1, 0, 0, 0, 0, 0, 0, 1, 1],
        [1, 0, 2, 0, 2, 2, 0, 2, 0, 1],
        [1, 2, 1, 2, 0, 0, 2, 1, 2, 1],
        [1, 2, 2, 0, 3, 2, 0, 2, 2, 1],
        [1, 0, 0, 2, 2, 2, 2, 0, 0, 1],
        [1, 1, 0, 0, 0, 0, 0, 0, 1, 1],
    ],
    [
        [1, 1, 0, 0, 0, 0, 0, 0, 1, 1],
        [1, 2, 2, 0, 2, 2, 0, 2, 2, 1],
        [1, 0, 1, 0, 0, 0, 0, 1, 0, 1],
        [1, 2, 0, 0, 3, 0, 0, 0, 2, 1],
        [1, 2, 0, 2, 2, 2, 2, 0, 2, 1],
        [1, 1, 0, 0, 0, 0, 0, 0, 1, 1],
    ],
];

#[error_code]
pub enum PacRoyaleError {
    InvalidChunkIndex,
    InvalidTemplateId,
    InvalidGhostId,
    WorldFrozen,
    NotAuthority,
    PlayerDead,
    PlayerNotDead,
    InvalidDirection,
    NotPowered,
    VictimPowered,
    NotSameCell,
    ScrollNotDue,
    WrongChunk,
    ZeroBalance,
    VaultInsufficient,
    InvalidVault,
    InvalidPayout,
    MoveTooFast,
    PlayerInRemovedChunk,
    ChunkOutsideActiveWindow,
    ChunkLogicalMismatch,
    UnauthorizedWorldInit,
    BalanceMustBeZeroToExit,
    PlayerCountUnderflow,
    NameTooLong,
    MissingDestinationChunk,
}
