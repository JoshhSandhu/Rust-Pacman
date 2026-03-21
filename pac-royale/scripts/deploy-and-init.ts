import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PacRoyale } from "../target/types/pac_royale";
import { createPacRoyaleClient } from "../sdk/client";
import * as fs from "fs";

/**
 * Deployment and initialization script for Pac-Royale
 * 
 * This script:
 * 1. Initializes the world
 * 2. Creates all 32 chunks
 * 3. Initializes all 4 ghosts
 * 4. Saves deployment info to a JSON file
 */

async function main() {
  console.log("🎮 Pac-Royale Deployment & Initialization Script");
  console.log("================================================\n");

  // Setup provider and program
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PacRoyale as Program<PacRoyale>;
  const authority = provider.wallet.publicKey;

  console.log("Program ID:", program.programId.toBase58());
  console.log("Authority:", authority.toBase58());
  console.log("Network:", provider.connection.rpcEndpoint);
  console.log();

  // Create client
  const client = createPacRoyaleClient(program, provider.connection);

  // Get PDAs
  const [worldPda] = client.getWorldPda();
  const [anteroomPda] = client.getAnteroomPda(worldPda);
  const [vaultPda] = client.getVaultPda(worldPda);

  console.log("World PDA:", worldPda.toBase58());
  console.log("Anteroom PDA:", anteroomPda.toBase58());
  console.log("Vault PDA:", vaultPda.toBase58());
  console.log();

  // Check if world already exists
  try {
    const existingWorld = await client.fetchWorld();
    console.log("⚠️  World already exists!");
    console.log("World name:", Buffer.from(existingWorld.name).toString().replace(/\0/g, ''));
    console.log("Total players:", existingWorld.totalPlayers);
    console.log("Scroll offset:", existingWorld.scrollOffset);
    console.log("\nSkipping world initialization...\n");
  } catch (err) {
    // World doesn't exist, initialize it
    console.log("📝 Step 1: Initializing World...");
    try {
      const worldName = "Pac-Royale Arena";
      const tx = await client.initWorld(authority, worldName);
      console.log("✅ World initialized!");
      console.log("Transaction:", tx);
      console.log();

      // Wait for confirmation
      await provider.connection.confirmTransaction(tx, "confirmed");
    } catch (error) {
      console.error("❌ Failed to initialize world:", error);
      process.exit(1);
    }
  }

  // Initialize chunks
  console.log("📦 Step 2: Initializing Chunks (0-31)...");
  let chunksInitialized = 0;
  
  for (let i = 0; i < 32; i++) {
    try {
      const chunk = await client.fetchChunk(i);
      chunksInitialized++;
    } catch (err) {
      // Chunk doesn't exist, initialize it
      try {
        const templateId = i % 10;
        const tx = await client.initChunk(authority, i, templateId);
        await provider.connection.confirmTransaction(tx, "confirmed");
        chunksInitialized++;
        
        if (i % 8 === 0 || i === 31) {
          console.log(`  ✅ Initialized chunks ${Math.max(0, i - 7)}-${i}`);
        }
      } catch (error) {
        console.error(`  ❌ Failed to initialize chunk ${i}:`, error);
      }
    }
  }
  
  console.log(`✅ ${chunksInitialized}/32 chunks initialized\n`);

  // Initialize ghosts
  console.log("👻 Step 3: Initializing Ghosts (0-3)...");
  let ghostsInitialized = 0;

  for (let i = 0; i < 4; i++) {
    try {
      const ghost = await client.fetchGhost(i);
      ghostsInitialized++;
    } catch (err) {
      // Ghost doesn't exist, initialize it
      try {
        const tx = await client.initGhost(authority, i);
        await provider.connection.confirmTransaction(tx, "confirmed");
        ghostsInitialized++;
        console.log(`  ✅ Ghost ${i} initialized`);
      } catch (error) {
        console.error(`  ❌ Failed to initialize ghost ${i}:`, error);
      }
    }
  }

  console.log(`✅ ${ghostsInitialized}/4 ghosts initialized\n`);

  // Fetch final world state
  const world = await client.fetchWorld();
  
  console.log("🎉 Deployment Complete!");
  console.log("=======================");
  console.log("World:", worldPda.toBase58());
  console.log("Anteroom:", anteroomPda.toBase58());
  console.log("Vault:", vaultPda.toBase58());
  console.log("Chunks initialized:", chunksInitialized);
  console.log("Ghosts initialized:", ghostsInitialized);
  console.log("Total players:", world.totalPlayers);
  console.log();

  // Save deployment info
  const deploymentInfo = {
    programId: program.programId.toBase58(),
    network: provider.connection.rpcEndpoint,
    world: worldPda.toBase58(),
    anteroom: anteroomPda.toBase58(),
    vault: vaultPda.toBase58(),
    authority: authority.toBase58(),
    chunksInitialized,
    ghostsInitialized,
    deployedAt: new Date().toISOString(),
  };

  const deploymentPath = "./deployment-info.json";
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`💾 Deployment info saved to ${deploymentPath}`);
  console.log();

  console.log("🚀 Ready to play!");
  console.log("Players can now call spawnPlayer() to join the game.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
