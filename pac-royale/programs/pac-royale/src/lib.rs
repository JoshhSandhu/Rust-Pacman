//! Pac-Royale: Endless Pac-Man on Ephemeral Rollups
//! Economy: 0.001 SOL per pellet, 0.01 SOL per ghost kill; player kill = full balance transfer.
//! Ghost: OG Pac-Man style; touching ghost without power = player dies.

use anchor_lang::prelude::*;

declare_id!("C5JxJHfHuWuCkyRJwen2gMcJ9XzEN8iBhjpZSdoMb57k");

/// 0.001 SOL per pellet
pub const LAMPORTS_PER_PELLET: u64 = 1_000_000;
/// 0.01 SOL per ghost kill
pub const LAMPORTS_PER_GHOST_KILL: u64 = 10_000_000;
pub const CHUNK_ROWS: usize = 6;
pub const CHUNK_COLS: usize = 10;
pub const NUM_CHUNK_TEMPLATES: u8 = 5; // 5 layouts defined; raise when more templates are added
pub const MAX_CHUNKS: u8 = 32;
/// Slots power pellet lasts (~10–20 s depending on slot time)
pub const POWER_PELLET_DURATION_SLOTS: u64 = 200;
pub const NUM_GHOSTS: u8 = 4;

/// Cell: 0 = empty, 1 = wall, 2 = pellet, 3 = power pellet
pub type Cell = u8;
pub const CELL_EMPTY: Cell = 0;
pub const CELL_WALL: Cell = 1;
pub const CELL_PELLET: Cell = 2;
pub const CELL_POWER: Cell = 3;

/// Direction: 0 = Up, 1 = Down, 2 = Left, 3 = Right
pub type Direction = u8;
pub const DIR_UP: Direction = 0;
pub const DIR_DOWN: Direction = 1;
pub const DIR_LEFT: Direction = 2;
pub const DIR_RIGHT: Direction = 3;

/// Ghost state: 0 = chase, 1 = scatter, 2 = frightened
pub type GhostState = u8;
pub const GHOST_CHASE: GhostState = 0;
pub const GHOST_SCATTER: GhostState = 1;
pub const GHOST_FRIGHTENED: GhostState = 2;

#[program]
pub mod pac_royale {
    use super::*;

    /// Initialize the world (one-time, authority). Creates Anteroom. Name: up to 64 bytes.
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

