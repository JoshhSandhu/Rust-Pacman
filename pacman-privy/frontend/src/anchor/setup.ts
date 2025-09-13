import { type IdlAccounts, Program } from "@coral-xyz/anchor";
import { IDL, type PacmanGame } from "./idl";
import { Connection, PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "../constants/constants";
import { idlAddress } from "@coral-xyz/anchor/dist/cjs/idl";


export const connection = new Connection("https://api.devnet.solana.com", "confirmed");

export const program = new Program<PacmanGame>(
    IDL,
    { connection }
);

console.log("Program:", program);

export type GameData = IdlAccounts<PacmanGame>["gameData"];

