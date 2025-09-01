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

        //set up a listner for account changes
        const listner = program.account.gameData.subscribe(gameId, 'confirmed');
        listner.on('change', (data) => {
            console.log("Game data updated at slot", data);
            setGameData(data as GameData);
        });

        const fetchInitialState = async () => {
            try {
                const data = await program.account.gameData.fetch(gameId, "processed");
                setGameData(data as GameData);
            } catch (e) {
                console.error("Failed to fetch game data:", e);
            }
        };

        fetchInitialState();
        
        return () => {
            program.account.gameData.unsubscribe(listner);
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
            await connection.confirmTransaction(signature, "confirmed");
            console.log("Move transaction successful:", signature);
        } catch (error) {
            console.error("Error sending move transaction:", error);
        }
    };


    // Function to render the game board UI
    const renderBoard = () => {
        if (!gameData) return <div>Loading Game...</div>;

        const grid = [];
        for (let y = 0; y < BOARD_SIZE; y++) {
            for (let x = 0; x < BOARD_SIZE; x++) {
                const isPlayerHere = gameData.playerX === x && gameData.playerY === y;
                grid.push(
                    <div key={`${x}-${y}`} className="game-cell">
                        {isPlayerHere ? '😀' : ''}
                    </div>
                );
            }
        }
        return grid;
    };

    return (
        <div className="flex flex-col items-center justify-center h-screen">
            <h1 className="text-3xl font-bold mb-4">Pacman Game</h1>
            <p className="mb-2 text-xs">Game PDA: {gameId?.toBase58()}</p>
            <p className="mb-4">Score: {gameData?.score.toString() ?? '0'}</p>
            <div className="game-board">
                {renderBoard()}
            </div>
            <p className="mt-4">Use Arrow Keys to Move</p>
        </div>
    );
};

export default GameScreen;
