import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SendOptions,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";

const idl = require("../target/idl/pac_royale.json");

const PROGRAM_ID = new PublicKey("46gDjnJLeuMqKLJjHow4B4xt6BLspzf7owBydzSvSByH");
const DELEGATION_PROGRAM_ID = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
);
const DEVNET_RPC = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
const ER_RPC = process.env.ER_RPC_URL || "https://devnet-as.magicblock.app/";
const ER_WSS = process.env.ER_WSS_URL || "wss://devnet-as.magicblock.app/";

class KeypairWallet implements anchor.Wallet {
  readonly payer: Keypair;

  constructor(payer: Keypair) {
    this.payer = payer;
  }

  get publicKey(): PublicKey {
    return this.payer.publicKey;
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if (tx instanceof VersionedTransaction) {
      tx.sign([this.payer]);
    } else {
      tx.partialSign(this.payer);
    }
    return tx;
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    return txs.map((tx) => {
      if (tx instanceof VersionedTransaction) {
        tx.sign([this.payer]);
      } else {
        tx.partialSign(this.payer);
      }
      return tx;
    });
  }
}

async function sendProgramMethod(
  program: Program<any>,
  buildMethod: () => any,
): Promise<string> {
  const provider = program.provider as anchor.AnchorProvider;
  const tx = (await buildMethod().transaction()) as Transaction;
  tx.feePayer = tx.feePayer ?? provider.wallet.publicKey;

  const { blockhash, lastValidBlockHeight } =
    await provider.connection.getLatestBlockhash(
      provider.opts.preflightCommitment ?? provider.opts.commitment,
    );
  tx.recentBlockhash = blockhash;

  const signedTx = await provider.wallet.signTransaction(tx);
  const rawTx = signedTx.serialize();
  const sendOptions: SendOptions = {
    skipPreflight: provider.opts.skipPreflight,
    preflightCommitment:
      provider.opts.preflightCommitment ?? provider.opts.commitment,
    maxRetries: provider.opts.maxRetries,
    minContextSlot: provider.opts.minContextSlot,
  };

  const signature = await provider.connection.sendRawTransaction(rawTx, sendOptions);
  await provider.connection.confirmTransaction(
    {
      signature,
      blockhash,
      lastValidBlockHeight,
    },
    provider.opts.commitment,
  );
  const status = await provider.connection.getSignatureStatuses([signature]);
  const err = status.value[0]?.err;
  if (err) {
    throw new Error(`[tx ${signature}] ${JSON.stringify(err)}`);
  }
  return signature;
}

