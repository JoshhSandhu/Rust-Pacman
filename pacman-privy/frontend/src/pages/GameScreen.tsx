import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useWallets, useSendTransaction } from '@privy-io/react-auth';
import { Program, type IdlAccounts } from '@coral-xyz/anchor';
import { PublicKey, Connection } from '@solana/web3.js';
import { IDL, type PacmanGame } from '../anchor/idl';

type GameData = IdlAccounts<PacmanGame>['gameData'];

const Direction = {
  Up: 0,
  Down: 1,
  Left: 2,
  Right: 3,
};

const GameScreen = () => {
  const { wallets } = useWallets();
  const { sendTransaction } = useSendTransaction();
  const [searchParams] = useSearchParams();
  const [gameId, setGameId] = useState<PublicKey | null>(null);
  const [gameData, setGameData] = useState<GameData | null>(null);

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

    const solanaWallet = wallets.find((wallet) => wallet.chainId.includes('solana'));
    if (!solanaWallet) {
      alert('Solana wallet not found. Please connect a wallet.');
      return;
    }

    let unsubscribeFn: (() => void) | undefined;

    (async () => {
      try {
        const provider = await solanaWallet.getAnchorProvider();
        const program = new Program<PacmanGame>(IDL, provider);

        const initial = await program.account.gameData.fetch(gameId);
        setGameData(initial);

        const ee = program.account.gameData.subscribe(gameId, 'confirmed');
        ee.on('change', (updated: GameData) => {
          console.log('Game data update received:', updated);
          setGameData(updated);
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

  // Move player function
  const movePlayer = async (direction: number) => {
    const solanaWallet = wallets.find((wallet) => wallet.chainId.includes('solana'));
    if (!solanaWallet || !gameId) {
      alert('Solana wallet or game ID missing.');
      return;
    }

    try {
      const provider = await solanaWallet.getAnchorProvider();
      const program = new Program<PacmanGame>(IDL, provider);
      const connection = provider.connection;

      const txn = await program.methods
        .playerMnt(direction)
        .accounts({ game: gameId, user: solanaWallet.address })
        .transaction();

      const receipt = await sendTransaction({ transaction: txn, connection, address: solanaWallet.address });
      console.log('Move transaction successful:', receipt.signature);
    } catch (error) {
      console.error('Error sending move transaction:', error);
      alert(`Failed to move player: ${error.message}`);
    }
  };

  // Render game board
  const renderBoard = () => {
    if (!gameData) return <div>Loading Game...</div>;

    return gameData.board.map((row, y) =>
      row.map((cell, x) => {
        const isPlayerHere = gameData.playerX === x && gameData.playerY === y;
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
      <p className="mb-4">Score: {gameData?.score.toString() ?? '0'}</p>
      <div className="game-board">{renderBoard()}</div>
      <p className="mt-4">Use Arrow Keys to Move</p>
    </div>
  );
};

export default GameScreen;