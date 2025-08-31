import { useMemo } from 'react';
import { ConnectionProvider, WalletProvider, useWallet } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import HomeScreen from './pages/HomeScreen'; // Import our game component
import GameScreen from './pages/GameScreen';
import RoleSelector from './components/RouteSelector';

import '@solana/wallet-adapter-react-ui/styles.css';
import { BrowserRouter, Route, Routes } from 'react-router-dom';

// This is the main component that sets up the wallet providers
const App = () => {
    const endpoint = "http://127.0.0.1:8899";
    const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

    return (
        <ConnectionProvider endpoint={endpoint}>
            <WalletProvider wallets={wallets}>
                <WalletModalProvider>
                  <BrowserRouter>
                    <Routes>
                      <Route path="/" element={<HomeScreen />} />
                      <Route path="/role-selector" element={<RoleSelector />} />
                      <Route path="/GameScreen" element={<GameScreen />} />
                      <Route path="*" element={<div>Page Not Found</div>} />
                    </Routes>
                  </BrowserRouter>
                </WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    );
};

export default App;