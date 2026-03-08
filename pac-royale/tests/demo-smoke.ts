import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";
import { PacRoyale } from "../target/types/pac_royale";

describe("pac-royale demo smoke", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PacRoyale as Program<PacRoyale>;
  const authority = provider.wallet.publicKey;

  const [worldPda] = PublicKey.findProgramAddressSync([Buffer.from("world")], program.programId);
  const [anteroomPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("anteroom"), worldPda.toBuffer()],
    program.programId
  );
  const [playerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("player"), worldPda.toBuffer(), authority.toBuffer()],
    program.programId
  );

  it("validates world init and basic player tx path", async function () {
    this.timeout(120_000);

    const world = await program.account.world.fetch(worldPda);
    assert.ok(world.authority);

    const anteroom = await program.account.anteroom.fetch(anteroomPda);
    assert.ok(anteroom.vault);

    for (let i = 0; i < 4; i++) {
      const [ghostPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ghost"), worldPda.toBuffer(), Buffer.from([i])],
        program.programId
      );
      const ghost = await program.account.ghost.fetch(ghostPda);
      assert.equal(ghost.ghostId, i);
    }

    let player: any;
    try {
      player = await program.account.player.fetch(playerPda);
    } catch {
      await program.methods
        .spawnPlayer()
        .accounts({
          world: worldPda,
          player: playerPda,
          authority,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      player = await program.account.player.fetch(playerPda);
    }

    const physicalIndex =
      ((player.chunkIndex - world.scrollOffset) % 32 + 32) % 32;
    const [chunkPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("chunk"), worldPda.toBuffer(), Buffer.from([physicalIndex])],
      program.programId
    );

    const [ghost0] = PublicKey.findProgramAddressSync(
      [Buffer.from("ghost"), worldPda.toBuffer(), Buffer.from([0])],
      program.programId
    );
    const [ghost1] = PublicKey.findProgramAddressSync(
      [Buffer.from("ghost"), worldPda.toBuffer(), Buffer.from([1])],
      program.programId
    );
    const [ghost2] = PublicKey.findProgramAddressSync(
      [Buffer.from("ghost"), worldPda.toBuffer(), Buffer.from([2])],
      program.programId
    );
    const [ghost3] = PublicKey.findProgramAddressSync(
      [Buffer.from("ghost"), worldPda.toBuffer(), Buffer.from([3])],
      program.programId
    );

    const sig = await program.methods
      .movement(3)
      .accounts({
        world: worldPda,
        player: playerPda,
        chunk: chunkPda,
        authority,
        ghost0,
        ghost1,
        ghost2,
        ghost3,
      })
      .rpc();

    assert.ok(sig.length > 0);
  });
});
