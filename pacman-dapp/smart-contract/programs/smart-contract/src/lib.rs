use anchor_lang::prelude::*;
//main library for writing anchor programs


declare_id!("3HpZLCtECuB6fQHtLQUSpV5SkT41z1ES3pkZv5tak91Z");
//automatically assigned unique address after build by anchor
//this is of 8 bytes

//adding the board to the contract
// here in the board 0 = pellet, 1 = wall, 2 = empty space

const LEVEL_LAYOUT: [[u8; 10]; 10] = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 0, 0, 1, 1, 0, 1],
  [1, 0, 0, 0, 0, 1, 0, 0, 0, 1],
  [1, 0, 1, 0, 0, 0, 0, 1, 0, 1],
  [1, 0, 1, 0, 0, 2, 0, 1, 0, 1],
  [1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
  [1, 0, 1, 1, 1, 1, 1, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
];

//main container of our program logic
#[program]   
pub mod pacman_game {
    use super::*;

    //create a new game
    pub fn create_game(ctx: Context<CreateGame>) -> Result<()> {
        
        //mut ref to game account
        let game = &mut ctx.accounts.game;

        //set player init pos
        game.player_x = 5;
        game.player_y = 5;
        game.score = 0;
        game.board = LEVEL_LAYOUT; //incudin the level layout in the game data
        Ok(())
    }

    //player movement
    pub fn player_mnt(ctx: Context<PlayerMove>, direction: u8) -> Result<()>{
        let game = &mut ctx.accounts.game;

        let mut targetX = game.player_x;
        let mut targetY = game.player_y;

        // 0 = Up, 1 = Down, 2 = Left, 3 = Right
        match direction {
            // Move Up
            0 => {
                // checked_sub prevents underflow (going below 0)
                targetY = game.player_y.saturating_sub(1);  // we user .saturating_add(1) to prevent underflow
            }
            // Move Down
            1 => {
                targetY = game.player_y.saturating_add(1);
            }
            // Move Left
            2 => {
                targetX = game.player_x.saturating_sub(1);
            }
            // Move Right
            3 => {
                targetX = game.player_x.saturating_add(1);
            }
            _ => {
                // If any other number is sent, do nothing
            }
        }

        // checking for wall collision
        if game.board[targetY as usize][targetX as usize] == 1{ 
            return Ok(());
        }

        if game.board[targetY as usize][targetX as usize] == 0{  // means we found a pallet
            game.score += 10;
            game.board[targetY as usize][targetX as usize] = 2; // means we ate the pellet
        }

        game.player_x = targetX;
        game.player_y = targetY;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct CreateGame<'info>{  //these are contexts
    
    //this tell anchor to create a new account for create game struct
    #[account(
        init,  //tells sol we want to initialize a new account
        payer = user,  //this guy will pay for the transaction
        space = 8 + 8 + 1 + 1 + 100, // the space used by the game data + 10X10 board takes 100 bytes
        seeds = [b"game", user.key().as_ref()],
        bump
    )]
    pub game: Account<'info, GameData>,

    //the player that is creating the game and paying for it
    #[account(mut)]
    pub user: Signer<'info>,  //proof that the user has approved the transcation

    //solana program required for creating accounts
    pub system_program: Program<'info, System>,
    
}

#[derive(Accounts)]
pub struct PlayerMove<'info> {

    //permision to change stuff in the game data
    #[account(mut,
        seeds = [b"game", user.key().as_ref()],
        bump
    )]
    pub game: Account<'info, GameData>,
    pub user: Signer<'info>,
}

#[account]
pub struct GameData {
    //player score
    pub score: u64,
    //player position
    pub player_x: u8,
    pub player_y: u8,
    pub board: [[u8; 10]; 10], // 10X10 board

    //this takes up 18 bytes of space 1(posx) + 1(posy) + 8(score) + 8(pre alooted anchor unique identigyier)
}