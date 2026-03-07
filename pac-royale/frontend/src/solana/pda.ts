import { PublicKey } from '@solana/web3.js';

export const PROGRAM_ID = new PublicKey('C5JxJHfHuWuCkyRJwen2gMcJ9XzEN8iBhjpZSdoMb57k');

export function getWorldPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('world')], PROGRAM_ID);
}

export function getAnteroomPda(worldPda: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('anteroom'), worldPda.toBuffer()],
    PROGRAM_ID,
  );
}

export function getPlayerPda(worldPda: PublicKey, authority: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('player'), worldPda.toBuffer(), authority.toBuffer()],
    PROGRAM_ID,
  );
}

export function getChunkPda(worldPda: PublicKey, physicalIndex: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('chunk'), worldPda.toBuffer(), Buffer.from([physicalIndex])],
    PROGRAM_ID,
  );
}

export function getGhostPda(worldPda: PublicKey, ghostId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('ghost'), worldPda.toBuffer(), Buffer.from([ghostId])],
    PROGRAM_ID,
  );
}
