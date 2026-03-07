import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PacRoyale } from "../target/types/pac_royale";
import { createPacRoyaleClient, CONSTANTS } from "../sdk/client";
import * as readline from "readline";

/**
 * Interactive CLI game example
 * Demonstrates how to use the SDK to play Pac-Royale
 */

async function main() {
  console.log("🎮 Pac-Royale CLI Game");
  console.log("======================\n");

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PacRoyale as Program<PacRoyale>;
  const authority = provider.wallet.publicKey;
  const client = createPacRoyaleClient(program, provider.connection);

  console.log("Player:", authority.toBase58());
  console.log();

  // Check if player exists
  let player;
  try {
    player = await client.fetchPlayer(authority);
    console.log("✅ Player found!");
    console.log("Balance:", await client.getPlayerBalanceSOL(authority), "SOL");
    console.log("Position:", player.chunkIndex, player.rowInChunk, player.col);
    console.log();
  } catch (err) {
    console.log("❌ Player not found. Spawning...");
    const tx = await client.spawnPlayer(authority);
    console.log("✅ Player spawned:", tx);
    player = await client.fetchPlayer(authority);
    console.log();
  }

  // Display current state
  await displayGameState(client, authority);

  // Setup keyboard input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("\n🎮 Controls:");
  console.log("  w/↑ - Move Up");
  console.log("  s/↓ - Move Down");
  console.log("  a/← - Move Left");
  console.log("  d/→ - Move Right");
  console.log("  e   - Eat Pellet");
  console.log("  g   - Eat Ghost (if powered and same cell)");
  console.log("  c   - Cash Out");
  console.log("  x   - Exit Game");
  console.log("  q   - Quit CLI\n");

  // Game loop
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  process.stdin.on("keypress", async (str, key) => {
    if (key.ctrl && key.name === "c") {
      process.exit();
    }

    try {
      switch (key.name) {
        case "w":
        case "up":
          await handleMove(client, authority, CONSTANTS.DIR_UP);
          break;
        case "s":
        case "down":
          await handleMove(client, authority, CONSTANTS.DIR_DOWN);
          break;
        case "a":
        case "left":
          await handleMove(client, authority, CONSTANTS.DIR_LEFT);
          break;
        case "d":
        case "right":
          await handleMove(client, authority, CONSTANTS.DIR_RIGHT);
          break;
        case "e":
          await handleEatPellet(client, authority);
          break;
        case "g":
          await handleEatGhost(client, authority);
          break;
        case "c":
          await handleCashOut(client, authority);
          break;
        case "x":
          await handleExit(client, authority);
          process.exit(0);
          break;
        case "q":
          console.log("\n👋 Goodbye!");
          process.exit(0);
          break;
      }

      await displayGameState(client, authority);
    } catch (err) {
      console.error("Error:", err.message);
    }
  });

  console.log("Ready to play! Press keys to move...\n");
}

async function handleMove(client: any, authority: any, direction: number) {
  console.log(`\n🏃 Moving ${["UP", "DOWN", "LEFT", "RIGHT"][direction]}...`);
  const tx = await client.movement(authority, direction);
  console.log("✅ Moved");
}

async function handleEatPellet(client: any, authority: any) {
  console.log("\n🍬 Eating pellet...");
  const tx = await client.eatPellet(authority);
  console.log("✅ Pellet eaten!");
}

async function handleEatGhost(client: any, authority: any) {
  console.log("\n👻 Trying to eat ghost...");
  const isPowered = await client.isPlayerPowered(authority);
  if (!isPowered) {
    console.log("❌ Not powered! Eat a power pellet first.");
    return;
  }

  // Try each ghost
  for (let i = 0; i < 4; i++) {
    try {
      const tx = await client.eatGhost(authority, i);
      console.log(`✅ Ghost ${i} eaten! +0.01 SOL`);
      return;
    } catch (err) {
      // Ghost not at same position
    }
  }
  console.log("❌ No ghost at your position");
}

async function handleCashOut(client: any, authority: any) {
  console.log("\n💰 Cashing out...");
  const balance = await client.getPlayerBalanceSOL(authority);
  if (balance === 0) {
    console.log("❌ No balance to cash out");
    return;
  }

  const tx = await client.cashOut(authority, authority);
  console.log(`✅ Cashed out ${balance} SOL`);
}

async function handleExit(client: any, authority: any) {
  console.log("\n🚪 Exiting game...");
  const tx = await client.exitPlayer(authority);
  console.log("✅ Exited");
}

async function displayGameState(client: any, authority: any) {
  const player = await client.fetchPlayer(authority);
  const world = await client.fetchWorld();
  const isPowered = await client.isPlayerPowered(authority);
  const balance = await client.getPlayerBalanceSOL(authority);

  console.clear();
  console.log("╔════════════════════════════════════════╗");
  console.log("║         PAC-ROYALE GAME STATE          ║");
  console.log("╠════════════════════════════════════════╣");
  console.log(`║ Balance: ${balance.toFixed(4)} SOL`.padEnd(41) + "║");
  console.log(`║ Position: Chunk ${player.chunkIndex}, Row ${player.rowInChunk}, Col ${player.col}`.padEnd(41) + "║");
  console.log(`║ Powered: ${isPowered ? "YES ⚡" : "NO"}`.padEnd(41) + "║");
  console.log(`║ Total Players: ${world.totalPlayers}`.padEnd(41) + "║");
  console.log(`║ Scroll Offset: ${world.scrollOffset}`.padEnd(41) + "║");
  console.log("╚════════════════════════════════════════╝");

  // Display chunk grid
  const grid = await client.getPlayerChunkGrid(authority);
  console.log("\n📍 Current Chunk:");
  displayGrid(grid, player.rowInChunk, player.col);
}

function displayGrid(grid: number[][], playerRow: number, playerCol: number) {
  const symbols = {
    0: " ", // Empty
    1: "█", // Wall
    2: "·", // Pellet
    3: "●", // Power pellet
  };

  console.log("  ┌" + "─".repeat(grid[0].length * 2) + "┐");
  grid.forEach((row, r) => {
    let line = "  │";
    row.forEach((cell, c) => {
      if (r === playerRow && c === playerCol) {
        line += "😀";
      } else {
        line += symbols[cell] + " ";
      }
    });
    line += "│";
    console.log(line);
  });
  console.log("  └" + "─".repeat(grid[0].length * 2) + "┘");
}

main()
  .then(() => {})
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
