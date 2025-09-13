import React from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';
import { WalletProvider } from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import { usePrivy } from '@privy-io/react-auth';
import HomeScreen from './pages/HomeScreen';
import GameScreen from './pages/GameScreen';
import RoleSelector from './components/RouteSelector';
import '@solana/wallet-adapter-react-ui/styles.css';

// const TestComponent = () => {
//   const { login, authenticated, ready } = usePrivy();
//   if (!ready) return <div>Loading...</div>;
//   return (
//     <div>
//       <button onClick={login}>Test Login</button>
//       <p>Authenticated: {authenticated.toString()}</p>
//     </div>
//   );
// };

const wallets = [new PhantomWalletAdapter()];

const App = () => (
  <WalletProvider wallets={wallets} autoConnect>
    <PrivyProvider
      appId="cmfihhg2f0009l10blbgk5yd3"
      clientId='client-WY6QhsETC3Lj12ZPct7r5QYRt7hT4TYMC1KWDgZsTXpSc'
      config={{
        loginMethods: ['wallet', 'email', 'google'],
        appearance: {
          theme: 'dark',
          accentColor: '#676FFF',
        },
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
          noPromptOnSignature: true,
        },
        mfa: {
          noPromptOnMfaRequired: false,
        },
        externalWallets: {
          solana: {
            connectors: toSolanaWalletConnectors(),
          },
        },
        // Remove supportedChains for Solana to avoid Coinbase Smart Wallet conflicts
        // Solana is handled separately through solanaClusters
        solanaClusters: [{name: 'devnet', rpcUrl: 'https://api.devnet.solana.com'}]
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
  </WalletProvider>
);

export default App;