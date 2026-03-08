import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PacRoyale } from "../target/types/pac_royale";
import { createPacRoyaleClient, CONSTANTS } from "../sdk/client";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.PacRoyale as Program<PacRoyale>;
  const authority = provider.wallet.publicKey;
  const client = createPacRoyaleClient(program, provider.connection);

  const [worldPda] = client.getWorldPda();
  const [anteroomPda] = client.getAnteroomPda(worldPda);

  console.log("=== PAC-ROYALE DEMO HEALTH CHECK ===");
  console.log("Program:", program.programId.toBase58());
  console.log("Authority:", authority.toBase58());
  console.log("RPC:", provider.connection.rpcEndpoint);

  const report: Array<{ name: string; ok: boolean; detail?: string }> = [];

  try {
    const world = await client.fetchWorld();
    report.push({
      name: "world_account",
      ok: true,
      detail: `players=${world.totalPlayers} scroll=${world.scrollOffset}`,
    });
  } catch (err: any) {
    report.push({ name: "world_account", ok: false, detail: err?.message ?? String(err) });
  }

  try {
    const anteroom = await (program.account as any).anteroom.fetch(anteroomPda);
    report.push({
      name: "anteroom_account",
      ok: true,
      detail: `vault=${anteroom.vault.toBase58()}`,
    });
  } catch (err: any) {
    report.push({ name: "anteroom_account", ok: false, detail: err?.message ?? String(err) });
  }

  const chunks = await client.fetchAllChunks();
  report.push({
    name: "chunks_initialized",
    ok: chunks.length === CONSTANTS.MAX_CHUNKS,
    detail: `${chunks.length}/${CONSTANTS.MAX_CHUNKS}`,
  });

  const ghosts = await client.fetchAllGhosts();
  report.push({
    name: "ghosts_initialized",
    ok: ghosts.length === CONSTANTS.NUM_GHOSTS,
    detail: `${ghosts.length}/${CONSTANTS.NUM_GHOSTS}`,
  });

  let playerExists = false;
  try {
    await client.fetchPlayer(authority);
    playerExists = true;
  } catch {
    playerExists = false;
  }
  report.push({
    name: "authority_player_account",
    ok: true,
    detail: playerExists ? "exists" : "missing (spawn on demo start)",
  });

  const failed = report.filter((r) => !r.ok);
  console.log();
  for (const row of report) {
    console.log(`${row.ok ? "[OK]" : "[FAIL]"} ${row.name}${row.detail ? ` -> ${row.detail}` : ""}`);
  }

  if (failed.length > 0) {
    console.error(`\nHealth check failed: ${failed.length} issue(s)`);
    process.exit(1);
  }

  console.log("\nHealth check passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
