import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSolanaWallets, useSessionSigners, useDelegatedActions } from '@privy-io/react-auth';
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

// Privy Session Configuration
const SESSION_SIGNER_ID = import.meta.env.VITE_SESSION_SIGNER_ID || "tdmmibs88sdrdr1v575t51cr";

const Direction = {
  Up: 0,
  Down: 1,
  Left: 2,
  Right: 3,
};

const GameScreen = () => {
  const { wallets } = useSolanaWallets();
  const { addSessionSigners, removeSessionSigners } = useSessionSigners();
  const { delegateWallet } = useDelegatedActions();
  const [searchParams] = useSearchParams();
  const [gameId, setGameId] = useState<PublicKey | null>(null);
  const [gameData, setGameData] = useState<GameData | null>(null);
  const [localGameData, setLocalGameData] = useState<GameData | null>(null);
  const [pendingMoves, setPendingMoves] = useState<number[]>([]);
  const [isProcessingMove, setIsProcessingMove] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);

  // Check if wallet has active session
  const embeddedWallet = wallets.find((w) => w.walletClientType === 'privy');
  const hasActiveSession = embeddedWallet?.delegated === true;

  // Debug logging
  console.log('🔍 Debug Info:', {
    wallets: wallets.length,
    embeddedWallet: embeddedWallet ? 'Found' : 'Not found',
    sessionActive,
    hasActiveSession,
    SESSION_SIGNER_ID: SESSION_SIGNER_ID ? 'Set' : 'Not set'
  });

  // Update session status when wallet changes
  useEffect(() => {
    setSessionActive(hasActiveSession);
  }, [hasActiveSession]);

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

  // Create Privy session delegation for batched transactions
  const createSession = useCallback(async () => {
    console.log('🚀 createSession called!', {
      sessionActive,
      isCreatingSession,
      embeddedWallet: embeddedWallet ? 'Found' : 'Not found',
      SESSION_SIGNER_ID: SESSION_SIGNER_ID ? 'Set' : 'Not set'
    });

    if (sessionActive || isCreatingSession || !embeddedWallet) {
      console.log('❌ Session creation blocked:', {
        sessionActive,
        isCreatingSession,
        embeddedWallet: !!embeddedWallet
      });
      return;
    }

    setIsCreatingSession(true);
    try {
      if (!SESSION_SIGNER_ID) {
        throw new Error('Session signer ID not configured. Please check your environment variables.');
      }

      console.log('Creating Privy session delegation...');
      
      // Use Privy's session delegation
      await delegateWallet({
        chainType: 'solana'
      });

      console.log('Privy session delegation created successfully!');
      setSessionActive(true);
      alert('Session created! Moves will be batched without multiple confirmations.');
    } catch (error) {
      console.error('Error creating session:', error);
      alert(`Failed to create session: ${error.message || error}`);
    } finally {
      setIsCreatingSession(false);
    }
  }, [sessionActive, isCreatingSession, embeddedWallet, delegateWallet]);

  // Batch moves and send to blockchain (with session delegation)
  const processPendingMoves = async () => {
    if (pendingMoves.length === 0 || isProcessingMove) return;

    // If session not active, create it first
    if (!sessionActive) {
      await createSession();
      return;
    }

    setIsProcessingMove(true);
    const movesToProcess = [...pendingMoves];
    setPendingMoves([]);

    try {
      const solanaWallet = wallets[0];
      if (!solanaWallet || !gameId || !embeddedWallet) {
        throw new Error('Wallet or game ID missing');
      }

      const connection = new Connection("https://api.devnet.solana.com", "confirmed");
      const program = new Program<PacmanGame>(IDL, { connection });

      // Process moves one by one using delegated transactions
      for (const direction of movesToProcess) {
        const txn = await program.methods
          .playerMnt(direction)
          .accounts({ game: gameId, user: solanaWallet.address })
          .transaction();

        txn.feePayer = new PublicKey(solanaWallet.address);
        const { blockhash } = await connection.getLatestBlockhash();
        txn.recentBlockhash = blockhash;

        // Use delegated transaction signing
        const signature = await embeddedWallet.signAndSendTransaction(txn);
        
        console.log('Delegated move transaction successful:', signature);
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
      
      {/* Session Status */}
      <div className="mb-4 flex items-center gap-4">
        {sessionActive ? (
          <div className="flex items-center gap-2 text-green-600">
            <span className="w-2 h-2 bg-green-500 rounded-full"></span>
            <span className="text-sm">Session Active</span>
          </div>
        ) : (
          <button
            onClick={() => {
              console.log('🔘 Create Session button clicked!');
              createSession();
            }}
            disabled={isCreatingSession || !embeddedWallet}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            {isCreatingSession ? 'Creating Session...' : 'Create Session'}
          </button>
        )}
        
        {pendingMoves.length > 0 && (
          <p className="text-sm text-yellow-600">
            Pending moves: {pendingMoves.length} {isProcessingMove && '(Processing...)'}
          </p>
        )}
      </div>
      
      <div className="game-board">{renderBoard()}</div>
      <p className="mt-4">Use Arrow Keys to Move</p>
      <p className="text-sm text-gray-600">
        {sessionActive 
          ? 'Moves are batched and auto-confirmed every 2 seconds' 
          : 'Create session to enable batched transactions'
        }
      </p>
    </div>
  );
};

export default GameScreen;