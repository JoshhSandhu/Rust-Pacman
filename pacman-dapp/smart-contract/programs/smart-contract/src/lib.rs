use anchor_lang::prelude::*;
//main library for writing anchor programs


declare_id!("3HpZLCtECuB6fQHtLQUSpV5SkT41z1ES3pkZv5tak91Z");
//automatically assigned unique address after build by anchor
//this is of 8 bytes

//main container of our program logic
#[program]   
pub mod pacman_game {
    use super::*;

    // pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
    //     msg!("Greetings from: {:?}", ctx.program_id);
    //     Ok(())
    // }

    //create a new game
    pub fn create_game(ctx: Context<CreateGame>) -> Result<()> {
        
        //mut ref to game account
        let game = &mut ctx.accounts.game;

        //set player init pos
        game.player_x = 5;
        game.player_y = 5;
        game.score = 0;
        Ok(())
    }

    //player movement
    pub fn player_mnt(ctx: Context<PlayerMove>, direction: u8) -> Result<()>{
        let game = &mut ctx.accounts.game;

        match direction {
            3 => {
                game.player_x = game.player_x.checked_add(1).unwrap();
            }
            _ => {
                //do nothting
            }
        }
        Ok(())
    }
}

#[derive(Accounts)]
pub struct CreateGame<'info>{
    
    //this tell anchor to create a new account for create game struct
    #[account(
        init,  //tells sol we want to initialize a new account
        payer = user,  //this guy will pay for the transaction
        space = 18  // the space used by the game data
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
    #[account(mut)]
    pub game: Account<'info, GameData>,

}

#[account]
pub struct GameData {
    //player score
    pub score: u64,
    //player position
    pub player_x: u8,
    pub player_y: u8,

    //this takes up 18 bytes of space 1(posx) + 1(posy) + 8(score) + 8(pre alooted anchor unique identigyier)
}