import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { config } from "./config";
import { createHash } from "crypto";
import { AgentDecision } from "./agents";

// Pyth SOL/USD price feed on devnet
const PYTH_SOL_USD_DEVNET = new PublicKey("J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix");

// IDL will be loaded from the built artifact
const idl = require("../../target/idl/ai_arena.json");

export function sha256(data: string): number[] {
  const hash = createHash("sha256").update(data).digest();
  return Array.from(hash);
}

export function priceToFixed(price: number): anchor.BN {
  return new anchor.BN(Math.round(price * 1_000_000));
}

export class SolanaClient {
  connection: Connection;
  program: any;
  operator: Keypair;
  arenaStatePda: PublicKey;
  confidenceGatePda: PublicKey;
  programId: PublicKey;

  constructor() {
    this.programId = new PublicKey(config.programId);
    this.operator = config.operatorKeypair;
    this.connection = new Connection(config.solanaRpcUrl, "confirmed");

    const wallet = new anchor.Wallet(this.operator);
    const provider = new anchor.AnchorProvider(this.connection, wallet, {
      commitment: "confirmed",
    });

    this.program = new anchor.Program(idl as any, provider);

    // Derive arena PDA
    [this.arenaStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("arena"), this.operator.publicKey.toBuffer()],
      this.programId
    );
    [this.confidenceGatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("gate"), this.arenaStatePda.toBuffer()],
      this.programId
    );
  }

  agentProfilePda(agentId: number): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("agent"),
        this.arenaStatePda.toBuffer(),
        new anchor.BN(agentId).toArrayLike(Buffer, "le", 8),
      ],
      this.programId
    );
    return pda;
  }

  agentPositionPda(agentId: number): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("position"),
        this.arenaStatePda.toBuffer(),
        new anchor.BN(agentId).toArrayLike(Buffer, "le", 8),
      ],
      this.programId
    );
    return pda;
  }

  decisionPda(agentId: number, cycleId: number): PublicKey {
    const agentPda = this.agentProfilePda(agentId);
    const [pda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("decision"),
        this.arenaStatePda.toBuffer(),
        agentPda.toBuffer(),
        new anchor.BN(cycleId).toArrayLike(Buffer, "le", 8),
      ],
      this.programId
    );
    return pda;
  }

  executionPda(decisionPda: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("execution"), decisionPda.toBuffer()],
      this.programId
    );
    return pda;
  }

  // =========================================================================
  // Initialize Arena (one-time setup)
  // =========================================================================

  async initializeArena(): Promise<string> {
    const tx = await this.program.methods
      .initializeArena("SOL/USDC", 70, new anchor.BN(100_000_000), new anchor.BN(30))
      .accounts({
        authority: this.operator.publicKey,
        arenaState: this.arenaStatePda,
        confidenceGate: this.confidenceGatePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log("Arena initialized:", tx);
    return tx;
  }

  // =========================================================================
  // Register Agent (one-time per agent)
  // =========================================================================

  async registerAgent(
    agentId: number,
    strategyName: string,
    modelId: string,
    maxTradeSize: number,
    maxPositionSize: number
  ): Promise<string> {
    const profilePda = this.agentProfilePda(agentId);
    const positionPda = this.agentPositionPda(agentId);

    const tx = await this.program.methods
      .registerAgent(
        new anchor.BN(agentId),
        strategyName,
        modelId,
        new anchor.BN(maxTradeSize * 1_000_000),
        new anchor.BN(maxPositionSize * 1_000_000)
      )
      .accounts({
        authority: this.operator.publicKey,
        arenaState: this.arenaStatePda,
        agentProfile: profilePda,
        agentPosition: positionPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log(`Agent ${agentId} (${strategyName}) registered:`, tx);
    return tx;
  }

  // =========================================================================
  // Submit Decision
  // =========================================================================

  async submitDecision(
    agentId: number,
    cycleId: number,
    decision: AgentDecision,
    snapshotJson: string,
    oraclePrice: number
  ): Promise<{ tx: string; decisionPda: string; gateStatus: string }> {
    const decisionPdaKey = this.decisionPda(agentId, cycleId);
    const inputHash = sha256(snapshotJson);
    const reasoningHash = sha256(decision.reasoning);

    const actionMap: Record<string, any> = {
      buy: { buy: {} },
      sell: { sell: {} },
      hold: { hold: {} },
    };

    const tx = await this.program.methods
      .submitDecision(
        new anchor.BN(cycleId),
        inputHash,
        actionMap[decision.action],
        { base: {} },
        new anchor.BN(decision.amount * 1_000_000),
        decision.confidence,
        reasoningHash,
        priceToFixed(oraclePrice),  // fallback, used only if Pyth account missing
        new anchor.BN(Math.floor(Date.now() / 1000)),
        new anchor.BN(500_000)
      )
      .accounts({
        operator: this.operator.publicKey,
        arenaState: this.arenaStatePda,
        agentProfile: this.agentProfilePda(agentId),
        agentPosition: this.agentPositionPda(agentId),
        confidenceGate: this.confidenceGatePda,
        decisionRecord: decisionPdaKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .remainingAccounts([
        { pubkey: PYTH_SOL_USD_DEVNET, isWritable: false, isSigner: false },
      ])
      .rpc();

    // Fetch gate status
    const record = await this.program.account.decisionRecord.fetch(decisionPdaKey);
    const gateStatus = Object.keys(record.gateStatus)[0];

    return {
      tx,
      decisionPda: decisionPdaKey.toBase58(),
      gateStatus,
    };
  }

  // =========================================================================
  // Execute Decision
  // =========================================================================

  async executeDecision(
    agentId: number,
    cycleId: number
  ): Promise<string> {
    const decisionPdaKey = this.decisionPda(agentId, cycleId);
    const executionPdaKey = this.executionPda(decisionPdaKey);

    const tx = await this.program.methods
      .executeDecision()
      .accounts({
        operator: this.operator.publicKey,
        arenaState: this.arenaStatePda,
        decisionRecord: decisionPdaKey,
        agentPosition: this.agentPositionPda(agentId),
        executionRecord: executionPdaKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    return tx;
  }

  // =========================================================================
  // Record Outcome
  // =========================================================================

  async recordOutcome(
    agentId: number,
    currentPrice: number
  ): Promise<string> {
    const tx = await this.program.methods
      .recordOutcome(priceToFixed(currentPrice))
      .accounts({
        operator: this.operator.publicKey,
        arenaState: this.arenaStatePda,
        agentPosition: this.agentPositionPda(agentId),
      })
      .rpc();

    return tx;
  }

  // =========================================================================
  // Read state
  // =========================================================================

  async getArenaState() {
    return this.program.account.arenaState.fetch(this.arenaStatePda);
  }

  async getAgentProfile(agentId: number) {
    return this.program.account.agentProfile.fetch(
      this.agentProfilePda(agentId)
    );
  }

  async getAgentPosition(agentId: number) {
    return this.program.account.agentPosition.fetch(
      this.agentPositionPda(agentId)
    );
  }

  async getDecisionRecord(agentId: number, cycleId: number) {
    return this.program.account.decisionRecord.fetch(
      this.decisionPda(agentId, cycleId)
    );
  }

  async getAllDecisions() {
    return this.program.account.decisionRecord.all([
      {
        memcmp: {
          offset: 8, // after discriminator
          bytes: this.arenaStatePda.toBase58(),
        },
      },
    ]);
  }

  async getAllExecutions() {
    return this.program.account.executionRecord.all();
  }

  async getAllPositions() {
    return this.program.account.agentPosition.all([
      {
        memcmp: {
          offset: 8,
          bytes: this.arenaStatePda.toBase58(),
        },
      },
    ]);
  }
}
