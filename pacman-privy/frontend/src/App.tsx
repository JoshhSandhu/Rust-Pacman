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
      appId="cmf8pgmr9003vl40b7lh75w2s"
      config={{
        loginMethods: ['email', 'google', 'wallet'],
        appearance: {
          theme: 'dark',
          accentColor: '#676FFF',
        },
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
        },
        externalWallets: {
          solana: {
            connectors: toSolanaWalletConnectors(),
          },
        },
        // supportedChains: [
        //   {
        //     id: -1,
        //     name: 'Solana Devnet',
        //     nativeCurrency: { name: 'Solana', symbol: 'SOL', decimals: 9 },
        //     rpcUrls: { default: { http: ['https://api.devnet.solana.com'] } },
        //     testnet: true,
        //   },
        // ],
        solanaClusters: [{name: 'devnet', rpcUrl: 'https://api.mainnet-beta.solana.com'}]
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