async function main() {
  const operatorProvider = anchor.AnchorProvider.env();
  anchor.setProvider(operatorProvider);

  const operatorProgram = new Program(idl, operatorProvider);
  const smokePlayer = Keypair.generate();
  const smokeWallet = new KeypairWallet(smokePlayer);
  const sessionKeypair = Keypair.generate();
  const sessionWallet = new KeypairWallet(sessionKeypair);

  const l1Conn = new Connection(DEVNET_RPC, "confirmed");
  const erConn = new Connection(ER_RPC, {
    commitment: "processed",
    wsEndpoint: ER_WSS,
  });

  const l1PlayerProvider = new anchor.AnchorProvider(l1Conn, smokeWallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const erSessionProvider = new anchor.AnchorProvider(erConn, sessionWallet, {
    commitment: "processed",
    skipPreflight: true,
  });

  const l1PlayerProgram = new Program(idl, l1PlayerProvider);
  const erSessionProgram = new Program(idl, erSessionProvider);

  const [worldPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("world")],
    PROGRAM_ID,
  );
  const [playerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("player"), worldPda.toBuffer(), smokePlayer.publicKey.toBuffer()],
    PROGRAM_ID,
  );
  const [chunkPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("chunk"), worldPda.toBuffer(), Buffer.from([16])],
    PROGRAM_ID,
  );
  const ghostPdas = [0, 1, 2, 3].map((ghostId) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("ghost"), worldPda.toBuffer(), Buffer.from([ghostId])],
      PROGRAM_ID,
    )[0],
  );

  const balance = await l1Conn.getBalance(smokePlayer.publicKey);
  if (balance < anchor.web3.LAMPORTS_PER_SOL / 20) {
    const transferTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: operatorProvider.wallet.publicKey,
        toPubkey: smokePlayer.publicKey,
        lamports: anchor.web3.LAMPORTS_PER_SOL / 10,
      }),
    );
    await operatorProvider.sendAndConfirm(transferTx, []);
  }

  try {
    await l1PlayerProgram.account.player.fetch(playerPda);
  } catch {
    await sendProgramMethod(l1PlayerProgram, () =>
      l1PlayerProgram.methods.spawnPlayer().accountsStrict({
        world: worldPda,
        player: playerPda,
        authority: smokePlayer.publicKey,
        systemProgram: SystemProgram.programId,
      }),
    );
  }

  await sendProgramMethod(l1PlayerProgram, () =>
    l1PlayerProgram.methods.setSessionKey(sessionKeypair.publicKey).accountsStrict({
      world: worldPda,
      player: playerPda,
      authority: smokePlayer.publicKey,
    }),
  );

  await sendProgramMethod(l1PlayerProgram, () =>
    l1PlayerProgram.methods.delegatePlayer().accountsStrict({
      world: worldPda,
      player: playerPda,
      authority: smokePlayer.publicKey,
      buffer: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
        playerPda,
        PROGRAM_ID,
      ),
      delegationRecord: delegationRecordPdaFromDelegatedAccount(playerPda),
      delegationMetadata: delegationMetadataPdaFromDelegatedAccount(playerPda),
      delegationProgram: DELEGATION_PROGRAM_ID,
      program: PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    }),
  ).catch(() => {});

  await new Promise((resolve) => setTimeout(resolve, 3000));

  const before = await erSessionProgram.account.player.fetch(playerPda);
  console.log("[session-smoke] before:", {
    chunkIndex: before.chunkIndex,
    rowInChunk: before.rowInChunk,
    col: before.col,
    dead: before.dead,
    balanceLamports: before.balanceLamports?.toString?.() ?? before.balanceLamports,
    authority: before.authority?.toBase58?.() ?? before.authority,
    sessionKey: before.sessionKey?.toBase58?.() ?? before.sessionKey,
  });

  const ghostsBefore = await Promise.all(
    ghostPdas.map((ghostPda) => erSessionProgram.account.ghost.fetch(ghostPda)),
  );
  const chunkBefore = await erSessionProgram.account.chunk.fetch(chunkPda);
  console.log(
    "[session-smoke] ghosts before:",
    ghostsBefore.map((ghost: any) => ({
      ghostId: ghost.ghostId,
      chunkIndex: ghost.chunkIndex,
      row: ghost.row,
      col: ghost.col,
    })),
  );
  console.log("[session-smoke] row before:", chunkBefore.grid[before.rowInChunk]);

  const currentSlot = await erConn.getSlot("processed");
  while ((await erConn.getSlot("processed")) <= currentSlot) {
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  await sendProgramMethod(erSessionProgram, () =>
    erSessionProgram.methods.movement(3).accounts({
      world: worldPda,
      player: playerPda,
      chunk: chunkPda,
      destinationChunk: chunkPda,
      authority: sessionKeypair.publicKey,
      playerAuthority: smokePlayer.publicKey,
      ghost0: ghostPdas[0],
      ghost1: ghostPdas[1],
      ghost2: ghostPdas[2],
      ghost3: ghostPdas[3],
    }),
  );

  await new Promise((resolve) => setTimeout(resolve, 1000));

  const after = await erSessionProgram.account.player.fetch(playerPda);
  console.log("[session-smoke] after:", {
    chunkIndex: after.chunkIndex,
    rowInChunk: after.rowInChunk,
    col: after.col,
    dead: after.dead,
    balanceLamports: after.balanceLamports?.toString?.() ?? after.balanceLamports,
    authority: after.authority?.toBase58?.() ?? after.authority,
    sessionKey: after.sessionKey?.toBase58?.() ?? after.sessionKey,
  });
}

main().catch((err) => {
  console.error("[session-smoke] failed:", err);
  process.exit(1);
});
