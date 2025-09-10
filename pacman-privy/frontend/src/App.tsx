import React from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';
import HomeScreen from './pages/HomeScreen';
import GameScreen from './pages/GameScreen';
import RoleSelector from './components/RouteSelector';
import '@solana/wallet-adapter-react-ui/styles.css';

const App = () => {
  const privyAppId = "cmf8pgmr9003vl40b7lh75w2s";

  const solanaLocalnet = {
    id: 8899,
    name: 'Solana Localnet',
    nativeCurrency: { name: 'Solana', symbol: 'SOL', decimals: 9 },
    rpcUrls: { default: { http: ['http://127.0.0.1:8899'] } },
    testnet: true,
  };


  return (
    <PrivyProvider
      appId={privyAppId}
      config={{
        loginMethods: ['email', 'google', 'wallet'],
        appearance: {
          theme: 'dark',
          accentColor: '#676FFF',
          walletChainType: 'solana-only', // OK if only Solana support intended
        },
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
        },
        externalWallets: {
          solana: {
            connectors: toSolanaWalletConnectors(),
          },
        },
        supportedChains: [solanaLocalnet],
        defaultChain: solanaLocalnet,
      }}
    >
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/role-selector" element={<RoleSelector />} />
          <Route path="/game" element={<GameScreen />} />
          <Route path="*" element={<div>Page Not Found</div>} />
        </Routes>
      </BrowserRouter>
    </PrivyProvider>
  );
};

export default App;