        let clock = Clock::get()?;
        world.next_scroll_slot = clock.slot.saturating_add(100);
        Ok(())
    }

    /// Initialize a single chunk (called for each of MAX_CHUNKS by authority after init_world)
    pub fn init_chunk(ctx: Context<InitChunk>, physical_index: u8, template_id: u8) -> Result<()> {
        require!(physical_index < MAX_CHUNKS, PacRoyaleError::InvalidChunkIndex);
        require!(template_id < NUM_CHUNK_TEMPLATES, PacRoyaleError::InvalidTemplateId);
        let world = &ctx.accounts.world;
        let chunk = &mut ctx.accounts.chunk;
        chunk.world = world.key();
        chunk.physical_index = physical_index;
        chunk.logical_index = physical_index as u32; // at start scroll_offset=0
        chunk.template_id = template_id;
        chunk.set_grid_from_template(template_id);
        Ok(())
    }

    /// Spawn player (no buy-in). Sets position to middle chunk.
    pub fn spawn_player(ctx: Context<SpawnPlayer>) -> Result<()> {
        let world = &mut ctx.accounts.world;
        let player = &mut ctx.accounts.player;
        let clock = Clock::get()?;

        require!(!world.frozen, PacRoyaleError::WorldFrozen);
        world.total_players = world.total_players.saturating_add(1);

        player.authority = Some(ctx.accounts.authority.key());
        player.world = world.key();
        player.payout_wallet = ctx.accounts.authority.key();
        player.chunk_index = world.scroll_offset.saturating_add((MAX_CHUNKS / 2) as u32);
        player.row_in_chunk = CHUNK_ROWS as u8 / 2;
        player.col = CHUNK_COLS as u8 / 2;
        player.direction = DIR_RIGHT;
        player.balance_lamports = 0;
        player.power_pellet_until_slot = 0;
        player.last_move_slot = clock.slot;
        player.bump = ctx.bumps.player;
        player.dead = false;

        Ok(())
    }

    /// Respawn a dead player. Only callable by the player themselves.
    pub fn respawn_player(ctx: Context<RespawnPlayer>) -> Result<()> {
        let world = &ctx.accounts.world;
        let player = &mut ctx.accounts.player;
        let clock = Clock::get()?;

        require!(player.authority == Some(ctx.accounts.authority.key()), PacRoyaleError::NotAuthority);
        require!(player.dead, PacRoyaleError::PlayerNotDead);
        require!(!world.frozen, PacRoyaleError::WorldFrozen);

        player.chunk_index = world.scroll_offset.saturating_add((MAX_CHUNKS / 2) as u32);
        player.row_in_chunk = CHUNK_ROWS as u8 / 2;
        player.col = CHUNK_COLS as u8 / 2;
        player.direction = DIR_RIGHT;
        player.balance_lamports = 0;
        player.power_pellet_until_slot = 0;
        player.last_move_slot = clock.slot;
        player.dead = false;

        Ok(())
    }

    /// Player movement
    pub fn movement(ctx: Context<Movement>, direction: Direction) -> Result<()> {
        let clock = Clock::get()?;
        let world = &ctx.accounts.world;
        let player = &mut ctx.accounts.player;

        require!(player.authority == Some(ctx.accounts.authority.key()), PacRoyaleError::NotAuthority);
        require!(!player.dead, PacRoyaleError::PlayerDead);
        require!(direction <= DIR_RIGHT, PacRoyaleError::InvalidDirection);
        // Rate-limit: at most one move per slot
        require!(clock.slot > player.last_move_slot, PacRoyaleError::MoveTooFast);

        // Teleport player into active map if their chunk was scrolled off
        if player.chunk_index < world.scroll_offset {
            player.chunk_index = world.scroll_offset.saturating_add((MAX_CHUNKS / 2) as u32);
            player.row_in_chunk = CHUNK_ROWS as u8 / 2;
            player.col = CHUNK_COLS as u8 / 2;
            player.last_move_slot = clock.slot;
            return Ok(());
        }

        let chunk = &ctx.accounts.chunk;
        let (new_row, new_col) = move_delta(player.row_in_chunk, player.col, direction);

        // Cross-chunk boundary: update chunk_index instead of clamping
        if direction == DIR_UP && player.row_in_chunk == 0 {
            if player.chunk_index > world.scroll_offset {
                player.chunk_index = player.chunk_index.saturating_sub(1);
                player.row_in_chunk = (CHUNK_ROWS - 1) as u8;
                player.direction = direction;
                player.last_move_slot = clock.slot;
            }
            return Ok(());
        }
        if direction == DIR_DOWN && player.row_in_chunk >= (CHUNK_ROWS - 1) as u8 {
            player.chunk_index = player.chunk_index.saturating_add(1);
            player.row_in_chunk = 0;
            player.direction = direction;
            player.last_move_slot = clock.slot;
            return Ok(());
        }
        if new_col >= CHUNK_COLS as u8 {
            // Horizontal boundary: clamp (no wrapping)
            return Ok(());
        }

        let cell = chunk.grid[new_row as usize][new_col as usize];
        if cell == CELL_WALL {
            return Ok(());
        }

        player.row_in_chunk = new_row;
        player.col = new_col;
        player.direction = direction;
        player.last_move_slot = clock.slot;

        // Ghost collision: check all 4 named ghost accounts
        let ghosts = [
            &ctx.accounts.ghost0,
            &ctx.accounts.ghost1,
            &ctx.accounts.ghost2,
            &ctx.accounts.ghost3,
        ];
        for ghost in ghosts {
            if ghost.chunk_index == player.chunk_index
                && ghost.row == player.row_in_chunk
                && ghost.col == player.col
            {
                if clock.slot > player.power_pellet_until_slot {
                    // Player dies: wipe balance and mark dead. Call respawn_player to re-enter.
                    player.balance_lamports = 0;
                    player.dead = true;
                    return Ok(());
                }
                // Powered: eat ghost via separate eat_ghost instruction
            }
        }

        Ok(())
    }

    /// Eat pellet at current position. +0.001 SOL; if power pellet, set power_pellet_until_slot
    pub fn eat_pellet(ctx: Context<EatPellet>) -> Result<()> {
        let clock = Clock::get()?;
        let player = &mut ctx.accounts.player;
        let chunk = &mut ctx.accounts.chunk;

        let world = &ctx.accounts.world;
        require!(player.authority == Some(ctx.accounts.authority.key()), PacRoyaleError::NotAuthority);
        require!(!player.dead, PacRoyaleError::PlayerDead);
        // Guard: player must be in the active map window
        require!(player.chunk_index >= world.scroll_offset, PacRoyaleError::PlayerInRemovedChunk);

        let cell = chunk.grid[player.row_in_chunk as usize][player.col as usize];
        if cell == CELL_PELLET {
            player.balance_lamports = player.balance_lamports.saturating_add(LAMPORTS_PER_PELLET);
            chunk.grid[player.row_in_chunk as usize][player.col as usize] = CELL_EMPTY;
        } else if cell == CELL_POWER {
            player.balance_lamports = player.balance_lamports.saturating_add(LAMPORTS_PER_PELLET);
            player.power_pellet_until_slot = clock.slot.saturating_add(POWER_PELLET_DURATION_SLOTS);
            chunk.grid[player.row_in_chunk as usize][player.col as usize] = CELL_EMPTY;
        }
        Ok(())
    }

    /// Eat another player (only when eater has power and victim does not). Transfer full balance.
    pub fn eat_player(ctx: Context<EatPlayer>) -> Result<()> {
        let clock = Clock::get()?;
        let eater = &mut ctx.accounts.eater;
        let victim = &mut ctx.accounts.victim;

        require!(eater.authority == Some(ctx.accounts.authority.key()), PacRoyaleError::NotAuthority);
        require!(!eater.dead && !victim.dead, PacRoyaleError::PlayerDead);
        require!(clock.slot <= eater.power_pellet_until_slot, PacRoyaleError::NotPowered);
        require!(clock.slot > victim.power_pellet_until_slot, PacRoyaleError::VictimPowered);
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
        // Victim respawns on next spawn_player or we have respawn instruction
        Ok(())
    }

    /// Initialize a ghost (authority, after init_world). Call for ghost_id 0..NUM_GHOSTS-1.
    pub fn init_ghost(ctx: Context<InitGhost>, ghost_id: u8) -> Result<()> {
        require!(ghost_id < NUM_GHOSTS, PacRoyaleError::InvalidGhostId);
        let world = &ctx.accounts.world;
        let ghost = &mut ctx.accounts.ghost;
        ghost.world = world.key();
        ghost.ghost_id = ghost_id;
        ghost.chunk_index = world.scroll_offset.saturating_add((MAX_CHUNKS / 2) as u32);
        ghost.row = CHUNK_ROWS as u8 / 2;
        ghost.col = CHUNK_COLS as u8 / 2;
        ghost.state = GHOST_CHASE;
        ghost.direction = DIR_UP;
        ghost.bump = ctx.bumps.ghost;
        Ok(())
    }

    /// Eat ghost (only when powered). +0.01 SOL, ghost respawns.
    pub fn eat_ghost(ctx: Context<EatGhost>, ghost_id: u8) -> Result<()> {
        let clock = Clock::get()?;
        let player = &mut ctx.accounts.player;
        let ghost = &mut ctx.accounts.ghost;
        let world = &ctx.accounts.world;

        require!(player.authority == Some(ctx.accounts.authority.key()), PacRoyaleError::NotAuthority);
        require!(!player.dead, PacRoyaleError::PlayerDead);
        require!(clock.slot <= player.power_pellet_until_slot, PacRoyaleError::NotPowered);
        require!(
            player.chunk_index == ghost.chunk_index
                && player.row_in_chunk == ghost.row
                && player.col == ghost.col,
            PacRoyaleError::NotSameCell
        );

        player.balance_lamports = player.balance_lamports.saturating_add(LAMPORTS_PER_GHOST_KILL);
        ghost_respawn(ghost, world)?;
        Ok(())
    }

    /// Scroll map: remove bottom chunk, add new at top. Any player in removed chunk respawns at top.
    pub fn scroll_map(ctx: Context<ScrollMap>) -> Result<()> {
        let clock = Clock::get()?;
        let world = &mut ctx.accounts.world;
        require!(clock.slot >= world.next_scroll_slot, PacRoyaleError::ScrollNotDue);
        world.next_scroll_slot = clock.slot.saturating_add(50); // next scroll in 50 slots

        let bottom_physical = (world.scroll_offset % MAX_CHUNKS as u32) as u8;
        let new_logical = world.scroll_offset + MAX_CHUNKS as u32;
        world.scroll_offset = world.scroll_offset.saturating_add(1);

        let chunk = &mut ctx.accounts.chunk;
        require!(chunk.physical_index == bottom_physical, PacRoyaleError::WrongChunk);
        chunk.logical_index = new_logical;
        let new_template_id = clock.slot as u8 % NUM_CHUNK_TEMPLATES;
        chunk.template_id = new_template_id;
        chunk.set_grid_from_template(new_template_id);

        Ok(())
    }

    /// Exit / cash out: transfer balance to payout_wallet (L1). Requires undelegation from ER first in production.
    pub fn cash_out(ctx: Context<CashOut>) -> Result<()> {
        let player = &mut ctx.accounts.player;
        let amount = player.balance_lamports;
        require!(player.authority == Some(ctx.accounts.authority.key()), PacRoyaleError::NotAuthority);
        require!(amount > 0, PacRoyaleError::ZeroBalance);

        // Vault solvency check: prevent panic on underflow
        let vault_lamports = ctx.accounts.vault.to_account_info().lamports();
        require!(vault_lamports >= amount, PacRoyaleError::VaultInsufficient);

        **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.payout.to_account_info().try_borrow_mut_lamports()? += amount;
        player.balance_lamports = 0;

        Ok(())
    }

    /// Force-remove inactive player (anyone can call if scheduled_removal_time passed).
    pub fn exit_player(ctx: Context<ExitPlayer>) -> Result<()> {
        let player = &mut ctx.accounts.player;
        player.authority = None;
        player.dead = true;
        let world = &mut ctx.accounts.world;
        world.total_players = world.total_players.saturating_sub(1);
        Ok(())
    }
}

