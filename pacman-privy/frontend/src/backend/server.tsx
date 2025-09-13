// server/index.ts (Example backend file)
import express from 'express';
import { PrivyClient } from '@privy-io/server-auth';
import { AnchorProvider, Program } from '@project-serum/anchor';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
// Import your smart contract's IDL and other necessary files
import { IDL } from '../anchor/idl'; 

const app = express();
app.use(express.json());

const privy = new PrivyClient(
    process.env.PRIVY_APP_ID!,
    process.env.PRIVY_APP_SECRET!,
    { walletApi: { authorizationPrivateKey: process.env.AUTHORIZATION_PRIVATE_KEY! } }
);

app.post('/api/move', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader?.substring(7);
        if (!token) return res.status(401).send('Unauthorized');

        const verifiedClaims = await privy.verifyAuthToken(token);
        const { direction, walletAddress } = req.body;

        // 1. Set up connection to Solana and your Anchor program
        const connection = new Connection(process.env.SOLANA_RPC_URL!);
        const provider = new AnchorProvider(connection, {} as any, {});
        const program = new Program(IDL, new PublicKey('YOUR_PROGRAM_ID'), provider);

        // 2. Create the move transaction
        const moveTx = await program.methods
            .playerMnt(direction)
            .accounts({
                // You will need to dynamically find the game account PDA
                // based on the user's verified Privy DID (verifiedClaims.userId)
            })
            .transaction();
        
        // 3. Use Privy's SDK to sign and send
        const txHash = await privy.solana.sendAndConfirmTransaction({
            walletAddress: walletAddress,
            transaction: moveTx,
            connection: connection,
        });

        res.status(200).json({ success: true, txHash });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false });
    }
});

app.listen(3001);