import { Program } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { getWorldPda, getPlayerPda, getChunkPda, getGhostPda, getAnteroomPda } from './pda';
import { useGameStore, MAX_CHUNKS } from '../state/gameStore';

export async function sendSpawnPlayer(program: Program): Promise<string> {
  const authority = (program.provider as any).wallet.publicKey as PublicKey;
  const [worldPda] = getWorldPda();
  const [playerPda] = getPlayerPda(worldPda, authority);

  const tx = await (program.methods as any)
    .spawnPlayer()
    .accounts({
      world: worldPda,
      player: playerPda,
      authority,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  return tx;
}

export async function sendRespawnPlayer(program: Program): Promise<string> {
  const authority = (program.provider as any).wallet.publicKey as PublicKey;
  const [worldPda] = getWorldPda();
  const [playerPda] = getPlayerPda(worldPda, authority);

  const tx = await (program.methods as any)
    .respawnPlayer()
    .accounts({
      world: worldPda,
      player: playerPda,
      authority,
    })
    .rpc();

  return tx;
}

export async function sendMovement(program: Program, direction: number): Promise<string> {
  const authority = (program.provider as any).wallet.publicKey as PublicKey;
  const store = useGameStore.getState();
  const player = store.player;
  const world = store.world;
  if (!player || !world) throw new Error('Player or world not loaded');

  const [worldPda] = getWorldPda();
  const [playerPda] = getPlayerPda(worldPda, authority);

  // Calculate physical chunk index for current player position
  const physicalIndex = ((player.chunkIndex - world.scrollOffset) % MAX_CHUNKS + MAX_CHUNKS) % MAX_CHUNKS;
  const [chunkPda] = getChunkPda(worldPda, physicalIndex);

  // All 4 ghost PDAs
  const [ghost0] = getGhostPda(worldPda, 0);
  const [ghost1] = getGhostPda(worldPda, 1);
  const [ghost2] = getGhostPda(worldPda, 2);
  const [ghost3] = getGhostPda(worldPda, 3);

  const tx = await (program.methods as any)
    .movement(direction)
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

  return tx;
}

export async function sendEatPellet(program: Program): Promise<string> {
  const authority = (program.provider as any).wallet.publicKey as PublicKey;
  const store = useGameStore.getState();
  const player = store.player;
  const world = store.world;
  if (!player || !world) throw new Error('Player or world not loaded');

  const [worldPda] = getWorldPda();
  const [playerPda] = getPlayerPda(worldPda, authority);
  const physicalIndex = ((player.chunkIndex - world.scrollOffset) % MAX_CHUNKS + MAX_CHUNKS) % MAX_CHUNKS;
  const [chunkPda] = getChunkPda(worldPda, physicalIndex);

  const tx = await (program.methods as any)
    .eatPellet()
    .accounts({
      world: worldPda,
      player: playerPda,
      chunk: chunkPda,
      authority,
    })
    .rpc();

  return tx;
}

export async function sendEatGhost(program: Program, ghostId: number): Promise<string> {
  const authority = (program.provider as any).wallet.publicKey as PublicKey;
  const [worldPda] = getWorldPda();
  const [playerPda] = getPlayerPda(worldPda, authority);
  const [ghostPda] = getGhostPda(worldPda, ghostId);

  const tx = await (program.methods as any)
    .eatGhost(ghostId)
    .accounts({
      world: worldPda,
      player: playerPda,
      ghost: ghostPda,
      authority,
    })
    .rpc();

  return tx;
}

export async function sendCashOut(program: Program): Promise<string> {
  const authority = (program.provider as any).wallet.publicKey as PublicKey;
  const [worldPda] = getWorldPda();
  const [playerPda] = getPlayerPda(worldPda, authority);
  const [anteroomPda] = getAnteroomPda(worldPda);

  // Need to fetch anteroom to get vault address
  const anteroom = await (program.account as any).anteroom.fetch(anteroomPda);

  const tx = await (program.methods as any)
    .cashOut()
    .accounts({
      player: playerPda,
      anteroom: anteroomPda,
      world: worldPda,
      vault: anteroom.vault,
      payout: authority,
      authority,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  return tx;
}
