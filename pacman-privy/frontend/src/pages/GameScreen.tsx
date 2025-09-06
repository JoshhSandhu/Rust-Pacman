import { use, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { program, type GameData } from '../anchor/setup';

const BOARD_SIZE = 10;

const Direction = {
    Up: 0,
    Down: 1,
    Left: 2,
    Right: 3,
};

// 0 = Pellet, 1 = Wall, 2 = Empty
//not used anymore as the board is now stored on-chain
// const levelLayout = [
//   [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
//   [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
//   [1, 0, 1, 1, 0, 0, 1, 1, 0, 1],
//   [1, 0, 0, 0, 0, 1, 0, 0, 0, 1],
//   [1, 0, 1, 0, 0, 0, 0, 1, 0, 1],
//   [1, 0, 1, 0, 0, 2, 0, 1, 0, 1],
//   [1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
//   [1, 0, 1, 1, 1, 1, 1, 1, 0, 1],
//   [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
//   [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
// ];

const GameScreen = () => {
    const { publicKey, sendTransaction} = useWallet();
    const [searchParams] = useSearchParams();
    const connection = program.provider.connection;

    // a place to hold the pblic key of the surrent game PDA
    const [ gameId, setGameId ] = useState<PublicKey | null>(null);

    //state to hold the live game data
    const [ gameData, setGameData ] = useState<GameData | null>(null);

    //getting the gameId from the url
    useEffect(() => {
        const id = searchParams.get('gameId');
        if (id) {
            setGameId(new PublicKey(id));
        }
    }, [searchParams]);

    useEffect(() => {
        if (!gameId) return;

        console.log("1. Starting data fetch for game:", gameId.toBase58());
        //set up a listener for account changes
        const listener = program.account.gameData.subscribe(gameId, 'confirmed');
        listener.on('change', (data) => {
            console.log("Game data updated at slot", data);
            setGameData(data as GameData);
        });

         const fetchInitialState = async () => {
            try {
                console.log("2. About to call program.account.gameData.fetch()...");
                const data = await program.account.gameData.fetch(gameId, "processed");
                console.log("3. fetch() completed successfully! Received data:", data);
                setGameData(data as GameData);
            } catch (e) {
                console.error("4. fetch() failed with an error:", e);
            }
        };

        fetchInitialState();
        
        return () => {
            program.account.gameData.unsubscribe(listener);
        };

    },[gameId]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            let direction: number | null = null;
            switch (event.key) {
                case "ArrowUp":    direction = Direction.Up;    break;
                case "ArrowDown":  direction = Direction.Down;  break;
                case "ArrowLeft":  direction = Direction.Left;  break;
                case "ArrowRight": direction = Direction.Right; break;
            }
            if (direction !== null) {
                movePlayer(direction);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => { window.removeEventListener('keydown', handleKeyDown); };
    }, [gameId, publicKey]); // We depend on gameId and publicKey to send the transaction

    // The updated movement function
    const movePlayer = async (direction: number) => {
        if (!publicKey || !gameId) return;

        try {
            // Build the transaction for the `playerMnt` instruction
            const transaction = await program.methods
                .playerMnt(direction)
                .accounts({
                    game: gameId,       // The address of the game's PDA
                    user: publicKey,    // The player's address is also required by the program
                })
                .transaction();

            const signature = await sendTransaction(transaction, connection);
            await connection.confirmTransaction(signature, "finalized");
            console.log("Move transaction successful:", signature);

            const latestData = await program.account.gameData.fetch(gameId, "finalized");
            setGameData(latestData as GameData);
            console.log("Updated game data after move:", latestData); //update the local state after the move

        } catch (error) {
            console.error("Error sending move transaction:", error);
        }
    };


    // Function to render the game board UI
    const renderBoard = () => {
        if (!gameData) return <div>Loading Game...</div>;

        return gameData.board.map((row, y) =>  //changed to take the board from the on-chain data
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
            <p className="mb-2 text-xs">Game PDA: {gameId?.toBase58()}</p>
            <p className="mb-4">Score: {gameData?.score.toString() ?? '0'}</p>
            
            {/* This is the container for the board */}
            <div className="game-board">
                {/* You must call the function here to render the board */}
                {renderBoard()}
            </div>
            
            <p className="mt-4">Use Arrow Keys to Move</p>
        </div>
    );
};

export default GameScreen;