// --- Helpers ---
fn move_delta(row: u8, col: u8, dir: Direction) -> (u8, u8) {
    match dir {
        DIR_UP => (row.saturating_sub(1), col),
        DIR_DOWN => (row.saturating_add(1), col),
        DIR_LEFT => (row, col.saturating_sub(1)),
        DIR_RIGHT => (row, col.saturating_add(1)),
        _ => (row, col),
    }
}

fn ghost_respawn(ghost: &mut Account<Ghost>, world: &Account<World>) -> Result<()> {
    ghost.chunk_index = world.scroll_offset.saturating_add((MAX_CHUNKS / 2) as u32);
    ghost.row = CHUNK_ROWS as u8 / 2;
    ghost.col = CHUNK_COLS as u8 / 2;
    ghost.state = GHOST_CHASE;
    ghost.direction = DIR_UP;
    Ok(())
}

// --- Accounts ---

#[derive(Accounts)]
pub struct InitWorld<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 64 + 1 + 4 + 8 + 4 + 1 + 33 + 1,
        seeds = [b"world"],
        bump
    )]
    pub world: Account<'info, World>,

    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 32 + 1,
        seeds = [b"anteroom", world.key().as_ref()],
        bump
    )]
    pub anteroom: Account<'info, Anteroom>,

    /// CHECK: Vault account holding SOL for payouts
    #[account(mut)]
    pub vault: AccountInfo<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(physical_index: u8, template_id: u8)]
