import { useNavigate } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { program } from '../anchor/setup';
import { Keypair, SystemProgram } from '@solana/web3.js';

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

            //generating a new keypair for the game account
            const gameKeypair = Keypair.generate();
            console.log("New Game Public Key:", gameKeypair.publicKey.toBase58());

            //transaction call to create a new game
            const tx = await program.methods
            .createGame()
            .accounts({
                game: gameKeypair.publicKey,
                user: publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([gameKeypair])
            .transaction();

            console.log("Game created with signature:", tx);

            tx.feePayer = publicKey!;
            tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
            console.log('Transaction created, sending...');

            const simulation = await connection.simulateTransaction(tx);
            console.log('🧪 Transaction simulation result:', simulation);

            // Check if the simulation returned an error.
            if (simulation.value.err) {
                console.error("Transaction Simulation Failed!", {
                    error: simulation.value.err,
                    logs: simulation.value.logs,
                });
                alert("Transaction simulation failed! Check the browser console for the detailed error logs.");
                // Stop execution if the simulation fails.
                return;
            }

            const txSig = await sendTransaction(tx, connection);
            console.log("Transaction sent with signature:", txSig);

            // //sending the transaction
            // const signature = await sendTransaction(transaction, connection);
            // console.log("Transaction sent with signature:", signature);
            
            // //waiting for the transaction to be confirmed
            // await connection.confirmTransaction(signature, 'processed');
            // console.log("Transaction confirmed");

            alert("Game created successfully! Game ID: " + gameKeypair.publicKey.toBase58());

            navigate('/GameScreen');

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