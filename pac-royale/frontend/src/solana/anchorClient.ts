import { AnchorProvider, Program, Idl } from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';
import { AnchorWallet } from '@solana/wallet-adapter-react';
import { PROGRAM_ID } from './pda';

// Minimal IDL for the instructions we need — generated IDL should replace this after `anchor build`
const PAC_ROYALE_IDL: Idl = {
  version: '0.1.0',
  name: 'pac_royale',
  instructions: [
    {
      name: 'spawnPlayer',
      accounts: [
        { name: 'world', isMut: true, isSigner: false },
        { name: 'player', isMut: true, isSigner: false },
        { name: 'authority', isMut: true, isSigner: true },
        { name: 'systemProgram', isMut: false, isSigner: false },
      ],
      args: [],
    },
    {
      name: 'respawnPlayer',
      accounts: [
        { name: 'world', isMut: false, isSigner: false },
        { name: 'player', isMut: true, isSigner: false },
        { name: 'authority', isMut: false, isSigner: true },
      ],
      args: [],
    },
    {
      name: 'movement',
      accounts: [
        { name: 'world', isMut: false, isSigner: false },
        { name: 'player', isMut: true, isSigner: false },
        { name: 'chunk', isMut: true, isSigner: false },
        { name: 'authority', isMut: false, isSigner: true },
        { name: 'ghost0', isMut: false, isSigner: false },
        { name: 'ghost1', isMut: false, isSigner: false },
        { name: 'ghost2', isMut: false, isSigner: false },
        { name: 'ghost3', isMut: false, isSigner: false },
      ],
      args: [{ name: 'direction', type: 'u8' }],
    },
    {
      name: 'eatPellet',
      accounts: [
        { name: 'world', isMut: true, isSigner: false },
        { name: 'player', isMut: true, isSigner: false },
        { name: 'chunk', isMut: true, isSigner: false },
        { name: 'authority', isMut: false, isSigner: true },
      ],
      args: [],
    },
    {
      name: 'eatGhost',
      accounts: [
        { name: 'world', isMut: true, isSigner: false },
        { name: 'player', isMut: true, isSigner: false },
        { name: 'ghost', isMut: true, isSigner: false },
        { name: 'authority', isMut: false, isSigner: true },
      ],
      args: [{ name: 'ghostId', type: 'u8' }],
    },
    {
      name: 'eatPlayer',
      accounts: [
        { name: 'eater', isMut: true, isSigner: false },
        { name: 'victim', isMut: true, isSigner: false },
        { name: 'world', isMut: true, isSigner: false },
        { name: 'authority', isMut: false, isSigner: true },
        { name: 'victimAuthority', isMut: false, isSigner: false },
      ],
      args: [],
    },
    {
      name: 'cashOut',
      accounts: [
        { name: 'player', isMut: true, isSigner: false },
        { name: 'anteroom', isMut: false, isSigner: false },
        { name: 'world', isMut: false, isSigner: false },
        { name: 'vault', isMut: true, isSigner: false },
        { name: 'payout', isMut: true, isSigner: false },
        { name: 'authority', isMut: false, isSigner: true },
        { name: 'systemProgram', isMut: false, isSigner: false },
      ],
      args: [],
    },
  ],
  accounts: [
    {
      name: 'World',
      type: {
        kind: 'struct',
        fields: [
          { name: 'authority', type: 'publicKey' },
          { name: 'name', type: { array: ['u8', 64] } },
          { name: 'chunkCount', type: 'u8' },
          { name: 'scrollOffset', type: 'u32' },
          { name: 'nextScrollSlot', type: 'u64' },
          { name: 'totalPlayers', type: 'u32' },
          { name: 'frozen', type: 'bool' },
          { name: 'chaseTarget', type: { option: 'publicKey' } },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
    {
      name: 'Player',
      type: {
        kind: 'struct',
        fields: [
          { name: 'authority', type: { option: 'publicKey' } },
          { name: 'world', type: 'publicKey' },
          { name: 'payoutWallet', type: 'publicKey' },
          { name: 'chunkIndex', type: 'u32' },
          { name: 'rowInChunk', type: 'u8' },
          { name: 'col', type: 'u8' },
          { name: 'direction', type: 'u8' },
          { name: 'balanceLamports', type: 'u64' },
          { name: 'powerPelletUntilSlot', type: 'u64' },
          { name: 'lastMoveSlot', type: 'u64' },
          { name: 'bump', type: 'u8' },
          { name: 'dead', type: 'bool' },
        ],
      },
    },
    {
      name: 'Chunk',
      type: {
        kind: 'struct',
        fields: [
          { name: 'world', type: 'publicKey' },
          { name: 'physicalIndex', type: 'u8' },
          { name: 'logicalIndex', type: 'u32' },
          { name: 'templateId', type: 'u8' },
          { name: 'grid', type: { array: [{ array: ['u8', 10] }, 6] } },
        ],
      },
    },
    {
      name: 'Ghost',
      type: {
        kind: 'struct',
        fields: [
          { name: 'world', type: 'publicKey' },
          { name: 'ghostId', type: 'u8' },
          { name: 'chunkIndex', type: 'u32' },
          { name: 'row', type: 'u8' },
          { name: 'col', type: 'u8' },
          { name: 'state', type: 'u8' },
          { name: 'direction', type: 'u8' },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
    {
      name: 'Anteroom',
      type: {
        kind: 'struct',
        fields: [
          { name: 'world', type: 'publicKey' },
          { name: 'authority', type: 'publicKey' },
          { name: 'vault', type: 'publicKey' },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
  ],
  errors: [],
};

let programInstance: Program | null = null;

export function getProgram(wallet: AnchorWallet, connection: Connection): Program {
  if (programInstance) return programInstance;
  const provider = new AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });
  programInstance = new Program(PAC_ROYALE_IDL, PROGRAM_ID, provider);
  return programInstance;
}

export function resetProgram() {
  programInstance = null;
}

export const DEVNET_RPC = 'https://api.devnet.solana.com';
