import { useNavigate } from 'react-router-dom';
import { useWallets } from '@privy-io/react-auth';
import { program } from '../anchor/setup'; // We can use our clean setup file again
import { SystemProgram, PublicKey, Transaction } from '@solana/web3.js';
import { Buffer } from 'buffer';

const RouteSelector = () => {
    const navigate = useNavigate();
    const { wallets } = useWallets();

    console.log("Wallets from Privy:", wallets);
    
    const handleCreateGame = async () => {
        const solanaWallet = wallets.find((wallet) => wallet.chainId.includes('solana'));
        if (!solanaWallet) {
            alert("Solana wallet not found. Please ensure you are logged in.");
            return;
        }

        try {
            const publicKey = new PublicKey(solanaWallet.address);
            const connection = program.provider.connection;

            const [gamePda] = PublicKey.findProgramAddressSync(
                [Buffer.from("game"), publicKey.toBuffer()],
                program.programId
            );
            
            // 1. Build the transaction using our global program object
            const transaction = await program.methods
                .createGame()
                .accounts({
                    game: gamePda,
                    user: publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .transaction();

            // 2. Sign and send the transaction using Privy's method
            const signature = await solanaWallet.sendTransaction(transaction);

            // 3. Wait for confirmation
            await connection.confirmTransaction(signature, 'finalized');

            console.log("Game created with signature:", signature);
            alert("Game created successfully!");
            navigate(`/GameScreen?gameId=${gamePda.toBase58()}`);

        } catch (error) {
            console.error("Error creating game:", error);
            alert(`Error creating game: ${error}`);
        }   
    };

    return (
        <div className="flex flex-col items-center justify-center h-screen space-y-6">
            <h2 className="text-2xl font-semibold">Start a New Game</h2>
            <div className="space-x-4">
                <button
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    onClick={handleCreateGame}
                    disabled={wallets.length === 0}
                >
                    Start Game
                </button>
            </div>
        </div>
    );
};

export default RouteSelector;