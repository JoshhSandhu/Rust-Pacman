import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PacmanGame } from '../target/types/pacman_game';
import { expect } from 'chai';
import { PublicKey } from '@solana/web3.js'; // Import PublicKey
import { Buffer } from 'buffer'; // Import Buffer

describe("pacman", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PacmanGame as Program<PacmanGame>;
  
  // We no longer need a keypair for the game.
  // Instead, we will calculate its PDA.
  let gamePda: PublicKey;

  // Find the PDA before running the tests
  before(async () => {
    [gamePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("game"), provider.wallet.publicKey.toBuffer()],
      program.programId
    );
  });

  // Test if the PDA game account gets created
  it("we have a game account", async () => {
    // Call the create_game instruction
    await program.methods.createGame().accounts({
      game: gamePda, // Pass the calculated PDA
      user: provider.wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    // The .signers() array is REMOVED because the program signs for the PDA
    .rpc();

    // Retrieve the data from the newly created PDA
    const gameState = await program.account.gameData.fetch(gamePda);

    expect(gameState.score.toNumber()).to.equal(0);
    expect(gameState.playerX).to.equal(5);
    expect(gameState.playerY).to.equal(5);
  });

  // Test if the movement works on the PDA
  it("we have movement", async () => {
    const direction = 3; // 3 = Right
    await program.methods.playerMnt(direction)
    .accounts({
      game: gamePda, // Pass the game PDA
      user: provider.wallet.publicKey, // The user is now required for seeds
    })
    .rpc();

    const gameState = await program.account.gameData.fetch(gamePda);

    // Check if the player moved by 1
    expect(gameState.playerX).to.equal(6);
    expect(gameState.playerY).to.equal(5);
  });
});