import { useEffect, useState } from 'react';
import { data, useSearchParams } from 'react-router-dom';
import { useWallets } from '@privy-io/react-auth';
import { Program, AnchorProvider, type IdlAccounts } from '@coral-xyz/anchor';
import { PublicKey, Connection } from '@solana/web3.js';

import { IDL, type PacmanGame } from '../anchor/idl';

type GameData = IdlAccounts<PacmanGame>['gameData']; //helper type to extract the gameData account type from the IDL


const Direction = {
    Up: 0,
    Down: 1,
    Left: 2,
    Right: 3,
};

const GameScreen = () => {
    const { wallets } = useWallets();
    const [searchParams] = useSearchParams();

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
        
        const solanaWallet = wallets.find((wallet) => wallet.connectorType === 'embedded');
        if (!solanaWallet) {
            alert("Solana wallet not found. Please ensure you are logged in.");
            return;
        }

        const setupListener = async () => {
            const connection = new Connection("http://127.0.0.1.8899", "confirmed"); //seting up the connection the anchor provider inside the function

            const provider = await solanaWallet.getAnchorProvider(); //getting the provider directly from the privy wallet

            const program = new Program<PacmanGame>(IDL, provider); //setting up the program inside the function
            
            console.log("2. Setting up listener for game:", gameId.toBase58());

            setGameData(data as GameData); //set the initial state

            const listener = program.account.gameData.subscribe(gameId, 'confirmed');
            listener.on('change', (data) => {
                console.log("Game data updated at slot", data);
                setGameData(data as GameData);
            });

            return () => {
                program.account.gameData.unsubscribe(listener);
                console.log("Unsubscribed from game data updates for game:", gameId.toBase58());
            }

            const cleanupPromise = setupListener();

            return () => {
                cleanupPromise.then((cleanup) => cleanup && cleanup());
            }

        }
    },[gameId, wallets]);

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
    }, [wallets, gameId]); // We depend on gameId and publicKey to send the transaction



    // The updated movement function
    const movePlayer = async (direction: number) => {
        const solanaWallet = wallets.find((wallet) => wallet.connectorType === 'embedded');
        if (!solanaWallet) {
            alert("Solana wallet not found. Please ensure you are logged in.");
            return;
        }
        if (!gameId) return;

        try {
            const connection = new Connection("http://127.0.0.1:8899", "confirmed");
            const provider = await solanaWallet.getAnchorProvider();
            const program = new Program<PacmanGame>(IDL, provider);
            
            await program.methods
                .playerMnt(direction)
                .accounts({ game: gameId, user: solanaWallet.address })
                .rpc({ commitment: "confirmed" });
            
            console.log("Move transaction successful!");
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
