// server/index.ts (Example backend file)
import express from 'express';
import { PrivyClient } from '@privy-io/server-auth';
import { AnchorProvider, Program, utils } from '@project-serum/anchor';
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

        // setting up connection to the Solana cluster
        const wallet = { publicKey: new PublicKey(walletAddress) }; 
        const connection = new Connection(process.env.SOLANA_RPC_URL!);
        const provider = new AnchorProvider(connection, {} as any, {});
        const program = new Program(IDL, new PublicKey('6mE2bt2zrKhQGSXEq5cNbiZ2MGxv6iTNzar6pdDYUwVp'), provider);

        const [gamePda] = PublicKey.findProgramAddressSync(
            [Buffer.from("game"), new PublicKey(walletAddress).toBuffer()],
            program.programId
        );
        const moveTx = await program.methods
            .playerMnt(direction)
            .accounts({
                game: gamePda, // Use the derived PDA
                user: new PublicKey(walletAddress), // The user's public key
            })
            .transaction();
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