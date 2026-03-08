import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PacRoyale } from "../target/types/pac_royale";
import { PublicKey, SystemProgram, Connection } from "@solana/web3.js";

export interface WorldAccount {
  authority: PublicKey;
  name: number[];
  chunkCount: number;
  scrollOffset: number;
  nextScrollSlot: BN;
  totalPlayers: number;
  frozen: boolean;
  chaseTarget: PublicKey | null;
  bump: number;
}

export interface PlayerAccount {
  authority: PublicKey | null;
  world: PublicKey;
  payoutWallet: PublicKey;
  chunkIndex: number;
  rowInChunk: number;
  col: number;
  direction: number;
  balanceLamports: BN;
  powerPelletUntilSlot: BN;
  lastMoveSlot: BN;
  bump: number;
  dead: boolean;
}

export interface ChunkAccount {
  world: PublicKey;
  physicalIndex: number;
  logicalIndex: number;
  templateId: number;
  grid: number[][];
}

export interface GhostAccount {
  world: PublicKey;
  ghostId: number;
  chunkIndex: number;
  row: number;
  col: number;
  state: number;
  direction: number;
  bump: number;
}

export interface AnteroomAccount {
  world: PublicKey;
  authority: PublicKey;
  vault: PublicKey;
  bump: number;
}

export interface ProgramAccountResult<T> {
  publicKey: PublicKey;
  account: T;
}

/**
 * PacRoyaleClient - TypeScript SDK for interacting with the Pac-Royale program
 */
export class PacRoyaleClient {
  constructor(
    public program: Program<PacRoyale>,
    public connection: Connection
  ) {}

  private normalizeModulo(value: number, modulus: number): number {
    return ((value % modulus) + modulus) % modulus;
  }

