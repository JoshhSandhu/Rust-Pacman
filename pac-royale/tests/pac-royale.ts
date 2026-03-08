import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PacRoyale } from "../target/types/pac_royale";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";

describe("pac-royale", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PacRoyale as Program<PacRoyale>;
  const authority = provider.wallet as anchor.Wallet;

  let worldPda: PublicKey;
  let worldBump: number;
  let anteroomPda: PublicKey;
  let anteroomBump: number;
  let vaultKeypair: Keypair;

  before(async () => {
    // Derive World PDA
    [worldPda, worldBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("world")],
      program.programId
    );

    // Derive Anteroom PDA
    [anteroomPda, anteroomBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("anteroom"), worldPda.toBuffer()],
      program.programId
    );

    // Create vault keypair
    vaultKeypair = Keypair.generate();
  });

  describe("World Initialization", () => {
    it("Initializes the world successfully", async () => {
      const worldName = Buffer.from("Pac-Royale Arena");

      const tx = await program.methods
        .initWorld(Array.from(worldName))
        .accounts({
          world: worldPda,
          anteroom: anteroomPda,
          vault: vaultKeypair.publicKey,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Init world transaction signature:", tx);

      // Fetch and verify world account
      const worldAccount = await program.account.world.fetch(worldPda);
      assert.ok(worldAccount.authority.equals(authority.publicKey));
      assert.equal(worldAccount.chunkCount, 32);
      assert.equal(worldAccount.scrollOffset, 0);
      assert.equal(worldAccount.totalPlayers, 0);
      assert.equal(worldAccount.frozen, false);

      // Verify name
      const nameBytes = worldAccount.name.slice(0, worldName.length);
      assert.deepEqual(Buffer.from(nameBytes), worldName);

      // Fetch and verify anteroom
      const anteroomAccount = await program.account.anteroom.fetch(anteroomPda);
      assert.ok(anteroomAccount.world.equals(worldPda));
      assert.ok(anteroomAccount.authority.equals(authority.publicKey));
      assert.ok(anteroomAccount.vault.equals(vaultKeypair.publicKey));
    });
  });

  describe("Chunk Initialization", () => {
    it("Initializes chunks 0-31 with different templates", async () => {
      const numChunks = 32;
      const numTemplates = 5;

      for (let i = 0; i < numChunks; i++) {
        const physicalIndex = i;
        const templateId = i % numTemplates;

        const [chunkPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("chunk"), worldPda.toBuffer(), Buffer.from([physicalIndex])],
          program.programId
        );

        const tx = await program.methods
          .initChunk(physicalIndex, templateId)
          .accounts({
            world: worldPda,
            chunk: chunkPda,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        // Verify chunk
        const chunkAccount = await program.account.chunk.fetch(chunkPda);
        assert.ok(chunkAccount.world.equals(worldPda));
        assert.equal(chunkAccount.physicalIndex, physicalIndex);
        assert.equal(chunkAccount.logicalIndex, physicalIndex);
        assert.equal(chunkAccount.templateId, templateId);

        // Verify grid is initialized (should have walls, pellets, etc.)
        assert.ok(chunkAccount.grid.length === 6);
        assert.ok(chunkAccount.grid[0].length === 10);

        if (i % 8 === 0) {
          console.log(`Initialized chunk ${i}/${numChunks}`);
        }
      }

      console.log("All 32 chunks initialized successfully");
    });
  });

  describe("Ghost Initialization", () => {
    it("Initializes 4 ghosts", async () => {
      const numGhosts = 4;

      for (let ghostId = 0; ghostId < numGhosts; ghostId++) {
        const [ghostPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("ghost"), worldPda.toBuffer(), Buffer.from([ghostId])],
          program.programId
        );

        const tx = await program.methods
          .initGhost(ghostId)
          .accounts({
            world: worldPda,
            ghost: ghostPda,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        // Verify ghost
        const ghostAccount = await program.account.ghost.fetch(ghostPda);
        assert.ok(ghostAccount.world.equals(worldPda));
        assert.equal(ghostAccount.ghostId, ghostId);
        assert.equal(ghostAccount.state, 0); // GHOST_CHASE
        assert.equal(ghostAccount.direction, 0); // DIR_UP

        console.log(`Initialized ghost ${ghostId}`);
      }
    });
  });

  describe("Player Spawn and Movement", () => {
    let player1Pda: PublicKey;
    let player2Keypair: Keypair;
    let player2Pda: PublicKey;

    it("Spawns player 1", async () => {
      [player1Pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("player"), worldPda.toBuffer(), authority.publicKey.toBuffer()],
        program.programId
      );

      const tx = await program.methods
        .spawnPlayer()
        .accounts({
          world: worldPda,
          player: player1Pda,
          authority: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Spawn player transaction:", tx);

      // Verify player
      const playerAccount = await program.account.player.fetch(player1Pda);
      assert.ok(playerAccount.authority.equals(authority.publicKey));
      assert.ok(playerAccount.world.equals(worldPda));
      assert.equal(playerAccount.balanceLamports.toNumber(), 0);
      assert.equal(playerAccount.dead, false);
      assert.equal(playerAccount.chunkIndex, 16); // Middle chunk
      assert.equal(playerAccount.rowInChunk, 3); // Middle row
      assert.equal(playerAccount.col, 5); // Middle col

      // Verify world player count increased
      const worldAccount = await program.account.world.fetch(worldPda);
      assert.equal(worldAccount.totalPlayers, 1);
    });

    it("Moves player in valid direction", async () => {
      const [chunkPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("chunk"), worldPda.toBuffer(), Buffer.from([16])],
        program.programId
      );
      const [ghost0Pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ghost"), worldPda.toBuffer(), Buffer.from([0])],
        program.programId
      );
      const [ghost1Pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ghost"), worldPda.toBuffer(), Buffer.from([1])],
        program.programId
      );
      const [ghost2Pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ghost"), worldPda.toBuffer(), Buffer.from([2])],
        program.programId
      );
      const [ghost3Pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ghost"), worldPda.toBuffer(), Buffer.from([3])],
        program.programId
      );

      // Move right (direction 3)
      const tx = await program.methods
        .movement(3)
        .accounts({
          world: worldPda,
          player: player1Pda,
          chunk: chunkPda,
          authority: authority.publicKey,
          ghost0: ghost0Pda,
          ghost1: ghost1Pda,
          ghost2: ghost2Pda,
          ghost3: ghost3Pda,
        })
        .rpc();

      const playerAccount = await program.account.player.fetch(player1Pda);
      assert.equal(playerAccount.direction, 3);
      // Position may or may not change depending on walls
    });

    it("Spawns player 2 for multiplayer tests", async () => {
      player2Keypair = Keypair.generate();

      // Airdrop to player 2
      const airdropSig = await provider.connection.requestAirdrop(
        player2Keypair.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdropSig);

      [player2Pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("player"), worldPda.toBuffer(), player2Keypair.publicKey.toBuffer()],
        program.programId
      );

      const tx = await program.methods
        .spawnPlayer()
        .accounts({
          world: worldPda,
          player: player2Pda,
          authority: player2Keypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([player2Keypair])
        .rpc();

      const worldAccount = await program.account.world.fetch(worldPda);
      assert.equal(worldAccount.totalPlayers, 2);
    });
  });

  describe("Pellet Eating", () => {
    let playerPda: PublicKey;
    let testPlayerKeypair: Keypair;

    before(async () => {
      testPlayerKeypair = Keypair.generate();
      
      // Airdrop
      const airdropSig = await provider.connection.requestAirdrop(
        testPlayerKeypair.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdropSig);

      [playerPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("player"), worldPda.toBuffer(), testPlayerKeypair.publicKey.toBuffer()],
        program.programId
      );

      // Spawn player
      await program.methods
        .spawnPlayer()
        .accounts({
          world: worldPda,
          player: playerPda,
          authority: testPlayerKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([testPlayerKeypair])
        .rpc();
    });

    it("Eats pellet and increases balance", async () => {
      const playerBefore = await program.account.player.fetch(playerPda);
      const chunkIndex = playerBefore.chunkIndex;
      
      const [chunkPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("chunk"), worldPda.toBuffer(), Buffer.from([chunkIndex])],
        program.programId
      );

      const chunkBefore = await program.account.chunk.fetch(chunkPda);
      const cellBefore = chunkBefore.grid[playerBefore.rowInChunk][playerBefore.col];

      // Try to eat pellet
      try {
        await program.methods
          .eatPellet()
          .accounts({
            world: worldPda,
            player: playerPda,
            chunk: chunkPda,
            authority: testPlayerKeypair.publicKey,
          })
          .signers([testPlayerKeypair])
          .rpc();

        const playerAfter = await program.account.player.fetch(playerPda);
        const chunkAfter = await program.account.chunk.fetch(chunkPda);

        // If there was a pellet (2) or power pellet (3)
        if (cellBefore === 2 || cellBefore === 3) {
          assert.ok(playerAfter.balanceLamports.gt(playerBefore.balanceLamports));
          assert.equal(chunkAfter.grid[playerBefore.rowInChunk][playerBefore.col], 0);
          console.log("Pellet eaten, balance increased by:", 
            playerAfter.balanceLamports.sub(playerBefore.balanceLamports).toString());
        }
      } catch (err) {
        console.log("No pellet at current position (expected if on empty/wall)");
      }
    });
  });

  describe("Ghost Eating", () => {
    let playerPda: PublicKey;
    let ghostPda: PublicKey;
    let testPlayerKeypair: Keypair;

    before(async () => {
      testPlayerKeypair = Keypair.generate();
      
      const airdropSig = await provider.connection.requestAirdrop(
        testPlayerKeypair.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(airdropSig);

      [playerPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("player"), worldPda.toBuffer(), testPlayerKeypair.publicKey.toBuffer()],
        program.programId
      );

      [ghostPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ghost"), worldPda.toBuffer(), Buffer.from([0])],
        program.programId
      );

      await program.methods
        .spawnPlayer()
        .accounts({
          world: worldPda,
          player: playerPda,
          authority: testPlayerKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([testPlayerKeypair])
        .rpc();
    });

    it("Cannot eat ghost without power pellet", async () => {
      try {
        await program.methods
          .eatGhost(0)
          .accounts({
            world: worldPda,
            player: playerPda,
            ghost: ghostPda,
            authority: testPlayerKeypair.publicKey,
          })
          .signers([testPlayerKeypair])
          .rpc();
        
        assert.fail("Should have failed without power pellet");
      } catch (err) {
        assert.ok(err.toString().includes("NotPowered") || err.toString().includes("NotSameCell"));
        console.log("Correctly prevented eating ghost without power");
      }
    });
  });

  describe("Player vs Player", () => {
    let eaterKeypair: Keypair;
    let victimKeypair: Keypair;
    let eaterPda: PublicKey;
    let victimPda: PublicKey;

    before(async () => {
      eaterKeypair = Keypair.generate();
      victimKeypair = Keypair.generate();

      // Airdrop to both
      for (const kp of [eaterKeypair, victimKeypair]) {
        const sig = await provider.connection.requestAirdrop(
          kp.publicKey,
          2 * anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction(sig);
      }

      [eaterPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("player"), worldPda.toBuffer(), eaterKeypair.publicKey.toBuffer()],
        program.programId
      );

      [victimPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("player"), worldPda.toBuffer(), victimKeypair.publicKey.toBuffer()],
        program.programId
      );

      // Spawn both players
      for (const [kp, pda] of [[eaterKeypair, eaterPda], [victimKeypair, victimPda]]) {
        await program.methods
          .spawnPlayer()
          .accounts({
            world: worldPda,
            player: pda,
            authority: kp.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([kp])
          .rpc();
      }
    });

    it("Cannot eat player without power pellet", async () => {
      try {
        await program.methods
          .eatPlayer()
          .accounts({
            eater: eaterPda,
            victim: victimPda,
            world: worldPda,
            authority: eaterKeypair.publicKey,
            victimAuthority: victimKeypair.publicKey,
          })
          .signers([eaterKeypair])
          .rpc();
        
        assert.fail("Should have failed - eater not powered");
      } catch (err) {
        assert.ok(err.toString().includes("NotPowered") || err.toString().includes("NotSameCell"));
        console.log("Correctly prevented eating player without power");
      }
    });
  });

  describe("Map Scrolling", () => {
    it("Scrolls map after sufficient slots", async () => {
      const worldBefore = await program.account.world.fetch(worldPda);
      const initialScrollOffset = worldBefore.scrollOffset;

      // Get the bottom chunk (physical index = scroll_offset % 32)
      const bottomPhysicalIndex = initialScrollOffset % 32;
      const [chunkPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("chunk"), worldPda.toBuffer(), Buffer.from([bottomPhysicalIndex])],
        program.programId
      );

      // Wait for next scroll slot (or try immediately if already past)
      try {
        const tx = await program.methods
          .scrollMap()
          .accounts({
            world: worldPda,
            chunk: chunkPda,
            authority: authority.publicKey,
          })
          .rpc();

        console.log("Scroll map transaction:", tx);

        const worldAfter = await program.account.world.fetch(worldPda);
        assert.equal(worldAfter.scrollOffset, initialScrollOffset + 1);

        const chunkAfter = await program.account.chunk.fetch(chunkPda);
        assert.equal(chunkAfter.logicalIndex, initialScrollOffset + 32);
        
        console.log("Map scrolled successfully");
      } catch (err) {
        if (err.toString().includes("ScrollNotDue")) {
          console.log("Scroll not due yet (expected if not enough slots passed)");
        } else {
          throw err;
        }
      }
    });
  });

  describe("Exit Player", () => {
    let exitPlayerKeypair: Keypair;
    let exitPlayerPda: PublicKey;

    before(async () => {
      exitPlayerKeypair = Keypair.generate();
      
      const sig = await provider.connection.requestAirdrop(
        exitPlayerKeypair.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);

      [exitPlayerPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("player"), worldPda.toBuffer(), exitPlayerKeypair.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .spawnPlayer()
        .accounts({
          world: worldPda,
          player: exitPlayerPda,
          authority: exitPlayerKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([exitPlayerKeypair])
        .rpc();
    });

    it("Exits player successfully", async () => {
      const worldBefore = await program.account.world.fetch(worldPda);
      const playerCountBefore = worldBefore.totalPlayers;

      const tx = await program.methods
        .exitPlayer()
        .accounts({
          world: worldPda,
          player: exitPlayerPda,
          authority: exitPlayerKeypair.publicKey,
        })
        .signers([exitPlayerKeypair])
        .rpc();

      console.log("Exit player transaction:", tx);

      const playerAfter = await program.account.player.fetch(exitPlayerPda);
      assert.equal(playerAfter.dead, true);
      assert.ok(playerAfter.authority === null);

      const worldAfter = await program.account.world.fetch(worldPda);
      assert.equal(worldAfter.totalPlayers, playerCountBefore - 1);
    });
  });
});
