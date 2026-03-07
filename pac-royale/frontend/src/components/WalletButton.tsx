import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

export default function WalletButton() {
  return (
    <div className="absolute top-3 right-4 z-30">
      <WalletMultiButton />
    </div>
  );
}