  /**
   * Derive World PDA
   */
  getWorldPda(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("world")],
      this.program.programId
    );
  }

  /**
   * Derive Anteroom PDA
   */
  getAnteroomPda(worldPda: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("anteroom"), worldPda.toBuffer()],
      this.program.programId
    );
  }

  /**
   * Derive Player PDA
   */
  getPlayerPda(worldPda: PublicKey, authority: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("player"), worldPda.toBuffer(), authority.toBuffer()],
      this.program.programId
    );
  }

  /**
   * Derive Chunk PDA
   */
  getChunkPda(worldPda: PublicKey, physicalIndex: number): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("chunk"), worldPda.toBuffer(), Buffer.from([physicalIndex])],
      this.program.programId
    );
  }

  /**
   * Derive Ghost PDA
   */
  getGhostPda(worldPda: PublicKey, ghostId: number): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("ghost"), worldPda.toBuffer(), Buffer.from([ghostId])],
      this.program.programId
    );
  }

  /**
   * Initialize the world
   */
  async initWorld(
    authority: PublicKey,
    vaultPubkey: PublicKey,
    worldName: string
  ): Promise<string> {
    const [worldPda] = this.getWorldPda();
    const [anteroomPda] = this.getAnteroomPda(worldPda);

    const nameBytes = Buffer.alloc(64);
    Buffer.from(worldName).copy(nameBytes, 0, 0, Math.min(worldName.length, 64));

    return await this.program.methods
      .initWorld(nameBytes as any)
      .accounts({
        world: worldPda,
        anteroom: anteroomPda,
        vault: vaultPubkey,
        authority,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /**
   * Initialize a chunk
   */
  async initChunk(
    authority: PublicKey,
    physicalIndex: number,
    templateId: number
  ): Promise<string> {
    const [worldPda] = this.getWorldPda();
    const [chunkPda] = this.getChunkPda(worldPda, physicalIndex);

    return await this.program.methods
      .initChunk(physicalIndex, templateId)
      .accounts({
        world: worldPda,
        chunk: chunkPda,
        authority,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /**
   * Initialize all chunks (0-31)
   */
  async initAllChunks(authority: PublicKey): Promise<string[]> {
    const signatures: string[] = [];
    const numChunks = 32;
    const numTemplates = CONSTANTS.NUM_CHUNK_TEMPLATES;

    for (let i = 0; i < numChunks; i++) {
      const templateId = i % numTemplates;
      const sig = await this.initChunk(authority, i, templateId);
      signatures.push(sig);
      
      if (i % 8 === 0) {
        console.log(`Initialized chunk ${i}/${numChunks}`);
      }
    }

    return signatures;
  }

  /**
   * Initialize a ghost
   */
  async initGhost(authority: PublicKey, ghostId: number): Promise<string> {
    const [worldPda] = this.getWorldPda();
    const [ghostPda] = this.getGhostPda(worldPda, ghostId);

    return await this.program.methods
      .initGhost(ghostId)
      .accounts({
        world: worldPda,
        ghost: ghostPda,
        authority,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /**
   * Initialize all ghosts (0-3)
   */
  async initAllGhosts(authority: PublicKey): Promise<string[]> {
    const signatures: string[] = [];
    const numGhosts = 4;

    for (let i = 0; i < numGhosts; i++) {
      const sig = await this.initGhost(authority, i);
      signatures.push(sig);
      console.log(`Initialized ghost ${i}`);
    }

    return signatures;
  }

  /**
   * Spawn a player
   */
  async spawnPlayer(authority: PublicKey): Promise<string> {
    const [worldPda] = this.getWorldPda();
    const [playerPda] = this.getPlayerPda(worldPda, authority);

    return await this.program.methods
      .spawnPlayer()
      .accounts({
        world: worldPda,
        player: playerPda,
        authority,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /**
   * Move player
   * @param direction 0=Up, 1=Down, 2=Left, 3=Right
   */
  async movement(
    authority: PublicKey,
    direction: number,
    ghostPdas: PublicKey[] = []
  ): Promise<string> {
    const [worldPda] = this.getWorldPda();
    const [playerPda] = this.getPlayerPda(worldPda, authority);

    // Get player to determine chunk
    const [player, world] = await Promise.all([
      this.program.account.player.fetch(playerPda) as Promise<PlayerAccount>,
      this.program.account.world.fetch(worldPda) as Promise<WorldAccount>,
    ]);

    const physicalIndex = this.normalizeModulo(
      player.chunkIndex - world.scrollOffset,
      CONSTANTS.MAX_CHUNKS
    );
    const [chunkPda] = this.getChunkPda(worldPda, physicalIndex);
    const fallbackGhostPdas = [0, 1, 2, 3].map((ghostId) => this.getGhostPda(worldPda, ghostId)[0]);
    const [ghost0, ghost1, ghost2, ghost3] =
      ghostPdas.length === 4 ? ghostPdas : fallbackGhostPdas;

    return await this.program.methods
      .movement(direction)
      .accounts({
        world: worldPda,
        player: playerPda,
        chunk: chunkPda,
        authority,
        ghost0,
        ghost1,
        ghost2,
        ghost3,
      })
      .rpc();
  }

  /**
   * Eat pellet at current position
   */
  async eatPellet(authority: PublicKey): Promise<string> {
    const [worldPda] = this.getWorldPda();
    const [playerPda] = this.getPlayerPda(worldPda, authority);

    const [player, world] = await Promise.all([
      this.program.account.player.fetch(playerPda) as Promise<PlayerAccount>,
      this.program.account.world.fetch(worldPda) as Promise<WorldAccount>,
    ]);

    const physicalIndex = this.normalizeModulo(
      player.chunkIndex - world.scrollOffset,
      CONSTANTS.MAX_CHUNKS
    );
    const [chunkPda] = this.getChunkPda(worldPda, physicalIndex);

    return await this.program.methods
      .eatPellet()
      .accounts({
        world: worldPda,
        player: playerPda,
        chunk: chunkPda,
        authority,
      })
      .rpc();
  }

  /**
   * Eat another player (when powered)
   */
  async eatPlayer(
    eaterAuthority: PublicKey,
    victimAuthority: PublicKey
  ): Promise<string> {
    const [worldPda] = this.getWorldPda();
    const [eaterPda] = this.getPlayerPda(worldPda, eaterAuthority);
    const [victimPda] = this.getPlayerPda(worldPda, victimAuthority);

    return await this.program.methods
      .eatPlayer()
      .accounts({
        eater: eaterPda,
        victim: victimPda,
        world: worldPda,
        authority: eaterAuthority,
        victimAuthority,
      })
      .rpc();
  }

  /**
   * Eat ghost (when powered)
   */
  async eatGhost(authority: PublicKey, ghostId: number): Promise<string> {
    const [worldPda] = this.getWorldPda();
    const [playerPda] = this.getPlayerPda(worldPda, authority);
    const [ghostPda] = this.getGhostPda(worldPda, ghostId);

    return await this.program.methods
      .eatGhost(ghostId)
      .accounts({
        world: worldPda,
        player: playerPda,
        ghost: ghostPda,
        authority,
      })
      .rpc();
  }

  /**
   * Scroll the map (remove bottom chunk, add top chunk)
   */
  async scrollMap(authority: PublicKey): Promise<string> {
    const [worldPda] = this.getWorldPda();
    const world = await this.program.account.world.fetch(worldPda) as WorldAccount;

    const bottomPhysicalIndex = world.scrollOffset % 32;
    const [chunkPda] = this.getChunkPda(worldPda, bottomPhysicalIndex);

    return await this.program.methods
      .scrollMap()
      .accounts({
        world: worldPda,
        chunk: chunkPda,
        authority,
      })
      .rpc();
  }

  /**
   * Cash out player balance to payout wallet
   */
  async cashOut(
    authority: PublicKey,
    payoutWallet: PublicKey
  ): Promise<string> {
    const [worldPda] = this.getWorldPda();
    const [playerPda] = this.getPlayerPda(worldPda, authority);
    const [anteroomPda] = this.getAnteroomPda(worldPda);

    const anteroom = await this.program.account.anteroom.fetch(anteroomPda);

    return await this.program.methods
      .cashOut()
      .accounts({
        player: playerPda,
        anteroom: anteroomPda,
        world: worldPda,
        vault: anteroom.vault,
        payout: payoutWallet,
        authority,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /**
   * Exit player from the game
   */
  async exitPlayer(authority: PublicKey): Promise<string> {
    const [worldPda] = this.getWorldPda();
    const [playerPda] = this.getPlayerPda(worldPda, authority);

    return await this.program.methods
      .exitPlayer()
      .accounts({
        world: worldPda,
        player: playerPda,
        authority,
      })
      .rpc();
  }

  /**
   * Fetch world account
   */
  async fetchWorld(): Promise<WorldAccount> {
    const [worldPda] = this.getWorldPda();
    return await this.program.account.world.fetch(worldPda) as WorldAccount;
  }

  /**
   * Fetch player account
   */
  async fetchPlayer(authority: PublicKey): Promise<PlayerAccount> {
    const [worldPda] = this.getWorldPda();
    const [playerPda] = this.getPlayerPda(worldPda, authority);
    return await this.program.account.player.fetch(playerPda) as PlayerAccount;
  }

  /**
   * Fetch all players
   */
  async fetchAllPlayers(): Promise<ProgramAccountResult<PlayerAccount>[]> {
    return await this.program.account.player.all() as ProgramAccountResult<PlayerAccount>[];
  }

  /**
   * Fetch chunk account
   */
  async fetchChunk(physicalIndex: number): Promise<ChunkAccount> {
    const [worldPda] = this.getWorldPda();
    const [chunkPda] = this.getChunkPda(worldPda, physicalIndex);
    return await this.program.account.chunk.fetch(chunkPda) as ChunkAccount;
  }

  async fetchChunksByPhysicalIndices(
    physicalIndices: number[]
  ): Promise<Array<{ physicalIndex: number; chunk: ChunkAccount }>> {
    const [worldPda] = this.getWorldPda();
    const chunkPdas = physicalIndices.map((index) => this.getChunkPda(worldPda, index)[0]);
    const accounts = await this.program.account.chunk.fetchMultiple(chunkPdas);

    const results: Array<{ physicalIndex: number; chunk: ChunkAccount }> = [];
    accounts.forEach((account: any, idx: number) => {
      if (!account) return;
      results.push({
        physicalIndex: physicalIndices[idx],
        chunk: account as ChunkAccount,
      });
    });

    return results;
  }

  /**
   * Fetch all chunks
   */
  async fetchAllChunks(): Promise<ChunkAccount[]> {
    const physicalIndices = Array.from(
      { length: CONSTANTS.MAX_CHUNKS },
      (_, i) => i
    );
    const batched = await this.fetchChunksByPhysicalIndices(physicalIndices);
    return batched.map(({ chunk }) => chunk);
  }

  /**
   * Fetch ghost account
   */
  async fetchGhost(ghostId: number): Promise<GhostAccount> {
    const [worldPda] = this.getWorldPda();
    const [ghostPda] = this.getGhostPda(worldPda, ghostId);
    return await this.program.account.ghost.fetch(ghostPda) as GhostAccount;
  }

  async fetchGhostsByIds(
    ghostIds: number[]
  ): Promise<Array<{ ghostId: number; ghost: GhostAccount }>> {
    const [worldPda] = this.getWorldPda();
    const ghostPdas = ghostIds.map((ghostId) => this.getGhostPda(worldPda, ghostId)[0]);
    const accounts = await this.program.account.ghost.fetchMultiple(ghostPdas);

    const results: Array<{ ghostId: number; ghost: GhostAccount }> = [];
    accounts.forEach((account: any, idx: number) => {
      if (!account) return;
      results.push({
        ghostId: ghostIds[idx],
        ghost: account as GhostAccount,
      });
    });
    return results;
  }

  /**
   * Fetch all ghosts
   */
  async fetchAllGhosts(): Promise<GhostAccount[]> {
    const ghostIds = Array.from({ length: CONSTANTS.NUM_GHOSTS }, (_, i) => i);
    const batched = await this.fetchGhostsByIds(ghostIds);
    return batched.map(({ ghost }) => ghost);
  }

  /**
   * Subscribe to player account changes
   */
  subscribeToPlayer(
    authority: PublicKey,
    callback: (player: PlayerAccount) => void
  ): number {
    const [worldPda] = this.getWorldPda();
    const [playerPda] = this.getPlayerPda(worldPda, authority);

    return this.connection.onAccountChange(
      playerPda,
      (accountInfo) => {
        const player = this.program.coder.accounts.decode(
          "player",
          accountInfo.data
        ) as PlayerAccount;
        callback(player);
      },
      "confirmed"
    );
  }

  /**
   * Subscribe to world account changes
   */
  subscribeToWorld(callback: (world: WorldAccount) => void): number {
    const [worldPda] = this.getWorldPda();

    return this.connection.onAccountChange(
      worldPda,
      (accountInfo) => {
        const world = this.program.coder.accounts.decode(
          "world",
          accountInfo.data
        ) as WorldAccount;
        callback(world);
      },
      "confirmed"
    );
  }

  /**
   * Unsubscribe from account changes
   */
  async unsubscribe(subscriptionId: number): Promise<void> {
    await this.connection.removeAccountChangeListener(subscriptionId);
  }

  /**
   * Get player's current chunk grid
   */
  async getPlayerChunkGrid(authority: PublicKey): Promise<number[][]> {
    const player = await this.fetchPlayer(authority);
    const world = await this.fetchWorld();
    const physicalIndex = this.normalizeModulo(
      player.chunkIndex - world.scrollOffset,
      CONSTANTS.MAX_CHUNKS
    );
    const chunk = await this.fetchChunk(physicalIndex);
    return chunk.grid;
  }

  /**
   * Check if player has power pellet active
   */
  async isPlayerPowered(authority: PublicKey): Promise<boolean> {
    const player = await this.fetchPlayer(authority);
    const slot = await this.connection.getSlot();
    return slot <= player.powerPelletUntilSlot.toNumber();
  }

  /**
   * Get player balance in SOL
   */
  async getPlayerBalanceSOL(authority: PublicKey): Promise<number> {
    const player = await this.fetchPlayer(authority);
    return player.balanceLamports.toNumber() / anchor.web3.LAMPORTS_PER_SOL;
  }
}

/**
 * Helper function to create a PacRoyaleClient instance
 */
export function createPacRoyaleClient(
  program: Program<PacRoyale>,
  connection: Connection
): PacRoyaleClient {
  return new PacRoyaleClient(program, connection);
}

/**
 * Constants
 */
export const CONSTANTS = {
  LAMPORTS_PER_PELLET: 1_000_000,
  LAMPORTS_PER_GHOST_KILL: 10_000_000,
  CHUNK_ROWS: 6,
  CHUNK_COLS: 10,
  NUM_CHUNK_TEMPLATES: 5,
  MAX_CHUNKS: 32,
  POWER_PELLET_DURATION_SLOTS: 200,
  NUM_GHOSTS: 4,
  
  // Cell types
  CELL_EMPTY: 0,
  CELL_WALL: 1,
  CELL_PELLET: 2,
  CELL_POWER: 3,
  
  // Directions
  DIR_UP: 0,
  DIR_DOWN: 1,
  DIR_LEFT: 2,
  DIR_RIGHT: 3,
  
  // Ghost states
  GHOST_CHASE: 0,
  GHOST_SCATTER: 1,
  GHOST_FRIGHTENED: 2,
};

/**
 * Type definitions
 */
export type Direction = 0 | 1 | 2 | 3;
export type CellType = 0 | 1 | 2 | 3;
export type GhostState = 0 | 1 | 2;

export interface PlayerPosition {
  chunkIndex: number;
  rowInChunk: number;
  col: number;
}

export interface GhostPosition {
  chunkIndex: number;
  row: number;
  col: number;
}