pub struct InitChunk<'info> {
    #[account(has_one = authority @ PacRoyaleError::NotAuthority)]
    pub world: Account<'info, World>,

    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 1 + 4 + 1 + (CHUNK_ROWS * CHUNK_COLS),
        seeds = [b"chunk", world.key().as_ref(), &[physical_index]],
        bump
    )]
    pub chunk: Account<'info, Chunk>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SpawnPlayer<'info> {
    #[account(mut)]
    pub world: Account<'info, World>,

    #[account(
        init,
        payer = authority,
        space = 8 + 33 + 32 + 32 + 4 + 1 + 1 + 1 + 8 + 8 + 8 + 1 + 1,
        seeds = [b"player", world.key().as_ref(), authority.key().as_ref()],
        bump
    )]
    pub player: Account<'info, Player>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Movement<'info> {
    // world is read-only in movement; removing write lock enables parallel execution on ER
    pub world: Account<'info, World>,

    #[account(
        mut,
        seeds = [b"player", world.key().as_ref(), authority.key().as_ref()],
        bump = player.bump
    )]
    pub player: Account<'info, Player>,

    #[account(
        mut,
        constraint = chunk.world == world.key() @ PacRoyaleError::WrongChunk,
        constraint = chunk.physical_index == ((player.chunk_index.saturating_sub(world.scroll_offset)) % MAX_CHUNKS as u32) as u8 @ PacRoyaleError::WrongChunk
    )]
    pub chunk: Account<'info, Chunk>,

    pub authority: Signer<'info>,

    // All 4 ghost PDAs are required — cannot be omitted by callers
    #[account(seeds = [b"ghost", world.key().as_ref(), &[0u8]], bump = ghost0.bump, constraint = ghost0.world == world.key())]
    pub ghost0: Account<'info, Ghost>,
    #[account(seeds = [b"ghost", world.key().as_ref(), &[1u8]], bump = ghost1.bump, constraint = ghost1.world == world.key())]
    pub ghost1: Account<'info, Ghost>,
    #[account(seeds = [b"ghost", world.key().as_ref(), &[2u8]], bump = ghost2.bump, constraint = ghost2.world == world.key())]
    pub ghost2: Account<'info, Ghost>,
    #[account(seeds = [b"ghost", world.key().as_ref(), &[3u8]], bump = ghost3.bump, constraint = ghost3.world == world.key())]
    pub ghost3: Account<'info, Ghost>,
}

