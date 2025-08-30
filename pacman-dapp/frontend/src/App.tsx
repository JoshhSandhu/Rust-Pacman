import { useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
//import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';

// This importing the CSS for the button
import '@solana/wallet-adapter-react-ui/styles.css';

const App = () => {
    // const network = WalletAdapterNetwork.Devnet; 
    // const endpoint = useMemo(() => "https://api.devnet.solana.com", [network]);
    const endpoint = "http://127.0.0.1:8899";

    // We tell the app which wallets we want to support. For now, just Phantom.
    const wallets = useMemo(
        () => [ new PhantomWalletAdapter() ],
        [] //network here
    );

// Now we wrap our app with the Providers and add the button.
    return (
        <ConnectionProvider endpoint={endpoint}>
            <WalletProvider wallets={wallets} autoConnect>
                <WalletModalProvider>
                    {/* All your app's components will go inside here */}
                    <div className="container">
                        <h1>Connect Your Wallet</h1>
                        <p>This is the first step.</p>
                        
                        {/* This button from the library does all the work for us! */}
                        <WalletMultiButton />
                    </div>
                </WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    );
};

export default App;