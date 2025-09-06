use anchor_lang::prelude::*;

declare_id!("GZqSBraS58kX5ad25TJHPTzchhmN4Ac3uqAVgWvd9AtH");

#[program]
pub mod smart_contract {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
