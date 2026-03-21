import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SendOptions,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { assert } from "chai";
import {
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { PacRoyale } from "../target/types/pac_royale";

const BPF_UPGRADEABLE_LOADER_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
const DELEGATION_PROGRAM_ID = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
);
const ER_RPC_ENDPOINT = "https://devnet-as.magicblock.app/";
const ER_WSS_ENDPOINT = "wss://devnet-as.magicblock.app/";

class KeypairWallet implements anchor.Wallet {
  readonly payer: Keypair;

  constructor(payer: Keypair) {
    this.payer = payer;
  }

  get publicKey(): PublicKey {
    return this.payer.publicKey;
  }

  async signTransaction<T extends Transaction>(tx: T): Promise<T> {
    tx.partialSign(this.payer);
    return tx;
  }

  async signAllTransactions<T extends Transaction>(txs: T[]): Promise<T[]> {
    return txs.map((tx) => {
      tx.partialSign(this.payer);
      return tx;
    });
  }
}

async function sendProgramMethod(
  program: Program<PacRoyale>,
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
  return signature;
}

describe("pac-royale demo smoke", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.PacRoyale as Program<PacRoyale>;
  const operator = provider.wallet.publicKey;
  const smokePlayer = Keypair.generate();
  const smokeWallet = new KeypairWallet(smokePlayer);
  const l1SmokeProvider = new anchor.AnchorProvider(
    provider.connection,
    smokeWallet,
    provider.opts,
  );
  const l1SmokeProgram = new Program<PacRoyale>(
    program.idl as PacRoyale,
    l1SmokeProvider,
  );
  const erConnection = new Connection(ER_RPC_ENDPOINT, {
    commitment: "processed",
    wsEndpoint: ER_WSS_ENDPOINT,
  });
  const erProvider = new anchor.AnchorProvider(erConnection, smokeWallet, {
    commitment: "processed",
    skipPreflight: true,
  });
  const erProgram = new Program<PacRoyale>(
    program.idl as PacRoyale,
    erProvider,
  );
  const authority = smokeWallet.publicKey;

  const [worldPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("world")],
    program.programId,
  );
  const [anteroomPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("anteroom"), worldPda.toBuffer()],
    program.programId,
  );
  const [playerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("player"), worldPda.toBuffer(), authority.toBuffer()],
    program.programId,
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), worldPda.toBuffer()],
    program.programId,
  );
  const [programDataPda] = PublicKey.findProgramAddressSync(
    [program.programId.toBuffer()],
    BPF_UPGRADEABLE_LOADER_ID,
  );

  before(async function () {
    this.timeout(120_000);
    const balance = await provider.connection.getBalance(authority);
    if (balance >= anchor.web3.LAMPORTS_PER_SOL / 20) {
      return;
    }

    try {
      const sig = await provider.connection.requestAirdrop(
        authority,
        anchor.web3.LAMPORTS_PER_SOL,
      );
      await provider.connection.confirmTransaction(sig, "confirmed");
    } catch {
      const transferTx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: operator,
          toPubkey: authority,
          lamports: anchor.web3.LAMPORTS_PER_SOL / 10,
        }),
      );
      await provider.sendAndConfirm(transferTx, []);
    }
  });

  it("validates world init and basic player tx path", async function () {
    this.timeout(120_000);

    const worldInfo = await provider.connection.getAccountInfo(worldPda);
    const worldDelegated = !!worldInfo?.owner.equals(DELEGATION_PROGRAM_ID);
    const [chunk0Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("chunk"), worldPda.toBuffer(), Buffer.from([0])],
      program.programId,
    );
    const chunk0Info = await provider.connection.getAccountInfo(chunk0Pda);
    const chunksDelegated = !!chunk0Info?.owner.equals(DELEGATION_PROGRAM_ID);
    const setupProgram = worldDelegated ? erProgram : l1SmokeProgram;
    const runtimeProgram = chunksDelegated ? erProgram : setupProgram;
    const stateConnection = runtimeProgram.provider.connection;

    let world: any;
    try {
      world = await setupProgram.account.world.fetch(worldPda);
    } catch {
      if (worldDelegated) {
        throw new Error(
          "Delegated devnet world should be fetched through ER but was unavailable",
        );
      }
      const worldName = Buffer.from("Pac-Royale Arena");
      await program.methods
        .initWorld(worldName)
        .accountsStrict({
          world: worldPda,
          anteroom: anteroomPda,
          vault: vaultPda,
          authority: operator,
          program: program.programId,
          programData: programDataPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      for (let i = 0; i < 32; i++) {
        const [chunkPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("chunk"), worldPda.toBuffer(), Buffer.from([i])],
          program.programId,
        );
        await program.methods
          .initChunk(i, i % 10)
          .accountsStrict({
            world: worldPda,
            chunk: chunkPda,
            authority: operator,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      }

      for (let i = 0; i < 4; i++) {
        const [ghostPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("ghost"), worldPda.toBuffer(), Buffer.from([i])],
          program.programId,
        );
        await program.methods
          .initGhost(i)
          .accountsStrict({
            world: worldPda,
            ghost: ghostPda,
            authority: operator,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      }

      world = await program.account.world.fetch(worldPda);
    }
    assert.ok(world.authority);

    const anteroom = await program.account.anteroom.fetch(anteroomPda);
    assert.ok(anteroom.vault);

    for (let i = 0; i < 4; i++) {
      const [ghostPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("ghost"), worldPda.toBuffer(), Buffer.from([i])],
        program.programId,
      );
      const ghost = await runtimeProgram.account.ghost.fetch(ghostPda);
      assert.equal(ghost.ghostId, i);
    }

    let player: any;
    try {
      player = await setupProgram.account.player.fetch(playerPda);
    } catch {
      await sendProgramMethod(setupProgram, () =>
        setupProgram.methods.spawnPlayer().accountsStrict({
          world: worldPda,
          player: playerPda,
          authority,
          systemProgram: SystemProgram.programId,
        }),
      );
      player = await setupProgram.account.player.fetch(playerPda);
    }

    const activeUpper = world.scrollOffset + 32;
    const needsRespawn =
      player.dead ||
      player.chunkIndex < world.scrollOffset ||
      player.chunkIndex >= activeUpper;

    if (needsRespawn) {
      await sendProgramMethod(setupProgram, () =>
        setupProgram.methods.respawnPlayer().accountsStrict({
          world: worldPda,
          player: playerPda,
          authority,
        }),
      );
      player = await setupProgram.account.player.fetch(playerPda);
    }

    if (chunksDelegated) {
      const playerInfo = await provider.connection.getAccountInfo(playerPda);
      const playerDelegated = !!playerInfo?.owner.equals(DELEGATION_PROGRAM_ID);
      if (!playerDelegated) {
        await sendProgramMethod(l1SmokeProgram, () =>
          l1SmokeProgram.methods.delegatePlayer().accountsStrict({
            world: worldPda,
            player: playerPda,
            authority,
            buffer: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
              playerPda,
              program.programId,
            ),
            delegationRecord: delegationRecordPdaFromDelegatedAccount(playerPda),
            delegationMetadata: delegationMetadataPdaFromDelegatedAccount(
              playerPda,
            ),
            delegationProgram: DELEGATION_PROGRAM_ID,
            program: program.programId,
            systemProgram: SystemProgram.programId,
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }

    const currentSlot = await stateConnection.getSlot();
    while ((await stateConnection.getSlot()) <= currentSlot) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    let chunkPda: PublicKey | null = null;
    for (let i = 0; i < 32; i++) {
      const [candidatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("chunk"), worldPda.toBuffer(), Buffer.from([i])],
        program.programId,
      );
      const chunk = await runtimeProgram.account.chunk.fetch(candidatePda);
      if (chunk.logicalIndex === player.chunkIndex) {
        chunkPda = candidatePda;
        break;
      }
    }
    if (!chunkPda) {
      const fallbackPhysical =
        (((player.chunkIndex - world.scrollOffset) % 32) + 32) % 32;
      [chunkPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("chunk"),
          worldPda.toBuffer(),
          Buffer.from([fallbackPhysical]),
        ],
        program.programId,
      );
    }

    const [ghost0] = PublicKey.findProgramAddressSync(
      [Buffer.from("ghost"), worldPda.toBuffer(), Buffer.from([0])],
      program.programId,
    );
    const [ghost1] = PublicKey.findProgramAddressSync(
      [Buffer.from("ghost"), worldPda.toBuffer(), Buffer.from([1])],
      program.programId,
    );
    const [ghost2] = PublicKey.findProgramAddressSync(
      [Buffer.from("ghost"), worldPda.toBuffer(), Buffer.from([2])],
      program.programId,
    );
    const [ghost3] = PublicKey.findProgramAddressSync(
      [Buffer.from("ghost"), worldPda.toBuffer(), Buffer.from([3])],
      program.programId,
    );

    try {
      const sig = await sendProgramMethod(runtimeProgram, () =>
        (runtimeProgram.methods as any).movement(3).accounts({
          world: worldPda,
          player: playerPda,
          chunk: chunkPda,
          authority,
          playerAuthority: authority,
          ghost0,
          ghost1,
          ghost2,
          ghost3,
          destinationChunk: null,
        }),
      );
      assert.ok(sig.length > 0);
    } catch (err) {
      const errText = err?.toString?.() ?? String(err);
      const tolerated =
        errText.includes("WrongChunk") ||
        errText.includes("ChunkLogicalMismatch") ||
        errText.includes("PlayerInRemovedChunk");
      assert.ok(tolerated, `Unexpected movement failure: ${errText}`);
    }
  });
});
