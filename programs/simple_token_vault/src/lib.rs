use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("2dftvFuYB5H7GFKerZUESaiN6pvqXJgFuqMcQkf6q5ZP");

#[program]
pub mod simple_token_vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, fee: u64) -> Result<()> {
        require!(fee <= 10000, ErrorCode::InvalidFee);
        let vault = &mut ctx.accounts.vault;
        vault.owner = ctx.accounts.owner.key();
        vault.token_mint = ctx.accounts.token_mint.key();
        vault.fee = fee;
        vault.bump = ctx.bumps.vault;
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let user_deposit = &mut ctx.accounts.user_deposit;
        let vault = &ctx.accounts.vault;

        // Initialize user_deposit if needed
        if user_deposit.user == Pubkey::default() {
            user_deposit.user = ctx.accounts.user.key();
            user_deposit.vault = vault.key();
            user_deposit.amount = 0;
        }

        let transfer_instruction = Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                transfer_instruction,
            ),
            amount,
        )?;

        user_deposit.amount = user_deposit
            .amount
            .checked_add(amount)
            .ok_or(ErrorCode::OverflowError)?;

        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let vault = &ctx.accounts.vault;
        let user_deposit = &mut ctx.accounts.user_deposit;

        require!(amount <= user_deposit.amount, ErrorCode::InsufficientFunds);

        let fee_amount = amount
            .checked_mul(vault.fee)
            .unwrap()
            .checked_div(10000)
            .unwrap();
        let withdraw_amount = amount.checked_sub(fee_amount).unwrap();

        let seeds = &[b"vault".as_ref(), &[vault.bump]];
        let signer = &[&seeds[..]];

        let transfer_instruction = Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: vault.to_account_info(),
        };

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                transfer_instruction,
                signer,
            ),
            withdraw_amount,
        )?;

        if fee_amount > 0 {
            let fee_transfer_instruction = Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.fee_account.to_account_info(),
                authority: vault.to_account_info(),
            };

            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    fee_transfer_instruction,
                    signer,
                ),
                fee_amount,
            )?;
        }

        user_deposit.amount = user_deposit
            .amount
            .checked_sub(amount)
            .ok_or(ErrorCode::OverflowError)?;

        Ok(())
    }

    pub fn change_fee(ctx: Context<ChangeFee>, new_fee: u64) -> Result<()> {
        require!(new_fee <= 10000, ErrorCode::InvalidFee);
        let vault = &mut ctx.accounts.vault;
        vault.fee = new_fee;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + 32 + 32 + 8 + 1,
        seeds = [b"vault"],
        bump
    )]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub token_mint: Account<'info, token::Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + 32 + 32 + 8,
        seeds = [b"user_deposit", vault.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_deposit: Account<'info, UserDeposit>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        seeds = [b"vault"],
        bump = vault.bump
    )]
    pub vault: Account<'info, Vault>,
    #[account(
        mut,
        seeds = [b"user_deposit", vault.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub user_deposit: Account<'info, UserDeposit>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub fee_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ChangeFee<'info> {
    #[account(mut, has_one = owner)]
    pub vault: Account<'info, Vault>,
    pub owner: Signer<'info>,
}

#[account]
pub struct Vault {
    pub owner: Pubkey,
    pub token_mint: Pubkey,
    pub fee: u64,
    pub bump: u8,
}

#[account]
pub struct UserDeposit {
    pub user: Pubkey,
    pub vault: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Insufficient funds for withdrawal")]
    InsufficientFunds,
    #[msg("Arithmetic overflow")]
    OverflowError,
    #[msg("Invalid fee percentage")]
    InvalidFee,
}
