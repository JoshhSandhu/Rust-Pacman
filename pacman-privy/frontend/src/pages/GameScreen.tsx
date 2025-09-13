import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSolanaWallets, useSendTransaction } from '@privy-io/react-auth';
import { Program, type IdlAccounts } from '@coral-xyz/anchor';
import { PublicKey, Connection, Transaction } from '@solana/web3.js';
import { IDL, type PacmanGame } from '../anchor/idl';

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

type GameData = IdlAccounts<PacmanGame>['gameData'];

const Direction = {
  Up: 0,
  Down: 1,
  Left: 2,
  Right: 3,
};

const GameScreen = () => {
  const { wallets } = useSolanaWallets();
  const { sendTransaction } = useSendTransaction();
  const [searchParams] = useSearchParams();
  const [gameId, setGameId] = useState<PublicKey | null>(null);
  const [gameData, setGameData] = useState<GameData | null>(null);
  const [localGameData, setLocalGameData] = useState<GameData | null>(null);
  const [pendingMoves, setPendingMoves] = useState<number[]>([]);
  const [isProcessingMove, setIsProcessingMove] = useState(false);

  // Get gameId from URL
  useEffect(() => {
    const id = searchParams.get('gameId');
    if (id) {
      try {
        setGameId(new PublicKey(id));
      } catch (error) {
        console.error('Invalid gameId:', error);
        alert('Invalid game ID in URL');
      }
    }
  }, [searchParams]);

  // Fetch and subscribe to game data
  useEffect(() => {
    if (!gameId) return;

    console.log('1. Starting data fetch for game:', gameId.toBase58());

    const solanaWallet = wallets[0]; // useSolanaWallets returns only Solana wallets
    if (!solanaWallet) {
      alert('Solana wallet not found. Please connect a wallet.');
      return;
    }

    let unsubscribeFn: (() => void) | undefined;

    (async () => {
      try {
        const connection = new Connection("https://api.devnet.solana.com", "confirmed");
        const program = new Program<PacmanGame>(IDL, { connection });

        const initial = await program.account.gameData.fetch(gameId);
        setGameData(initial);
        setLocalGameData(initial);

        const ee = program.account.gameData.subscribe(gameId, 'confirmed');
        ee.on('change', (updated: GameData) => {
          console.log('Game data update received:', updated);
          setGameData(updated);
          setLocalGameData(updated);
        });

        unsubscribeFn = () => {
          ee.removeAllListeners('change');
          console.log('Unsubscribed from game data updates.');
        };
      } catch (error) {
        console.error('Error fetching game data:', error);
        alert(`Failed to load game data: ${error.message}`);
      }
    })();

    return () => {
      if (unsubscribeFn) unsubscribeFn();
    };
  }, [gameId, wallets]);

  // Handle player movement via arrow keys
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      let direction: number | null = null;
      switch (event.key) {
        case 'ArrowUp':
          direction = Direction.Up;
          break;
        case 'ArrowDown':
          direction = Direction.Down;
          break;
        case 'ArrowLeft':
          direction = Direction.Left;
          break;
        case 'ArrowRight':
          direction = Direction.Right;
          break;
      }
      if (direction !== null) {
        movePlayer(direction);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [wallets, gameId]);

  // Process pending moves every 2 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      processPendingMoves();
    }, 2000);

    return () => clearInterval(interval);
  }, [pendingMoves, isProcessingMove]);

  // Local move function for immediate UI updates
  const performLocalMove = (direction: number) => {
    if (!localGameData) return;

    const newGameData = { ...localGameData };
    let targetX = newGameData.playerX;
    let targetY = newGameData.playerY;

    // Calculate target position
    switch (direction) {
      case Direction.Up:
        targetY = Math.max(0, newGameData.playerY - 1);
        break;
      case Direction.Down:
        targetY = Math.min(9, newGameData.playerY + 1);
        break;
      case Direction.Left:
        targetX = Math.max(0, newGameData.playerX - 1);
        break;
      case Direction.Right:
        targetX = Math.min(9, newGameData.playerX + 1);
        break;
    }

    // Check for wall collision
    if (newGameData.board[targetY][targetX] === 1) {
      return; // Can't move into wall
    }

    // Check for pellet collection
    if (newGameData.board[targetY][targetX] === 0) {
      newGameData.score += 10;
      newGameData.board[targetY][targetX] = 2; // Mark pellet as eaten
    }

    // Update player position
    newGameData.playerX = targetX;
    newGameData.playerY = targetY;

    setLocalGameData(newGameData);
  };

  // Batch moves and send to blockchain
  const processPendingMoves = async () => {
    if (pendingMoves.length === 0 || isProcessingMove) return;

    setIsProcessingMove(true);
    const movesToProcess = [...pendingMoves];
    setPendingMoves([]);

    try {
      const solanaWallet = wallets[0];
      if (!solanaWallet || !gameId) {
        throw new Error('Wallet or game ID missing');
      }

      const connection = new Connection("https://api.devnet.solana.com", "confirmed");
      const program = new Program<PacmanGame>(IDL, { connection });

      // Process moves one by one (could be optimized to batch multiple moves)
      for (const direction of movesToProcess) {
        const txn = await program.methods
          .playerMnt(direction)
          .accounts({ game: gameId, user: solanaWallet.address })
          .transaction();

        txn.feePayer = new PublicKey(solanaWallet.address);
        const { blockhash } = await connection.getLatestBlockhash();
        txn.recentBlockhash = blockhash;

        let signature;
        if (solanaWallet.meta?.name === 'Phantom') {
          if (window.solana && window.solana.signAndSendTransaction) {
            signature = await window.solana.signAndSendTransaction(txn);
          } else {
            throw new Error('Phantom wallet not found');
          }
        } else {
          try {
            const provider = await solanaWallet.getProvider();
            const result = await provider.request({
              method: 'signAndSendTransaction',
              params: {
                transaction: txn.serializeMessage().toString('base64'),
              },
            });
            signature = result.signature;
          } catch (providerError) {
            signature = await solanaWallet.signAndSendTransaction(txn);
          }
        }
        
        console.log('Move transaction successful:', signature);
      }
    } catch (error) {
      console.error('Error processing moves:', error);
      // Re-add failed moves to pending
      setPendingMoves(prev => [...prev, ...movesToProcess]);
    } finally {
      setIsProcessingMove(false);
    }
  };

  // Move player function (now adds to pending moves)
  const movePlayer = (direction: number) => {
    performLocalMove(direction);
    setPendingMoves(prev => [...prev, direction]);
  };

  // Render game board
  const renderBoard = () => {
    const currentGameData = localGameData || gameData;
    if (!currentGameData) return <div>Loading Game...</div>;

    return currentGameData.board.map((row, y) =>
      row.map((cell, x) => {
        const isPlayerHere = currentGameData.playerX === x && currentGameData.playerY === y;
        let cellContent = null;

        if (isPlayerHere) {
          cellContent = '😀';
        } else {
          switch (cell) {
            case 0: // Pellet
              cellContent = <div className="pellet"></div>;
              break;
            case 1: // Wall
              cellContent = <div className="wall"></div>;
              break;
            case 2: // Empty space
              cellContent = null;
              break;
          }
        }

        return (
          <div key={`${x}-${y}`} className="game-cell">
            {cellContent}
          </div>
        );
      })
    );
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen">
      <h1 className="text-3xl font-bold mb-4">Pacman Game</h1>
      <p className="mb-2 text-xs">Game PDA: {gameId?.toBase58() ?? 'Loading...'}</p>
      <p className="mb-2">Score: {(localGameData || gameData)?.score.toString() ?? '0'}</p>
      {pendingMoves.length > 0 && (
        <p className="mb-2 text-sm text-yellow-600">
          Pending moves: {pendingMoves.length} {isProcessingMove && '(Processing...)'}
        </p>
      )}
      <div className="game-board">{renderBoard()}</div>
      <p className="mt-4">Use Arrow Keys to Move</p>
      <p className="text-sm text-gray-600">Moves are batched every 2 seconds</p>
    </div>
  );
};

export default GameScreen;