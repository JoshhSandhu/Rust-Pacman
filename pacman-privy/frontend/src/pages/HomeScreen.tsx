import { useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { usePrivy, useLinkAccount, useSolanaWallets } from '@privy-io/react-auth';

export default function HomeScreen() {
  const navigate = useNavigate();
  const { login, authenticated, ready } = usePrivy();
  const { wallets, ready: solanaReady } = useSolanaWallets();
  const { linkWallet } = useLinkAccount();

  useEffect(() => {
    if (!ready || !solanaReady) return;
    // Auto-navigate to role-selector if authenticated and wallet is connected
    if (authenticated && wallets && wallets.length > 0) {
      console.log('Navigating to role-selector, wallets:', wallets);
      navigate('/role-selector');
    }
  }, [ready, solanaReady, authenticated, wallets?.length, navigate]);

  if (!ready || !solanaReady) {
    return <div>Loading…</div>;
  }

  const handleButtonClick = async () => {
    try {
      if (authenticated) {
        console.log('Linking Solana wallet...');
        await linkWallet(); // Prompt to link a Solana wallet
      } else {
        console.log('Initiating login...');
        await login(); // Prompt login
      }
    } catch (error) {
      console.error('Error during login/link:', error);
      alert(`Failed to ${authenticated ? 'link wallet' : 'log in'}: ${error.message}`);
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
      {authenticated && wallets.length > 0 ? (
        <Link
          to="/role-selector"
          style={{
            padding: '12px 24px',
            backgroundColor: '#2563eb',
            color: 'white',
            borderRadius: '8px',
            textDecoration: 'none',
            fontSize: '16px',
          }}
        >
          Start Playing
        </Link>
      ) : (
        <button
          style={{
            padding: '12px 24px',
            backgroundColor: '#2563eb',
            color: 'white',
            borderRadius: '8px',
            border: 'none',
            cursor: 'pointer',
            fontSize: '16px',
          }}
          onClick={handleButtonClick}
          aria-label={authenticated ? 'Connect a Solana wallet' : 'Log in or sign up'}
        >
          {authenticated ? 'Connect Wallet' : 'Login / Sign Up'}
        </button>
      )}
    </div>
  );
}