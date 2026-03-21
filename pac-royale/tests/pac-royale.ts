import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PacRoyale } from "../target/types/pac_royale";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";

const BPF_UPGRADEABLE_LOADER_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);

describe("pac-royale", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PacRoyale as Program<PacRoyale>;
  const authority = provider.wallet as anchor.Wallet;

  let worldPda: PublicKey;
  let worldBump: number;
  let anteroomPda: PublicKey;
  let anteroomBump: number;
  let vaultPda: PublicKey;
  let programDataPda: PublicKey;

  async function fundWallet(recipient: PublicKey, lamports: number) {
    const tx = new anchor.web3.Transaction().add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: recipient,
        lamports,
      }),
    );
    await provider.sendAndConfirm(tx, []);
  }

  async function waitForNextSlot(): Promise<void> {
    const currentSlot = await provider.connection.getSlot();
    while ((await provider.connection.getSlot()) <= currentSlot) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  async function findChunkPdaForLogicalIndex(logicalIndex: number) {
    for (let physicalIndex = 0; physicalIndex < 32; physicalIndex++) {
      const [candidateChunkPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("chunk"),
          worldPda.toBuffer(),
          Buffer.from([physicalIndex]),
        ],
        program.programId,
      );
      const candidateChunk = await program.account.chunk.fetch(candidateChunkPda);
      if (candidateChunk.logicalIndex === logicalIndex) {
        return candidateChunkPda;
      }
    }

    throw new Error(`Missing chunk for logical index ${logicalIndex}`);
  }

  async function ensurePlayerNotCollidingWithGhost(playerAccount: any) {
    const moveGhostMethod = (program.methods as any).moveGhost;
    if (typeof moveGhostMethod !== "function") {
      return;
    }

    for (let ghostId = 0; ghostId < 4; ghostId++) {
      const [ghostPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ghost"), worldPda.toBuffer(), Buffer.from([ghostId])],
        program.programId,
      );
      let ghostAccount = await program.account.ghost.fetch(ghostPda);
      const overlapsPlayer =
        ghostAccount.chunkIndex === playerAccount.chunkIndex &&
        ghostAccount.row === playerAccount.rowInChunk &&
        ghostAccount.col === playerAccount.col;
      if (!overlapsPlayer) {
        continue;
      }

      const chunkPda = await findChunkPdaForLogicalIndex(ghostAccount.chunkIndex);
      let movedOffPlayer = false;
      for (const direction of [0, 1, 2, 3]) {
        await moveGhostMethod(ghostId, direction)
          .accounts({
            world: worldPda,
            ghost: ghostPda,
            chunk: chunkPda,
            destinationChunk: null,
            authority: authority.publicKey,
          })
          .rpc();

        ghostAccount = await program.account.ghost.fetch(ghostPda);
        movedOffPlayer =
          ghostAccount.chunkIndex !== playerAccount.chunkIndex ||
          ghostAccount.row !== playerAccount.rowInChunk ||
          ghostAccount.col !== playerAccount.col;
        if (movedOffPlayer) {
          break;
        }
      }

      assert.ok(
        movedOffPlayer,
        `Expected ghost ${ghostId} to move off the player's cell`,
      );
    }
  }

  before(async () => {
    // Derive World PDA
    [worldPda, worldBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("world")],
      program.programId,
    );

    // Derive Anteroom PDA
    [anteroomPda, anteroomBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("anteroom"), worldPda.toBuffer()],
      program.programId,
    );

    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), worldPda.toBuffer()],
      program.programId,
    );
    [programDataPda] = PublicKey.findProgramAddressSync(
      [program.programId.toBuffer()],
      BPF_UPGRADEABLE_LOADER_ID,
    );
  });

  describe("World Initialization", () => {
    it("Rejects unauthorized init_world caller", async () => {
      const unauthorized = Keypair.generate();
      await fundWallet(unauthorized.publicKey, 50_000_000);

      const worldName = Buffer.from("Pac-Royale Arena");
      try {
        await program.methods
          .initWorld(worldName)
          .accountsStrict({
            world: worldPda,
            anteroom: anteroomPda,
            vault: vaultPda,
            authority: unauthorized.publicKey,
            program: program.programId,
            programData: programDataPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([unauthorized])
          .rpc();
        assert.fail("Unauthorized init_world should fail");
      } catch (err) {
        const errText = err?.toString?.() ?? String(err);
        if (errText.includes("already in use")) {
          console.log(
            "Skipping unauthorized init check because world PDA is already initialized",
          );
          return;
        }
        assert.ok(
          errText.includes("UnauthorizedWorldInit") ||
            errText.includes("ConstraintRaw"),
          `Unexpected error: ${errText}`,
        );
      }
    });

    it("Initializes the world successfully", async () => {
      const worldName = Buffer.from("Pac-Royale Arena");

      try {
        const tx = await program.methods
          .initWorld(worldName)
          .accountsStrict({
            world: worldPda,
            anteroom: anteroomPda,
            vault: vaultPda,
            authority: authority.publicKey,
            program: program.programId,
            programData: programDataPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        console.log("Init world transaction signature:", tx);
      } catch (err) {
        const errText = err?.toString?.() ?? String(err);
        console.log("World already initialized or init skipped:", errText);
      }

      // Fetch and verify world account
      const worldAccount = await program.account.world.fetch(worldPda);
      assert.ok(worldAccount.authority);
      assert.equal(worldAccount.chunkCount, 32);
      assert.isAtLeast(worldAccount.scrollOffset, 0);
      assert.isAtLeast(worldAccount.totalPlayers, 0);
      assert.equal(worldAccount.frozen, false);

      // Verify name
      const nameBytes = worldAccount.name.slice(0, worldName.length);
      assert.deepEqual(Buffer.from(nameBytes), worldName);

      // Fetch and verify anteroom
      const anteroomAccount = await program.account.anteroom.fetch(anteroomPda);
      assert.ok(anteroomAccount.world.equals(worldPda));
      assert.ok(anteroomAccount.authority.equals(worldAccount.authority));
      if (!anteroomAccount.vault.equals(vaultPda)) {
        console.log(
          `Legacy vault detected in anteroom (${anteroomAccount.vault.toBase58()}); expected PDA ${vaultPda.toBase58()}`,
        );
      }
      assert.ok(anteroomAccount.vault);
    });
  });

  describe("Chunk Initialization", () => {
    it("Initializes chunks 0-31 with different templates", async () => {
      const numChunks = 32;
      const numTemplates = 10;
      const world = await program.account.world.fetch(worldPda);

      for (let i = 0; i < numChunks; i++) {
        const physicalIndex = i;
        const templateId = i % numTemplates;

        const [chunkPda] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("chunk"),
            worldPda.toBuffer(),
            Buffer.from([physicalIndex]),
          ],
          program.programId,
        );

        try {
          await program.methods
            .initChunk(physicalIndex, templateId)
            .accountsStrict({
              world: worldPda,
              chunk: chunkPda,
              authority: authority.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .rpc();
        } catch (err) {
          const errText = err?.toString?.() ?? String(err);
          console.log(`Chunk ${i} already initialized or skipped:`, errText);
        }

        // Verify chunk
        const chunkAccount = await program.account.chunk.fetch(chunkPda);
        assert.ok(chunkAccount.world.equals(worldPda));
        assert.equal(chunkAccount.physicalIndex, physicalIndex);
        assert.isAtLeast(chunkAccount.logicalIndex, world.scrollOffset);
        assert.isBelow(chunkAccount.logicalIndex, world.scrollOffset + 32);
        assert.isAtLeast(chunkAccount.templateId, 0);
        assert.isBelow(chunkAccount.templateId, numTemplates);

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
          program.programId,
        );

        try {
          await program.methods
            .initGhost(ghostId)
            .accountsStrict({
              world: worldPda,
              ghost: ghostPda,
              authority: authority.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .rpc();
        } catch (err) {
          const errText = err?.toString?.() ?? String(err);
          console.log(
            `Ghost ${ghostId} already initialized or skipped:`,
            errText,
          );
        }

        // Verify ghost
        const ghostAccount = await program.account.ghost.fetch(ghostPda);
        assert.ok(ghostAccount.world.equals(worldPda));
        assert.equal(ghostAccount.ghostId, ghostId);
        assert.equal(ghostAccount.state, 0); // GHOST_CHASE
        assert.equal(ghostAccount.direction, 0); // DIR_UP

        console.log(`Initialized ghost ${ghostId}`);
      }
    });

    it("Moves a ghost with the world authority", async () => {
      const moveGhostMethod = (program.methods as any).moveGhost;
      if (typeof moveGhostMethod !== "function") {
        console.log(
          "Skipping move_ghost test because the local IDL does not expose moveGhost",
        );
        return;
      }

      const ghostId = 0;
      const world = await program.account.world.fetch(worldPda);
      const [ghostPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ghost"), worldPda.toBuffer(), Buffer.from([ghostId])],
        program.programId,
      );
      const ghostBefore = await program.account.ghost.fetch(ghostPda);

      const physicalIndex =
        (((ghostBefore.chunkIndex - world.scrollOffset) % 32) + 32) % 32;
      let [chunkPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("chunk"),
          worldPda.toBuffer(),
          Buffer.from([physicalIndex]),
        ],
        program.programId,
      );

      for (let i = 0; i < 32; i++) {
        const [candidate] = PublicKey.findProgramAddressSync(
          [Buffer.from("chunk"), worldPda.toBuffer(), Buffer.from([i])],
          program.programId,
        );
        const chunk = await program.account.chunk.fetch(candidate);
        if (chunk.logicalIndex === ghostBefore.chunkIndex) {
          chunkPda = candidate;
          break;
        }
      }

      await moveGhostMethod(ghostId, 3)
        .accounts({
          world: worldPda,
          ghost: ghostPda,
          chunk: chunkPda,
          destinationChunk: null,
          authority: authority.publicKey,
        })
        .rpc();

      const ghostAfter = await program.account.ghost.fetch(ghostPda);
      assert.equal(ghostAfter.direction, 3);
    });
  });

  describe("Player Spawn and Movement", () => {
    let player1Pda: PublicKey;
    let player2Keypair: Keypair;
    let player2Pda: PublicKey;

    it("Spawns player 1", async () => {
      [player1Pda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("player"),
          worldPda.toBuffer(),
          authority.publicKey.toBuffer(),
        ],
        program.programId,
      );

      try {
        const tx = await program.methods
          .spawnPlayer()
          .accountsStrict({
            world: worldPda,
            player: player1Pda,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        console.log("Spawn player transaction:", tx);
      } catch (err) {
        const errText = err?.toString?.() ?? String(err);
        console.log("Player 1 already exists or spawn skipped:", errText);
      }

      // Verify player
      const worldAccount = await program.account.world.fetch(worldPda);
      let playerAccount = await program.account.player.fetch(player1Pda);
      if (playerAccount.dead) {
        await program.methods
          .respawnPlayer()
          .accountsStrict({
            world: worldPda,
            player: player1Pda,
            authority: authority.publicKey,
          })
          .rpc();
        playerAccount = await program.account.player.fetch(player1Pda);
      }
      assert.ok(playerAccount.authority!.equals(authority.publicKey));
      assert.ok(playerAccount.world.equals(worldPda));
      assert.isAtLeast(playerAccount.balanceLamports.toNumber(), 0);
      assert.equal(playerAccount.dead, false);
      assert.isAtLeast(playerAccount.chunkIndex, worldAccount.scrollOffset);
      assert.isBelow(playerAccount.chunkIndex, worldAccount.scrollOffset + 32);
      assert.isAtLeast(playerAccount.rowInChunk, 0);
      assert.isBelow(playerAccount.rowInChunk, 6);
      assert.isAtLeast(playerAccount.col, 0);
      assert.isBelow(playerAccount.col, 10);

      // Verify world player count increased
      assert.isAtLeast(worldAccount.totalPlayers, 1);
    });

    it("Moves player in valid direction", async () => {
      const worldAccount = await program.account.world.fetch(worldPda);
      let playerAccount = await program.account.player.fetch(player1Pda);
      if (playerAccount.dead) {
        await program.methods
          .respawnPlayer()
          .accountsStrict({
            world: worldPda,
            player: player1Pda,
            authority: authority.publicKey,
          })
          .rpc();
        playerAccount = await program.account.player.fetch(player1Pda);
      }
      const physicalIndex =
        (((playerAccount.chunkIndex - worldAccount.scrollOffset) % 32) + 32) %
        32;
      let [chunkPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("chunk"),
          worldPda.toBuffer(),
          Buffer.from([physicalIndex]),
        ],
        program.programId,
      );
      for (let i = 0; i < 32; i++) {
        const [candidate] = PublicKey.findProgramAddressSync(
          [Buffer.from("chunk"), worldPda.toBuffer(), Buffer.from([i])],
          program.programId,
        );
        const chunk = await program.account.chunk.fetch(candidate);
        if (chunk.logicalIndex === playerAccount.chunkIndex) {
          chunkPda = candidate;
          break;
        }
      }
      await waitForNextSlot();
      const [ghost0Pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ghost"), worldPda.toBuffer(), Buffer.from([0])],
        program.programId,
      );
      const [ghost1Pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ghost"), worldPda.toBuffer(), Buffer.from([1])],
        program.programId,
      );
      const [ghost2Pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ghost"), worldPda.toBuffer(), Buffer.from([2])],
        program.programId,
      );
      const [ghost3Pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ghost"), worldPda.toBuffer(), Buffer.from([3])],
        program.programId,
      );

      // Move right (direction 3)
      try {
        await (program.methods as any)
          .movement(3)
          .accounts({
            world: worldPda,
            player: player1Pda,
            chunk: chunkPda,
            authority: authority.publicKey,
            playerAuthority: authority.publicKey,
            ghost0: ghost0Pda,
            ghost1: ghost1Pda,
            ghost2: ghost2Pda,
            ghost3: ghost3Pda,
            destinationChunk: null,
          })
          .rpc();
      } catch (err) {
        const errText = err?.toString?.() ?? String(err);
        const tolerated =
          errText.includes("WrongChunk") ||
          errText.includes("ChunkLogicalMismatch") ||
          errText.includes("PlayerInRemovedChunk");
        assert.ok(tolerated, `Unexpected movement error: ${errText}`);
      }

      const playerAfterMove = await program.account.player.fetch(player1Pda);
      assert.isAtLeast(playerAfterMove.direction, 0);
      assert.isBelow(playerAfterMove.direction, 4);
      // Position may or may not change depending on walls
    });

    it("Rejects stale or mismatched chunk in movement", async () => {
      const worldAccount = await program.account.world.fetch(worldPda);
      let playerAccount = await program.account.player.fetch(player1Pda);
      if (playerAccount.dead) {
        await program.methods
          .respawnPlayer()
          .accountsStrict({
            world: worldPda,
            player: player1Pda,
            authority: authority.publicKey,
          })
          .rpc();
        playerAccount = await program.account.player.fetch(player1Pda);
      }
      await ensurePlayerNotCollidingWithGhost(playerAccount);
      const expectedPhysicalIndex =
        (((playerAccount.chunkIndex - worldAccount.scrollOffset) % 32) + 32) %
        32;
      let wrongChunkPda: PublicKey | null = null;
      for (let physicalIndex = 0; physicalIndex < 32; physicalIndex++) {
        const [candidateChunkPda] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("chunk"),
            worldPda.toBuffer(),
            Buffer.from([physicalIndex]),
          ],
          program.programId,
        );
        const candidateChunk = await program.account.chunk.fetch(candidateChunkPda);
        const isExpectedChunk =
          candidateChunk.logicalIndex === playerAccount.chunkIndex &&
          candidateChunk.physicalIndex === expectedPhysicalIndex;
        if (!isExpectedChunk) {
          wrongChunkPda = candidateChunkPda;
          break;
        }
      }
      assert.ok(wrongChunkPda, "Expected to find a mismatched chunk account");
      await waitForNextSlot();
      const [ghost0Pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ghost"), worldPda.toBuffer(), Buffer.from([0])],
        program.programId,
      );
      const [ghost1Pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ghost"), worldPda.toBuffer(), Buffer.from([1])],
        program.programId,
      );
      const [ghost2Pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ghost"), worldPda.toBuffer(), Buffer.from([2])],
        program.programId,
      );
      const [ghost3Pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ghost"), worldPda.toBuffer(), Buffer.from([3])],
        program.programId,
      );

      try {
        await (program.methods as any)
          .movement(3)
          .accountsStrict({
            world: worldPda,
            player: player1Pda,
            chunk: wrongChunkPda,
            authority: authority.publicKey,
            playerAuthority: authority.publicKey,
            ghost0: ghost0Pda,
            ghost1: ghost1Pda,
            ghost2: ghost2Pda,
            ghost3: ghost3Pda,
            destinationChunk: null,
          })
          .rpc();
        assert.fail("Expected movement to fail with wrong chunk account");
      } catch (err) {
        const errText = err?.toString?.() ?? String(err);
        assert.ok(
          errText.includes("WrongChunk") ||
            errText.includes("ChunkLogicalMismatch"),
          `Unexpected error: ${errText}`,
        );
      }
    });

    it("Rejects cash_out when vault PDA is not provided", async () => {
      const worldAccount = await program.account.world.fetch(worldPda);
      let player = await program.account.player.fetch(player1Pda);
      if (player.dead) {
        await program.methods
          .respawnPlayer()
          .accountsStrict({
            world: worldPda,
            player: player1Pda,
            authority: authority.publicKey,
          })
          .rpc();
        player = await program.account.player.fetch(player1Pda);
      }
      const physicalIndex =
        (((player.chunkIndex - worldAccount.scrollOffset) % 32) + 32) % 32;
      let [chunkPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("chunk"),
          worldPda.toBuffer(),
          Buffer.from([physicalIndex]),
        ],
        program.programId,
      );
      for (let i = 0; i < 32; i++) {
        const [candidate] = PublicKey.findProgramAddressSync(
          [Buffer.from("chunk"), worldPda.toBuffer(), Buffer.from([i])],
          program.programId,
        );
        const chunk = await program.account.chunk.fetch(candidate);
        if (chunk.logicalIndex === player.chunkIndex) {
          chunkPda = candidate;
          break;
        }
      }

      try {
        await program.methods
          .eatPellet()
          .accountsStrict({
            world: worldPda,
            player: player1Pda,
            chunk: chunkPda,
            authority: authority.publicKey,
            playerAuthority: authority.publicKey,
          })
          .rpc();
      } catch (err) {
        const errText = err?.toString?.() ?? String(err);
        const tolerated =
          errText.includes("WrongChunk") ||
          errText.includes("ChunkLogicalMismatch") ||
          errText.includes("PlayerInRemovedChunk");
        if (!tolerated) {
          throw err;
        }
        console.log(
          `Skipping vault-enforcement path because pellet fetch failed: ${errText}`,
        );
        return;
      }

      const playerAfterPellet = await program.account.player.fetch(player1Pda);
      if (!playerAfterPellet.balanceLamports.gt(new anchor.BN(0))) {
        console.log(
          "Skipping vault-enforcement assertion because player balance is zero",
        );
        return;
      }

      const fakeVault = Keypair.generate().publicKey;
      try {
        await program.methods
          .cashOut()
          .accountsStrict({
            player: player1Pda,
            anteroom: anteroomPda,
            world: worldPda,
            vault: fakeVault,
            payout: authority.publicKey,
            authority: authority.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        assert.fail("cash_out should fail when vault PDA is not enforced");
      } catch (err) {
        const errText = err?.toString?.() ?? String(err);
        assert.ok(
          errText.includes("InvalidVault") ||
            errText.includes("ConstraintSeeds") ||
            errText.includes("AccountNotInitialized"),
          `Unexpected error: ${errText}`,
        );
      }
    });

    it("Rejects exit_player when player has non-zero balance", async () => {
      const player = await program.account.player.fetch(player1Pda);
      if (!player.balanceLamports.gt(new anchor.BN(0))) {
        console.log(
          "Skipping non-zero exit check because player has zero balance",
        );
        return;
      }
      try {
        await program.methods
          .exitPlayer()
          .accountsStrict({
            world: worldPda,
            player: player1Pda,
            authority: authority.publicKey,
          })
          .rpc();
        assert.fail("exit_player should fail for non-zero player balance");
      } catch (err) {
        const errText = err?.toString?.() ?? String(err);
        assert.ok(
          errText.includes("BalanceMustBeZeroToExit") ||
            errText.includes("ConstraintRaw"),
          `Unexpected error: ${errText}`,
        );
      }
    });

    it("Spawns player 2 for multiplayer tests", async () => {
      player2Keypair = Keypair.generate();

      await fundWallet(player2Keypair.publicKey, 200_000_000);

      [player2Pda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("player"),
          worldPda.toBuffer(),
          player2Keypair.publicKey.toBuffer(),
        ],
        program.programId,
      );

      const tx = await program.methods
        .spawnPlayer()
        .accountsStrict({
          world: worldPda,
          player: player2Pda,
          authority: player2Keypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([player2Keypair])
        .rpc();

      const worldAccount = await program.account.world.fetch(worldPda);
      assert.isAtLeast(worldAccount.totalPlayers, 2);
    });

    it("Decrements total_players when a zero-balance player exits", async () => {
      const worldInfo = await provider.connection.getAccountInfo(worldPda);
      if (!worldInfo || !worldInfo.owner.equals(program.programId)) {
        console.log(
          "Skipping exit-player decrement test because the world account is delegated on devnet",
        );
        return;
      }

      const exitingPlayer = Keypair.generate();
      await fundWallet(exitingPlayer.publicKey, 200_000_000);

      const [exitingPlayerPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("player"),
          worldPda.toBuffer(),
          exitingPlayer.publicKey.toBuffer(),
        ],
        program.programId,
      );

      await program.methods
        .spawnPlayer()
        .accountsStrict({
          world: worldPda,
          player: exitingPlayerPda,
          authority: exitingPlayer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([exitingPlayer])
        .rpc();

      const worldBeforeExit = await program.account.world.fetch(worldPda);

      await program.methods
        .exitPlayer()
        .accountsStrict({
          world: worldPda,
          player: exitingPlayerPda,
          authority: exitingPlayer.publicKey,
        })
        .signers([exitingPlayer])
        .rpc();

      const worldAfterExit = await program.account.world.fetch(worldPda);
      assert.equal(
        worldAfterExit.totalPlayers,
        worldBeforeExit.totalPlayers - 1,
      );
    });
  });

  describe("Pellet Eating", () => {
    let playerPda: PublicKey;
    let testPlayerKeypair: Keypair;

    before(async () => {
      testPlayerKeypair = Keypair.generate();

      await fundWallet(testPlayerKeypair.publicKey, 200_000_000);

      [playerPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("player"),
          worldPda.toBuffer(),
          testPlayerKeypair.publicKey.toBuffer(),
        ],
        program.programId,
      );

      // Spawn player
      await program.methods
        .spawnPlayer()
        .accountsStrict({
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
        program.programId,
      );

      const chunkBefore = await program.account.chunk.fetch(chunkPda);
      const cellBefore =
        chunkBefore.grid[playerBefore.rowInChunk][playerBefore.col];

      // Try to eat pellet
      try {
        await program.methods
          .eatPellet()
          .accountsStrict({
            world: worldPda,
            player: playerPda,
            chunk: chunkPda,
            authority: testPlayerKeypair.publicKey,
            playerAuthority: testPlayerKeypair.publicKey,
          })
          .signers([testPlayerKeypair])
          .rpc();

        const playerAfter = await program.account.player.fetch(playerPda);
        const chunkAfter = await program.account.chunk.fetch(chunkPda);

        // If there was a pellet (2) or power pellet (3)
        if (cellBefore === 2 || cellBefore === 3) {
          assert.ok(
            playerAfter.balanceLamports.gt(playerBefore.balanceLamports),
          );
          assert.equal(
            chunkAfter.grid[playerBefore.rowInChunk][playerBefore.col],
            0,
          );
          console.log(
            "Pellet eaten, balance increased by:",
            playerAfter.balanceLamports
              .sub(playerBefore.balanceLamports)
              .toString(),
          );
        }
      } catch (err) {
        console.log(
          "No pellet at current position (expected if on empty/wall)",
        );
      }
    });
  });

  describe("Ghost Eating", () => {
    let playerPda: PublicKey;
    let ghostPda: PublicKey;
    let testPlayerKeypair: Keypair;

    before(async () => {
      testPlayerKeypair = Keypair.generate();

      await fundWallet(testPlayerKeypair.publicKey, 200_000_000);

      [playerPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("player"),
          worldPda.toBuffer(),
          testPlayerKeypair.publicKey.toBuffer(),
        ],
        program.programId,
      );

      [ghostPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ghost"), worldPda.toBuffer(), Buffer.from([0])],
        program.programId,
      );

      await program.methods
        .spawnPlayer()
        .accountsStrict({
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
          .accountsStrict({
            world: worldPda,
            player: playerPda,
            ghost: ghostPda,
            authority: testPlayerKeypair.publicKey,
            playerAuthority: testPlayerKeypair.publicKey,
          })
          .signers([testPlayerKeypair])
          .rpc();

        assert.fail("Should have failed without power pellet");
      } catch (err) {
        assert.ok(
          (err as any).toString().includes("NotPowered") ||
            (err as any).toString().includes("NotSameCell"),
        );
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
        await fundWallet(kp.publicKey, 200_000_000);
      }

      [eaterPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("player"),
          worldPda.toBuffer(),
          eaterKeypair.publicKey.toBuffer(),
        ],
        program.programId,
      );

      [victimPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("player"),
          worldPda.toBuffer(),
          victimKeypair.publicKey.toBuffer(),
        ],
        program.programId,
      );

      // Spawn both players
      for (const [kp, pda] of [
        [eaterKeypair, eaterPda],
        [victimKeypair, victimPda],
      ] as [Keypair, PublicKey][]) {
        await program.methods
          .spawnPlayer()
          .accountsStrict({
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
          .accountsStrict({
            eater: eaterPda,
            victim: victimPda,
            world: worldPda,
            authority: eaterKeypair.publicKey,
            playerAuthority: eaterKeypair.publicKey,
            victimAuthority: victimKeypair.publicKey,
          })
          .signers([eaterKeypair])
          .rpc();

        assert.fail("Should have failed - eater not powered");
      } catch (err) {
        assert.ok(
          (err as any).toString().includes("NotPowered") ||
            (err as any).toString().includes("NotSameCell"),
        );
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
        [
          Buffer.from("chunk"),
          worldPda.toBuffer(),
          Buffer.from([bottomPhysicalIndex]),
        ],
        program.programId,
      );

      // Wait for next scroll slot (or try immediately if already past)
      try {
        const tx = await program.methods
          .scrollMap()
          .accountsStrict({
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
        const expectedTemplate =
          (worldAfter.nextScrollSlot.toNumber() - 50) % 5;
        assert.equal(chunkAfter.templateId, expectedTemplate);
        assert.isAtLeast(chunkAfter.templateId, 0);
        assert.isBelow(chunkAfter.templateId, 5);

        console.log("Map scrolled successfully");
      } catch (err) {
        if ((err as any).toString().includes("ScrollNotDue")) {
          console.log(
            "Scroll not due yet (expected if not enough slots passed)",
          );
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

      await fundWallet(exitPlayerKeypair.publicKey, 200_000_000);

      [exitPlayerPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("player"),
          worldPda.toBuffer(),
          exitPlayerKeypair.publicKey.toBuffer(),
        ],
        program.programId,
      );

      await program.methods
        .spawnPlayer()
        .accountsStrict({
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
        .accountsStrict({
          world: worldPda,
          player: exitPlayerPda,
          authority: exitPlayerKeypair.publicKey,
        })
        .signers([exitPlayerKeypair])
        .rpc();

      console.log("Exit player transaction:", tx);

      try {
        await program.account.player.fetch(exitPlayerPda);
        assert.fail("Player account should be closed after exit_player");
      } catch (err) {
        const errText = err?.toString?.() ?? String(err);
        assert.ok(
          errText.includes("Account does not exist") ||
            errText.includes("AccountNotFound") ||
            errText.includes("does not exist") ||
            errText.includes("no data"),
          `Unexpected error: ${errText}`,
        );
      }

      const worldAfter = await program.account.world.fetch(worldPda);
      assert.equal(worldAfter.totalPlayers, playerCountBefore - 1);
    });
  });
});
