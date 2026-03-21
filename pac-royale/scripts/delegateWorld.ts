import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import * as fs from 'fs';
import {
    delegationRecordPdaFromDelegatedAccount,
    delegationMetadataPdaFromDelegatedAccount,
    delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
} from '@magicblock-labs/ephemeral-rollups-sdk';

const idl = require('../target/idl/pac_royale.json');
const PROGRAM_ID = new PublicKey('46gDjnJLeuMqKLJjHow4B4xt6BLspzf7owBydzSvSByH');
const DELEGATION_PROGRAM_ID = new PublicKey('DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh');

// Use public RPC (powers through 429 rate limit)
const DEVNET_RPC = 'https://api.devnet.solana.com';

const MAX_CHUNKS = 32;
const NUM_GHOSTS = 4;
const SHOULD_DELEGATE_WORLD = process.env.DELEGATE_WORLD === 'true';

const KEYPAIR_PATH = process.env.HOME + '/.config/solana/id.json';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function getWorldPda(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from('world')], PROGRAM_ID);
}

function getChunkPda(worldPda: PublicKey, physicalIndex: number): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from('chunk'), worldPda.toBuffer(), Buffer.from([physicalIndex])], PROGRAM_ID);
}

function getGhostPda(worldPda: PublicKey, ghostId: number): [PublicKey, number] {
    const idBuf = Buffer.alloc(1);
    idBuf.writeUInt8(ghostId, 0);
    return PublicKey.findProgramAddressSync([Buffer.from('ghost'), worldPda.toBuffer(), idBuf], PROGRAM_ID);
}

async function main() {
    console.log('Loading operator wallet from', KEYPAIR_PATH);
    const keypairFile = fs.readFileSync(KEYPAIR_PATH, 'utf-8');
    const operator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(keypairFile)));
    console.log('Operator Pubkey:', operator.publicKey.toBase58());

    const connection = new Connection(DEVNET_RPC, 'confirmed');
    const wallet = new anchor.Wallet(operator);
    const provider = new anchor.AnchorProvider(connection, wallet, {
        commitment: 'confirmed',
        preflightCommitment: 'confirmed',
    });

    const program = new Program(idl, provider);

    const [worldPda] = getWorldPda();

    if (SHOULD_DELEGATE_WORLD) {
        console.log("1. Delegating World via CPI...");
        while (true) {
            try {
                const tx = await program.methods
                    .delegateWorld()
                    .accountsStrict({
                        payer: operator.publicKey,
                        world: worldPda,
                        buffer: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(worldPda, PROGRAM_ID),
                        delegationRecord: delegationRecordPdaFromDelegatedAccount(worldPda),
                        delegationMetadata: delegationMetadataPdaFromDelegatedAccount(worldPda),
                        delegationProgram: DELEGATION_PROGRAM_ID,
                        program: PROGRAM_ID,
                        systemProgram: SystemProgram.programId,
                    })
                    .rpc();
                console.log("  ✓ World delegated:", tx);
                break;
            } catch (e: any) {
                const errStr = e.toString();
                if (errStr.includes("already been delegated") || errStr.includes("0x0") || errStr.includes("AccountOwnedByWrongProgram") || errStr.includes("3007")) {
                    console.log("  - World already delegated.");
                    break;
                } else {
                    console.error("  ! Retrying world delegation after 2s...", e.message);
                    await sleep(2000);
                }
            }
        }
    } else {
        console.log("1. Skipping world delegation (recommended for spawn/session flows). Set DELEGATE_WORLD=true to override.");
    }

    // 2. Delegate Chunks
    console.log("2. Delegating 32 Chunks via CPI...");
    for (let i = 0; i < MAX_CHUNKS; i++) {
        const [chunkPda] = getChunkPda(worldPda, i);
        while (true) {
            try {
                const tx = await program.methods
                    .delegateChunk(i)
                    .accountsStrict({
                        payer: operator.publicKey,
                        worldInfo: worldPda,
                        chunk: chunkPda,
                        buffer: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(chunkPda, PROGRAM_ID),
                        delegationRecord: delegationRecordPdaFromDelegatedAccount(chunkPda),
                        delegationMetadata: delegationMetadataPdaFromDelegatedAccount(chunkPda),
                        delegationProgram: DELEGATION_PROGRAM_ID,
                        program: PROGRAM_ID,
                        systemProgram: SystemProgram.programId,
                    })
                    .rpc();
                console.log(`  ✓ Chunk ${i} delegated: ${tx}`);
                break;
            } catch (e: any) {
                const errStr = e.toString();
                if (errStr.includes("already been delegated") || errStr.includes("0x0") || errStr.includes("AccountOwnedByWrongProgram") || errStr.includes("3007")) {
                    console.log(`  - Chunk ${i} already delegated.`);
                    break;
                } else {
                    console.error(`  ! Retrying chunk ${i} delegation after 2s...`, e.message);
                    await sleep(2000);
                }
            }
        }
    }

    // 3. Delegate Ghosts
    console.log("3. Delegating 4 Ghosts via CPI...");
    for (let i = 0; i < NUM_GHOSTS; i++) {
        const [ghostPda] = getGhostPda(worldPda, i);
        while (true) {
            try {
                const tx = await program.methods
                    .delegateGhost(i)
                    .accountsStrict({
                        payer: operator.publicKey,
                        worldInfo: worldPda,
                        ghost: ghostPda,
                        buffer: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(ghostPda, PROGRAM_ID),
                        delegationRecord: delegationRecordPdaFromDelegatedAccount(ghostPda),
                        delegationMetadata: delegationMetadataPdaFromDelegatedAccount(ghostPda),
                        delegationProgram: DELEGATION_PROGRAM_ID,
                        program: PROGRAM_ID,
                        systemProgram: SystemProgram.programId,
                    })
                    .rpc();
                console.log(`  ✓ Ghost ${i} delegated: ${tx}`);
                break;
            } catch (e: any) {
                const errStr = e.toString();
                if (errStr.includes("already been delegated") || errStr.includes("0x0") || errStr.includes("AccountOwnedByWrongProgram") || errStr.includes("3007")) {
                    console.log(`  - Ghost ${i} already delegated.`);
                    break;
                } else {
                    console.error(`  ! Retrying ghost ${i} delegation after 2s...`, e.message);
                    await sleep(2000);
                }
            }
        }
    }

    console.log("Delegation complete!");
}

main().catch(console.error);
