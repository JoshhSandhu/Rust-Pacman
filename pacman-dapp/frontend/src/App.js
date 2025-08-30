import './App.css';
import { Connection, PublicKey } from '@solana/web3.js';
import { Program, AnchorProvider, web3 } from '@coral-xyz/anchor';
import { useEffect, useState } from 'react';

import idl from './pacman_game.json';
import { publicKey } from '@coral-xyz/anchor/dist/cjs/utils';

const { SystemProgram, Keypair } = web3;

//key pair for the game account
const gameKeypair = Keypair.generate();

//getting the public key from the IDL file
const ProgramID = new publicKey(idl.metadata.address);

//setting the network to the local network 
const network = "http://127.0.0.1:8899";

//transaction is done or nah ?
const opts = {
  preflightCommitment: "processed"
}

const App = () => {
  const [walletAddress, setWalletAddress] = useState(null);

  const WalletConnectedOrNah = async () => {
    try {
      const { solana } = window ;
      if ( solana && solana.isPhantom ){
        console.log("the wallet is connected");
        const response = await solana.connect({onlyIfTrusted: true });
        console.log("connected with a damn public key yo");
        setWalletAddress(response.publicKey.toString()); 
      } else{
        alert("get a wallet u fool");
      }
    } catch (err) {
        console.log(err);
    }
  };

  const connectWallet = async () => {
    const {solana} =window;

    if (solana){
      const response = await solana.connect();
      console.log("the public key is: ", response.publicKey.toString());
      setWalletAddress(response.publicKey.toString());
    }
  };

  const renderNotConnectedContainer = () => (
    <button
      className="cta-button connect-wallet-button"
      onClick={connectWallet}
    >
      Connect to Wallet
    </button>
  );
  useEffect(() => {
    const onLoad = async () => {
      await WalletConnectedOrNah();
    };
    window.addEventListener('load', onLoad);
    return () => window.removeEventListener('load', onLoad);
  }, []);

  return (
    <div className="App">
      <div className="container">
        <div className="header-container">
          <p className="header">🏃‍♂️ Solana Pac-Man 🏃‍♂️</p>
          <p className="sub-text">The on-chain Pac-Man experience</p>
          {/* Add the render method here */}
          {!walletAddress && renderNotConnectedContainer()}
        </div>
      </div>
    </div>
  );
};

export default App;