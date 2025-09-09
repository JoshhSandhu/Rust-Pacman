import { useMemo } from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
//import { ConnectionProvider, WalletProvider, useWallet } from '@solana/wallet-adapter-react';
//import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
//import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import HomeScreen from './pages/HomeScreen'; // Import our game component
import GameScreen from './pages/GameScreen';
import RoleSelector from './components/RouteSelector';
import '@solana/wallet-adapter-react-ui/styles.css';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";

// This is the main component that sets up the wallet providers
const App = () => {
    //const endpoint = "http://127.0.0.1:8899";
    //const wallets = useMemo(() => [new PhantomWalletAdapter()], []);
    const privyAppId = "cmf8pgmr9003vl40b7lh75w2s";

    // const handleLogin = (user) => {
    // console.log(`User ${user.id} logged in!`);
    // };

    return (
        <PrivyProvider appId={privyAppId}
      config={{
        // --- General Settings ---
        loginMethods: ['email', 'google', 'wallet'],
        appearance: {
          theme: 'dark',
          accentColor: '#676FFF',
          walletChainType: 'ethereum-and-solana', // It's best to be specific to Solana
        },

        // --- Embedded Wallet Settings ---
        // This creates a wallet for new users who log in with email/social
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
        },

        // --- External Wallet Settings (from your snippet) ---
        // This allows users to connect existing wallets like Phantom
        externalWallets: {
          solana: {
            connectors: toSolanaWalletConnectors(),
          },
        },

        // --- Default Chain & RPC Settings ---
        // This tells Privy which chain to use and where your localnet is.
        // NOTE: You may need to get the exact chain ID from Privy's docs for custom networks.
        defaultChain: {id: 'solana:1399811149', name: 'Solana Localnet', rpcUrl: 'http://127.0.0.1:8899'},
      }}
              >
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<HomeScreen />} />
              <Route path="/role-selector" element={<RoleSelector />} />
              <Route path="/GameScreen" element={<GameScreen />} />
              <Route path="*" element={<div>Page Not Found</div>} />
            </Routes>
          </BrowserRouter>
        </PrivyProvider>
    );
};

export default App;