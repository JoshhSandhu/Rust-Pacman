import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  usePrivy,
  useLinkAccount,
  useSolanaWallets,
  useConnectWallet,
} from '@privy-io/react-auth';

export default function HomeScreen() {
  const navigate = useNavigate();
  const { login, authenticated, ready } = usePrivy();
  const { connectWallet } = useConnectWallet();
  const { wallets, ready: solanaReady } = useSolanaWallets();

  const { linkWallet } = useLinkAccount();

  // Always call hooks in the same order
  useEffect(() => {
    if (!ready || !solanaReady) return;
    // If user is logged in and a Solana wallet is connected
    if (authenticated && wallets.length > 0) {
      const wallet = wallets[0];
      wallet.loginOrLink();
      navigate('/role-selector');
    }
  }, [ready, solanaReady, authenticated, wallets.length, wallets, navigate]);

  if (!ready || !solanaReady) {
    return <div>Loading…</div>;
  }

  const handleButtonClick = () => {
    if (authenticated) {
      // If already authenticated, prompt to connect a new wallet
      connectWallet();
    } else {
      login();
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        gap: '20px',
      }}
    >
      <h2>Welcome to Solana Pacman!</h2>
      <p>Log in to start playing</p>
      <button
        className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        onClick={handleButtonClick}
      >
        {authenticated ? 'Connect Wallet' : 'Login / Sign Up'}
      </button>
    </div>
  );
}
