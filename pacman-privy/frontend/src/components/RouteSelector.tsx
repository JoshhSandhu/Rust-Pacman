import { useNavigate } from 'react-router-dom';
import { useSolanaWallets } from '@privy-io/react-auth';
import { useSendTransaction } from '@privy-io/react-auth/solana';
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import { IDL, type PacmanGame } from '../anchor/idl';
import { PublicKey, SystemProgram, Connection, Transaction } from '@solana/web3.js';
import { Buffer } from 'buffer';

// Extend window interface for Phantom wallet
declare global {
  interface Window {
    solana?: {
      signAndSendTransaction: (transaction: Transaction) => Promise<{ signature: string }>;
      signTransaction: (transaction: Transaction) => Promise<Transaction>;
      connect: () => Promise<void>;
      isPhantom?: boolean;
    };
  }
}

const RouteSelector = () => {
  const navigate = useNavigate();
  const { wallets } = useSolanaWallets();
  const { sendTransaction } = useSendTransaction();

  console.log('Wallets from Privy:', wallets);

  const handleCreateGame = async () => {
    const solanaWallet = wallets[0]; // useSolanaWallets returns only Solana wallets
    if (!solanaWallet) {
      alert('Solana wallet not found. Please ensure you are logged in.');
      return;
    }

    try {
      const publicKey = new PublicKey(solanaWallet.address);
      const connection = new Connection("https://api.devnet.solana.com", "confirmed");
      
      // Use the static program for building the transaction
      const program = new Program<PacmanGame>(IDL, { connection });
      
      console.log('Program ID:', program.programId.toBase58());
      console.log('User public key:', publicKey.toBase58());
      
      // Check if program exists on devnet
      try {
        const programInfo = await connection.getAccountInfo(program.programId);
        console.log('Program account info:', programInfo ? 'Program exists' : 'Program not found');
        if (programInfo) {
          console.log('Program owner:', programInfo.owner.toBase58());
          console.log('Program executable:', programInfo.executable);
          console.log('Program data length:', programInfo.data.length);
        }
      } catch (err) {
        console.log('Error checking program:', err.message);
      }
      
      const [gamePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('game'), publicKey.toBuffer()],
        program.programId
      );
      
      console.log('Game PDA:', gamePda.toBase58());
      
      // Check account space calculation
      // GameData: score (u64=8) + player_x (u8=1) + player_y (u8=1) + board (10x10 u8=100) + discriminator (8) = 118 bytes
      const expectedSpace = 8 + 8 + 1 + 1 + 100; // discriminator + score + player_x + player_y + board
      console.log('Expected account space:', expectedSpace, 'bytes');

      // Check if game account already exists
      try {
        const existingGame = await connection.getAccountInfo(gamePda);
        if (existingGame) {
          console.log('Game already exists, navigating to existing game...');
          alert('Game already exists! Redirecting to your game.');
          navigate(`/GameScreen?gameId=${gamePda.toBase58()}`);
          return;
        }
      } catch (err) {
        console.log('Error checking existing game:', err.message);
      }

      // Building the transaction using Anchor's methods
      console.log('Building transaction...');
      const transaction = await program.methods
        .createGame()
        .accounts({
          game: gamePda,
          user: publicKey,
          systemProgram: SystemProgram.programId,
        })
        .transaction();
      
      console.log('Transaction instructions:', transaction.instructions.length);
      console.log('Transaction instruction details:', transaction.instructions.map(ix => ({
        programId: ix.programId.toBase58(),
        keys: ix.keys.length,
        data: ix.data.length
      })));
      
      // Set the fee payer and recent blockhash
      transaction.feePayer = publicKey;
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      
      console.log('Transaction built successfully');
      
      // Simulate the transaction to catch errors early
      try {
        console.log('Simulating transaction...');
        const simulation = await connection.simulateTransaction(transaction);
        if (simulation.value.err) {
          console.error('Transaction simulation failed:', simulation.value.err);
          console.error('Full simulation result:', simulation);
          console.error('Simulation logs:', simulation.value.logs);
          alert(`Transaction simulation failed: ${JSON.stringify(simulation.value.err)}\nLogs: ${simulation.value.logs?.join('\n') || 'No logs'}`);
          return;
        }
        console.log('Transaction simulation successful');
      } catch (simErr) {
        console.error('Error simulating transaction:', simErr);
        alert(`Error simulating transaction: ${simErr.message}`);
        return;
      }

      // Sending the transaction using Privy's sendTransaction helper
      console.log('Sending transaction...');
      console.log('Transaction details:', {
        recentBlockhash: transaction.recentBlockhash,
        feePayer: transaction.feePayer?.toBase58(),
        instructions: transaction.instructions.length
      });
      
      // Use Phantom's specific API for signing and sending transactions
      let signature;
      if (solanaWallet.meta?.name === 'Phantom') {
        // For Phantom wallet, use window.solana
        if (window.solana && window.solana.signAndSendTransaction) {
          signature = await window.solana.signAndSendTransaction(transaction);
        } else {
          throw new Error('Phantom wallet not found or not connected');
        }
      } else {
        // For other wallets, try the provider method
        try {
          const provider = await solanaWallet.getProvider();
          const result = await provider.request({
            method: 'signAndSendTransaction',
            params: {
              transaction: transaction.serializeMessage().toString('base64'),
            },
          });
          signature = result.signature;
        } catch (providerError) {
          // Fallback to direct wallet methods
          signature = await solanaWallet.signAndSendTransaction(transaction);
        }
      }
      
      const receipt = { signature };

      console.log('Transaction sent, signature:', receipt.signature);
      
      // Wait for confirmation
      console.log('Waiting for confirmation...');
      await connection.confirmTransaction(receipt.signature, 'finalized');
      console.log('Transaction confirmed');

      console.log('Game created with signature:', receipt.signature);
      alert('Game created successfully!');
      navigate(`/GameScreen?gameId=${gamePda.toBase58()}`);
    } catch (error) {
      console.error('Error creating game:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name,
        cause: error.cause
      });
      
      // More specific error messages
      if (error.message?.includes('Program')) {
        alert(`Program error: ${error.message}`);
      } else if (error.message?.includes('signature')) {
        alert(`Signature error: ${error.message}`);
      } else if (error.message?.includes('blockhash')) {
        alert(`Blockhash error: ${error.message}`);
      } else {
        alert(`Error creating game: ${error.message || 'Unknown error'}`);
      }
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