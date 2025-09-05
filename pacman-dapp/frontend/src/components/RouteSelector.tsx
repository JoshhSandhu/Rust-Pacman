import { useNavigate } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { program } from '../anchor/setup';
import { Keypair, SystemProgram, PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';

const RoleSeector = () => {
    const navigate = useNavigate();

    //getting the wallet details from the useWallet hook
    const { wallet, connected, publicKey, sendTransaction } = useWallet();

    //connnection object from the anchor program
    const connection = program.provider.connection;

    const handlecreateGame = async () => {
        if (!wallet) {
            alert("Please connect your wallet");
            return;
        }
        if (!publicKey) {
            alert("Public key not found");
            return;
        }

        console.log("🔑 Active wallet public key being used for transaction:", publicKey.toBase58());

        try {

            // The seeds must match the ones in your smart contract: [b"game", user.key().as_ref()]
            const [gamePda] = PublicKey.findProgramAddressSync(
                [Buffer.from("game"), publicKey.toBuffer()],
                program.programId
            );
            console.log("Calculated Game PDA:", gamePda.toBase58());

            //transaction call to create a new game
            const tx = await program.methods
            .createGame()
            .accounts({
                game: gamePda,
                user: publicKey,
                systemProgram: SystemProgram.programId,
            })
            .transaction();

            console.log("Game created with signature:", tx);

            // tx.feePayer = publicKey!;
            // tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
            // console.log('Transaction created, sending...');

            // const simulation = await connection.simulateTransaction(tx);
            // console.log('🧪 Transaction simulation result:', simulation);

            // // Check if the simulation returned an error.
            // if (simulation.value.err) {
            //     console.error("Transaction Simulation Failed!", {
            //         error: simulation.value.err,
            //         logs: simulation.value.logs,
            //     });
            //     alert("Transaction simulation failed! Check the browser console for the detailed error logs.");
            //     // Stop execution if the simulation fails.
            //     return;
            // }

            // console.log("Simulation worked, submitting transaction...");
            const signature = await sendTransaction(tx, connection);
            console.log("Transaction sent with signature:", signature);
            
            await connection.confirmTransaction(signature, 'finalized');
            console.log("Transaction confirmed");

            alert("Game created successfully! Game ID: " + gamePda.toBase58());

            navigate(`/GameScreen?gameId=${gamePda.toBase58()}`);

        } catch (error) {
            console.error("Error creating game:", error);
        }    

    };
    return (
        <div className="flex flex-col items-center justify-center h-screen space-y-6">
            <h2 className="text-2xl font-semibold">Select your role</h2>
            {!connected && ( <p className="text-red-500 mb-4">Please connect your wallet first</p> )}

            <div className="space-x-4">
                <button
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    onClick = {handlecreateGame}
                    disabled={!connected}
                > game started
                </button>
            </div>
        </div>
    );
};
export default RoleSeector;