#[derive(Accounts)]
pub struct EatPellet<'info> {
    #[account(mut)]
    pub world: Account<'info, World>,

    #[account(
        mut,
        seeds = [b"player", world.key().as_ref(), authority.key().as_ref()],
        bump = player.bump
    )]
    pub player: Account<'info, Player>,

    #[account(
        mut,
        constraint = chunk.world == world.key(),
        constraint = chunk.physical_index == ((player.chunk_index.saturating_sub(world.scroll_offset)) % MAX_CHUNKS as u32) as u8
    )]
    pub chunk: Account<'info, Chunk>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct EatPlayer<'info> {
    #[account(
        mut,
        seeds = [b"player", world.key().as_ref(), authority.key().as_ref()],
        bump = eater.bump
    )]
    pub eater: Account<'info, Player>,

    #[account(
        mut,
        seeds = [b"player", world.key().as_ref(), victim_authority.key().as_ref()],
        bump = victim.bump,
        constraint = victim.world == world.key()
    )]
    pub victim: Account<'info, Player>,

    #[account(mut)]
    pub world: Account<'info, World>,

    pub authority: Signer<'info>,
    /// CHECK: victim's wallet (for PDA derivation)
    pub victim_authority: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(ghost_id: u8)]
pub struct InitGhost<'info> {
    #[account(has_one = authority @ PacRoyaleError::NotAuthority)]
    pub world: Account<'info, World>,

    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 1 + 4 + 1 + 1 + 1 + 1 + 1,
        seeds = [b"ghost", world.key().as_ref(), &[ghost_id]],
        bump
    )]
    pub ghost: Account<'info, Ghost>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(ghost_id: u8)]
