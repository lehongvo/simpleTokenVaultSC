import * as anchor from '@project-serum/anchor'
import { Program } from '@project-serum/anchor'
import { SimpleTokenVault } from '../target/types/simple_token_vault'
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  createMint,
  getAssociatedTokenAddress,
  mintTo,
  getAccount,
  createAccount
} from '@solana/spl-token'
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js'
import { assert, expect } from 'chai'

describe('simple_token_vault', () => {
  const provider = anchor.AnchorProvider.env()
  anchor.setProvider(provider)

  const program = anchor.workspace.SimpleTokenVault as Program<SimpleTokenVault>
  const wallet = provider.wallet as anchor.Wallet

  let mint: PublicKey
  const fee = 500
  let vaultPda: PublicKey
  let vaultBump: number
  let vaultTokenAccount: PublicKey
  let userTokenAccount: PublicKey

  before(async () => {
    mint = await createMint(
      provider.connection,
      wallet.payer,
      wallet.publicKey,
      null,
      9
    );

    [vaultPda, vaultBump] = await PublicKey.findProgramAddress(
      [Buffer.from('vault')],
      program.programId
    )

    userTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      mint,
      wallet.publicKey
    )
  })

  it("Initializes the vault", async () => {
    try {
      await program.methods
        .initialize(new anchor.BN(fee))
        .accounts({
          vault: vaultPda,
          owner: wallet.publicKey,
          tokenMint: mint,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const vaultAccount = await program.account.vault.fetch(vaultPda);

      assert.isTrue(vaultAccount.owner.equals(wallet.publicKey), "Vault owner should match");
      assert.isTrue(vaultAccount.tokenMint.equals(mint), "Token mint should match");
      assert.equal(vaultAccount.fee.toNumber(), fee, "Fee should match");
      assert.equal(vaultAccount.bump, vaultBump, "Bump should match");

      console.log("Vault initialized successfully!");
    } catch (error) {
      console.error("Error initializing vault:", error);
      throw error;
    }
  });

  it('Deposits tokens into the existing vault', async () => {
    try {
      // Fetch the vault account to ensure it exists
      const vaultAccount = await program.account.vault.fetch(vaultPda)

      // Create vault token account (regular account, not ATA)
      const vaultTokenAccountKeypair = Keypair.generate()
      vaultTokenAccount = await createAccount(
        provider.connection,
        wallet.payer,
        mint,
        vaultPda,
        vaultTokenAccountKeypair
      )


      const depositAmount = 10000000000 // 10 token (assuming 9 decimals)
      const txMint = await mintTo(
        provider.connection,
        wallet.payer,
        mint,
        userTokenAccount,
        wallet.publicKey,
        depositAmount
      )
      console.log('Mint transaction:', txMint)

      // Create PDA for user deposit
      const [userDepositPda] = await PublicKey.findProgramAddress(
        [
          Buffer.from('user_deposit'),
          vaultPda.toBuffer(),
          wallet.publicKey.toBuffer()
        ],
        program.programId
      )
      const userDepositAccountBefore = await program.account.userDeposit.fetch(
        userDepositPda
      )
      const vaultTokenAccountInfoBefore =
        await provider.connection.getTokenAccountBalance(vaultTokenAccount)

      const txDeposit = await program.methods
        .deposit(new anchor.BN(depositAmount))
        .accounts({
          vault: vaultPda,
          userDeposit: userDepositPda,
          user: wallet.publicKey,
          userTokenAccount: userTokenAccount,
          vaultTokenAccount: vaultTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId
        })
        .rpc()
      console.log('Deposit transaction:', txDeposit)

      const userDepositAccountAfter = await program.account.userDeposit.fetch(
        userDepositPda
      )

      assert.equal(
        userDepositAccountAfter.amount.toNumber(),
        userDepositAccountBefore.amount.toNumber() + depositAmount,
        'Deposit amount should match'
      )

      assert.equal(
        depositAmount,
        vaultTokenAccountInfoBefore.value.uiAmount + depositAmount,
        'Vault token account balance should match'
      )
    } catch (error) {
      console.error('Error:', error)
      throw error
    }
  })

  it('Withdraws tokens from the vault', async () => {
    const [userDepositPda] = await PublicKey.findProgramAddress(
      [
        Buffer.from('user_deposit'),
        vaultPda.toBuffer(),
        wallet.publicKey.toBuffer()
      ],
      program.programId
    )

    const vaultAccount = await program.account.vault.fetch(vaultPda);
    const userDepositAccountBefore = await program.account.userDeposit.fetch(userDepositPda);
    const vaultTokenAccountInfoBefore = await provider.connection.getTokenAccountBalance(vaultTokenAccount);
    const userTokenAccountInfoBefore = await provider.connection.getTokenAccountBalance(userTokenAccount);

    const withdrawAmount = 1000000000; // 5 tokens (assuming 9 decimals)
    const feeAmount = Math.floor(withdrawAmount * vaultAccount.fee.toNumber() / 10000);
    const expectedWithdrawAmount = withdrawAmount - feeAmount;

    await program.methods
      .withdraw(new anchor.BN(withdrawAmount))
      .accounts({
        vault: vaultPda,
        userDeposit: userDepositPda,
        user: wallet.publicKey,
        userTokenAccount: userTokenAccount,
        vaultTokenAccount: vaultTokenAccount,
        feeAccount: userTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    assert(userDepositAccountBefore.amount.toNumber() - withdrawAmount === userDepositAccountBefore.amount.toNumber(), 'User deposit amount should match');
    assert(vaultTokenAccountInfoBefore.value.uiAmount - withdrawAmount === vaultTokenAccountInfoBefore.value.uiAmount, 'Vault token account balance should match');
    assert(userTokenAccountInfoBefore.value.uiAmount + expectedWithdrawAmount === userTokenAccountInfoBefore.value.uiAmount, 'User token account balance should match');
  })
})
