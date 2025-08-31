import { useMemo } from 'react';
import { ConnectionProvider, WalletProvider, useWallet } from '@solana/wallet-adapter-react';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
//import GameScreen from './GameScreen'; // Import our game component

import '@solana/wallet-adapter-react-ui/styles.css';

// This small component decides whether to show the game or a connect message
const WalletChecker = () => {
    const { publicKey } = useWallet();
    return publicKey ? <p>the game!</p> : <p>Connect your wallet to start the game!</p>;
}

// This is the main component that sets up the wallet providers
const App = () => {
    const endpoint = "http://127.0.0.1:8899";
    const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

    return (
        <ConnectionProvider endpoint={endpoint}>
            <WalletProvider wallets={wallets}>
                <WalletModalProvider>
                    <div className="container">
                        <h1>Solana Pac-Man</h1>
                        <WalletMultiButton />
                        <WalletChecker />
                    </div>
                </WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    );
};

export default App;