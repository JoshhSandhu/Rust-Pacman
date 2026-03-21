import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction } from '@solana/web3.js';
import { createDelegateInstruction } from '@magicblock-labs/ephemeral-rollups-sdk';

const PROGRAM_ID = new PublicKey('46gDjnJLeuMqKLJjHow4B4xt6BLspzf7owBydzSvSByH');
const DEVNET_RPC = 'https://api.devnet.solana.com';

function getWorldPda(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from('world')], PROGRAM_ID);
}

async function main() {
    const operator = Keypair.generate();
    const [worldPda] = getWorldPda();

    const tx = new Transaction();
    const ix = createDelegateInstruction({
        ownerProgram: PROGRAM_ID,
        delegatedAccount: worldPda,
        payer: operator.publicKey,
    }, {
        seeds: [Buffer.from('world')]
    });

    console.log("Before hack:");
    console.dir(ix.keys, { depth: null });

    ix.keys[1].isSigner = false;

    console.log("After hack:");
    console.dir(ix.keys, { depth: null });

    tx.add(ix);
    tx.feePayer = operator.publicKey;

    tx.recentBlockhash = '11111111111111111111111111111111';

    const msg = tx.compileMessage();
    console.log("Num required signatures:", msg.header.numRequiredSignatures);
    for (let i = 0; i < msg.header.numRequiredSignatures; i++) {
        console.log(`Requires signature from: ${msg.accountKeys[i].toBase58()}`);
    }
}

main().catch(console.error);
