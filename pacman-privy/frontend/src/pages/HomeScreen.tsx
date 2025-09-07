import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePrivy } from '@privy-io/react-auth';

export default function HomeScreen() {
    const navigate = useNavigate();
    const { login, authenticated } = usePrivy();
    
    useEffect(() => {
        if (authenticated) {
            navigate('/role-selector'); // Navigate to the game screen when connected
        }
    }, [authenticated, navigate]);

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            gap: '20px'
        }}>
            <h2>Welcome to Solana Pacman!</h2>
            <p>Log in to start playing</p>
            {/* 3. This button now triggers Privy's beautiful login modal */}
            <button
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                onClick={login}
            >
        Login / Sign Up
      </button>
    </div>
    );
}