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

const solanaLocalnet = {
  id: 8899,
  name: 'Solana Localnet',
  nativeCurrency: {
    name: 'Solana',
    symbol: 'SOL',
    decimals: 9,
  },
  rpcUrls: {
    default: {
      http: ['http://127.0.0.1:8899'],
    },
  },
  testnet: true,
};

// This is the main component that sets up the wallet providers
const App = () => {
    const privyAppId = "cmf8pgmr9003vl40b7lh75w2s";
    return (
        <PrivyProvider
              appId={privyAppId}
              config={{
                loginMethods: ['email', 'google', 'wallet'],
                appearance: {
                  theme: 'dark',
                  accentColor: '#676FFF',
                  walletChainType: 'solana-only',
                },
                embeddedWallets: { createOnLogin: 'users-without-wallets' },
                externalWallets: { solana: { connectors: toSolanaWalletConnectors() } },
                supportedChains: [solanaLocalnet],
                defaultChain: solanaLocalnet,
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