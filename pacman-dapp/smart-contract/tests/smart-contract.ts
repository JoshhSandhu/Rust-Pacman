import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PacmanGame } from '../target/types/pacman_game';  //geting the type file
import { expect } from 'chai';

describe("pacman", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PacmanGame as Program<PacmanGame>;

  //unique game address for our game account
  const gameKeypair = anchor.web3.Keypair.generate();

  //testing if the game account gets created
  it("we have a game account", async () => {
    // Add your test here.

    //this provide all the instructons that the createGame struct needs
    await program.methods.createGame().accounts({
      game: gameKeypair.publicKey,
      user: provider.wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([gameKeypair])
    .rpc();

    //retrives the data from the newly created account
    const gameState = await program.account.gameData.fetch(gameKeypair.publicKey);

    expect(gameState.score.toNumber()).to.equal(0);
    expect(gameState.playerX).to.equal(5);
    expect(gameState.playerY).to.equal(5);
    console.log("Your transaction signature");
  });

  //testing if the movement work
  it("we have movement", async () => {
    const direction = 3;
    await program.methods.playerMnt(direction)
    .accounts({
      game:gameKeypair.publicKey,
    })
    .rpc();

    const gameState = await program.account.gameData.fetch(gameKeypair.publicKey);

    //player moves by 1 or not?
    expect(gameState.playerX).to.equal(6);
    expect(gameState.playerY).to.equal(5);

  })
});
