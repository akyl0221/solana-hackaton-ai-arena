import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import { Keypair } from "@solana/web3.js";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

function loadKeypair(keypairPath: string): Keypair {
  const resolved = keypairPath.replace("~", process.env.HOME || "");
  const secretKey = JSON.parse(fs.readFileSync(resolved, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

export const config = {
  solanaRpcUrl: process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
  programId: process.env.PROGRAM_ID || "EpCHhXou3cP7c9CJbY6ACwjKwA56q79BeYZ5auTixBLY",
  operatorKeypair: loadKeypair(
    process.env.OPERATOR_KEYPAIR_PATH || "~/.config/solana/id.json"
  ),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  aiMode:
    process.env.AI_MODE === "live" || process.env.AI_MODE === "fallback"
      ? process.env.AI_MODE
      : "auto",
  aiProvider:
    process.env.AI_PROVIDER === "anthropic" || process.env.AI_PROVIDER === "openai"
      ? process.env.AI_PROVIDER
      : "auto",
  anthropicModel:
    process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
  openaiModel:
    process.env.OPENAI_MODEL || "gpt-4o-mini",
  port: parseInt(process.env.PORT || "3001", 10),
  dbPath: path.resolve(__dirname, "../reasoning.db"),
};