pub struct EatGhost<'info> {
    #[account(mut)]
    pub world: Account<'info, World>,

    #[account(
        mut,
        seeds = [b"player", world.key().as_ref(), authority.key().as_ref()],
        bump = player.bump
    )]
    pub player: Account<'info, Player>,

    #[account(
        mut,
        seeds = [b"ghost", world.key().as_ref(), &[ghost_id]],
        bump = ghost.bump,
        constraint = ghost.world == world.key()
    )]
    pub ghost: Account<'info, Ghost>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ScrollMap<'info> {
    #[account(mut, has_one = authority @ PacRoyaleError::NotAuthority)]
    pub world: Account<'info, World>,

    #[account(
        mut,
        constraint = chunk.world == world.key() @ PacRoyaleError::WrongChunk,
        constraint = chunk.physical_index == (world.scroll_offset % MAX_CHUNKS as u32) as u8 @ PacRoyaleError::WrongChunk
    )]
    pub chunk: Account<'info, Chunk>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct CashOut<'info> {
    #[account(
        mut,
        seeds = [b"player", world.key().as_ref(), authority.key().as_ref()],
        bump = player.bump
    )]
    pub player: Account<'info, Player>,

    #[account(
        seeds = [b"anteroom", world.key().as_ref()],
        bump = anteroom.bump,
        constraint = anteroom.world == world.key() @ PacRoyaleError::WrongChunk
    )]
    pub anteroom: Account<'info, Anteroom>,

    pub world: Account<'info, World>,

    /// CHECK: Vault must match the address stored in anteroom
    #[account(
        mut,
        constraint = vault.key() == anteroom.vault @ PacRoyaleError::InvalidVault
    )]
    pub vault: AccountInfo<'info>,

    /// CHECK: Payout must be the player's registered payout wallet
    #[account(
        mut,
        constraint = payout.key() == player.payout_wallet @ PacRoyaleError::InvalidPayout
    )]
    pub payout: AccountInfo<'info>,

    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RespawnPlayer<'info> {
    pub world: Account<'info, World>,

    #[account(
        mut,
        seeds = [b"player", world.key().as_ref(), authority.key().as_ref()],
        bump = player.bump
    )]
    pub player: Account<'info, Player>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct ExitPlayer<'info> {
    #[account(mut)]
    pub world: Account<'info, World>,

    #[account(
        mut,
        seeds = [b"player", world.key().as_ref(), authority.key().as_ref()],
        bump = player.bump
    )]
    pub player: Account<'info, Player>,

    pub authority: Signer<'info>,
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

// 30 chunk templates (6x10). For now 5 patterns repeated.
const CHUNK_TEMPLATES: [[[Cell; CHUNK_COLS]; CHUNK_ROWS]; 5] = [
    // 0: borders + pellets
    [
        [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        [1, 2, 2, 2, 0, 0, 2, 2, 2, 1],
        [1, 2, 1, 0, 2, 2, 0, 1, 2, 1],
        [1, 0, 0, 2, 3, 2, 0, 0, 0, 1],
        [1, 2, 2, 0, 2, 2, 0, 2, 2, 1],
        [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    ],
    [
        [1, 1, 1, 1, 0, 0, 1, 1, 1, 1],
        [1, 2, 0, 2, 2, 2, 2, 0, 2, 1],
        [1, 0, 1, 1, 0, 0, 1, 1, 0, 1],
        [1, 2, 2, 2, 3, 2, 2, 2, 2, 1],
        [1, 1, 0, 1, 0, 0, 1, 0, 1, 1],
        [1, 2, 2, 2, 2, 2, 2, 2, 2, 1],
    ],
    [
        [1, 1, 1, 0, 0, 0, 0, 1, 1, 1],
        [1, 2, 2, 2, 1, 1, 2, 2, 2, 1],
        [1, 0, 0, 0, 2, 2, 0, 0, 0, 1],
        [1, 2, 1, 2, 3, 2, 2, 1, 2, 1],
        [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
        [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    ],
    [
        [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        [1, 0, 2, 2, 0, 0, 2, 2, 0, 1],
        [1, 2, 1, 0, 2, 2, 0, 1, 2, 1],
        [1, 2, 0, 2, 3, 0, 2, 0, 2, 1],
        [1, 0, 2, 0, 2, 2, 0, 2, 0, 1],
        [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    ],
    [
        [1, 1, 0, 0, 1, 1, 0, 0, 1, 1],
        [1, 2, 2, 2, 0, 0, 2, 2, 2, 1],
        [1, 0, 1, 1, 2, 2, 1, 1, 0, 1],
        [1, 2, 0, 2, 3, 2, 0, 2, 2, 1],
        [1, 1, 2, 0, 0, 0, 0, 2, 1, 1],
        [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
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
    NameTooLong,
}
