import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import * as fs from 'fs';

const idl = require('../target/idl/pac_royale.json');

const PROGRAM_ID = new PublicKey('46gDjnJLeuMqKLJjHow4B4xt6BLspzf7owBydzSvSByH');
const DEVNET_RPC = 'https://api.devnet.solana.com';
const BPF_UPGRADEABLE_LOADER_ID = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

const KEYPAIR_PATH = process.env.HOME + '/.config/solana/id.json';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
    console.log('Loading operator wallet from', KEYPAIR_PATH);
    const keypairFile = fs.readFileSync(KEYPAIR_PATH, 'utf-8');
    const operator = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(keypairFile)));

    const connection = new Connection(DEVNET_RPC, 'confirmed');
    const wallet = new anchor.Wallet(operator);
    const provider = new anchor.AnchorProvider(connection, wallet, {
        commitment: 'confirmed',
        preflightCommitment: 'confirmed',
    });

    const program = new Program(idl, provider);

    const [worldPda] = PublicKey.findProgramAddressSync([Buffer.from('world')], PROGRAM_ID);
    const [anteroomPda] = PublicKey.findProgramAddressSync([Buffer.from('anteroom'), worldPda.toBuffer()], PROGRAM_ID);
    const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from('vault'), worldPda.toBuffer()], PROGRAM_ID);
    const [programDataPda] = PublicKey.findProgramAddressSync([PROGRAM_ID.toBuffer()], BPF_UPGRADEABLE_LOADER_ID);

    console.log("1. Initializing World...");
    while (true) {
        try {
            const tx = await program.methods
                .initWorld(Buffer.from("Pac-Royale ER"))
                .accountsStrict({
                    world: worldPda,
                    anteroom: anteroomPda,
                    vault: vaultPda,
                    authority: operator.publicKey,
                    program: PROGRAM_ID,
                    programData: programDataPda,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();
            console.log("  ✓ World initialized:", tx);
            break;
        } catch (e: any) {
            if (e.toString().includes("already in use") || e.toString().includes("already initialized")) {
                console.log("  - World already initialized.");
                break;
            } else {
                console.error("  ! Retrying world initialization after 5s...", e.message);
                await sleep(5000);
            }
        }
    }

    console.log("2. Initializing 32 Chunks with retry loop...");
    for (let i = 0; i < 32; i++) {
        const [chunkPda] = PublicKey.findProgramAddressSync([Buffer.from("chunk"), worldPda.toBuffer(), Buffer.from([i])], PROGRAM_ID);
        while (true) {
            try {
                const tx = await program.methods
                    .initChunk(i, i % 10)
                    .accountsStrict({
                        world: worldPda,
                        chunk: chunkPda,
                        authority: operator.publicKey,
                        systemProgram: SystemProgram.programId,
                    })
                    .rpc();
                console.log(`  ✓ Chunk ${i} initialized: ${tx}`);
                break;
            } catch (e: any) {
                if (e.toString().includes("already in use") || e.toString().includes("already initialized") || e.toString().includes("0x0")) {
                    console.log(`  - Chunk ${i} already initialized.`);
                    break;
                } else {
                    console.error(`  ! Retrying chunk ${i} after 5s...`, e.message);
                    await sleep(5000);
                }
            }
        }
    }

    console.log("3. Initializing Ghosts with retry loop...");
    for (let i = 0; i < 4; i++) {
        const [ghostPda] = PublicKey.findProgramAddressSync([Buffer.from("ghost"), worldPda.toBuffer(), Buffer.from([i])], PROGRAM_ID);
        while (true) {
            try {
                const tx = await program.methods
                    .initGhost(i)
                    .accountsStrict({
                        world: worldPda,
                        ghost: ghostPda,
                        authority: operator.publicKey,
                        systemProgram: SystemProgram.programId,
                    })
                    .rpc();
                console.log(`  ✓ Ghost ${i} initialized: ${tx}`);
                break;
            } catch (e: any) {
                if (e.toString().includes("already in use") || e.toString().includes("already initialized") || e.toString().includes("0x0")) {
                    console.log(`  - Ghost ${i} already initialized.`);
                    break;
                } else {
                    console.error(`  ! Retrying ghost ${i} after 5s...`, e.message);
                    await sleep(5000);
                }
            }
        }
    }

    console.log("Initialization complete!");
}

main().catch(console.error);
