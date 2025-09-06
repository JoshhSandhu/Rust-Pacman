import { useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useNavigate } from 'react-router-dom';

export default function HomeScreen() {
    const { connected } = useWallet();
    const navigate = useNavigate();
    
    useEffect(() => {
        if (connected) {
            navigate('/role-selector'); // Navigate to the game screen when connected
        }
    }, [connected, navigate]);

    return (
        <div>
            <h2>Welcome to Solana</h2>
            <p>Please connect your wallet to start playing</p>
            <WalletMultiButton />
        </div>
    );
}