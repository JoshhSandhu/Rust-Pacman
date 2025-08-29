use anchor_lang::prelude::*;
//main library for writing anchor programs


declare_id!("3HpZLCtECuB6fQHtLQUSpV5SkT41z1ES3pkZv5tak91Z");
//automatically assigned unique address after build by anchor

//main container of our program logic
#[program]   
pub mod pacman_game {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }

    //create a new game
    pub fn create_game(ctx: Context<Create_game>) -> Result<()> {
        Ok(())
    }

    //player movement
    pub fn player_mnt(ctx: Context<Player_move>) -> Result<()>{
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Create_game {}

#[derive(Accounts)]
pub struct Player_move {}

#[account]
pub struct GameData {
    //player score
    //player position
    //pallets left
}