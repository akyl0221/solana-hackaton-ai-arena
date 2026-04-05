import { SolanaClient } from "./solana";
import { fetchMarketSnapshot, MarketSnapshot } from "./market";
import { runAgent, AGENT_CONFIGS, AgentDecision } from "./agents";
import { createPendingAttempt, markConfirmed, markFailed, orphanOlderAttempts } from "./db";

export interface CycleResult {
  cycleId: number;
  snapshot: MarketSnapshot;
  decisions: AgentCycleResult[];
}

export interface AgentCycleResult {
  agentId: number;
  agentName: string;
  decision: AgentDecision;
  gateStatus: string;
  decisionPda: string;
  txSignature: string;
  executionTx?: string;
  error?: string;
}

let currentCycleId = 0;
let initialized = false;
const cycleHistory: CycleResult[] = [];

export function getCycleHistory(): CycleResult[] {
  return cycleHistory;
}

export function getCurrentCycleId(): number {
  return currentCycleId;
}

export async function initCycleCounter(solana: SolanaClient): Promise<void> {
  if (initialized) return;
  try {
    const decisions = await solana.getAllDecisions();
    if (decisions.length > 0) {
      const maxCycle = Math.max(
        ...decisions.map((d: any) => d.account.cycleId.toNumber())
      );
      currentCycleId = maxCycle;
      console.log(`Resumed cycle counter from on-chain: ${currentCycleId}`);
    }
  } catch (err) {
    console.log("No existing decisions found, starting from cycle 0");
  }
  initialized = true;
}

export async function runCycle(solana: SolanaClient): Promise<CycleResult> {
  await initCycleCounter(solana);
  currentCycleId++;
  const cycleId = currentCycleId;
  console.log(`\n${"=".repeat(60)}`);
  console.log(`CYCLE ${cycleId} START`);
  console.log(`${"=".repeat(60)}`);

  // 1. Get one settlement price for outcome recording
  const settlementSnapshot = await fetchMarketSnapshot(cycleId);
  const settlementPrice = settlementSnapshot.price;

  // 2. Record outcomes for previous cycle using single settlement price
  if (cycleId > 1) {
    console.log(`Recording outcomes (settlement=$${settlementPrice.toFixed(2)})...`);
    for (const agentConfig of AGENT_CONFIGS) {
      try {
        await solana.recordOutcome(agentConfig.id, settlementPrice);
        console.log(`  Outcome updated for agent ${agentConfig.id}`);
      } catch (err: any) {
        // Expected if agent has no position or already settled
        console.log(`  Outcome skip agent ${agentConfig.id}: ${err.message?.slice(0, 60)}`);
      }
    }
  }

  // 3. Fetch market snapshot for agent reasoning (same price, fresh indicators)
  const snapshot = settlementSnapshot;
  console.log(
    `Market: $${snapshot.price.toFixed(2)} | Momentum: ${(snapshot.momentum * 100).toFixed(3)}% | Vol: ${(snapshot.volatility * 100).toFixed(3)}%`
  );

  const snapshotJson = JSON.stringify(snapshot);
  const results: AgentCycleResult[] = [];

  // 2. Run each agent
  for (const agentConfig of AGENT_CONFIGS) {
    console.log(`\n--- Agent: ${agentConfig.name} ---`);

    try {
      // 2a. Fetch position state for agent context
      let positionState = null;
      try {
        const pos = await solana.getAgentPosition(agentConfig.id);
        positionState = {
          currentSide: Object.keys(pos.currentSide)[0],
          currentSize: pos.currentSize.toNumber(),
          averageEntryPrice: pos.averageEntryPrice.toNumber(),
          realizedPnl: pos.realizedPnl.toNumber(),
          unrealizedPnl: pos.unrealizedPnl.toNumber(),
        };
      } catch {}

      // 2b. Generate decision (LLM-first, deterministic fallback)
      const decision = await runAgent(agentConfig.name, snapshot, positionState);
      console.log(
        `Signal: ${decision.action.toUpperCase()} ${decision.amount} SOL | Confidence: ${decision.confidence}`
      );

      // 2b. Save reasoning to SQLite (pending attempt)
      const decisionPdaKey = solana.decisionPda(agentConfig.id, cycleId);
      const decisionPdaStr = decisionPdaKey.toBase58();
      const reasoningHash = require("crypto")
        .createHash("sha256")
        .update(decision.reasoning)
        .digest("hex");
      const attemptId = createPendingAttempt(decisionPdaStr, reasoningHash, decision.reasoning);

      // 2c. Submit decision on-chain
      let tx: string;
      let decisionPda: string;
      let gateStatus: string;
      try {
        const result = await solana.submitDecision(
          agentConfig.id,
          cycleId,
          decision,
          snapshotJson,
          snapshot.price
        );
        tx = result.tx;
        decisionPda = result.decisionPda;
        gateStatus = result.gateStatus;
      } catch (submitErr: any) {
        markFailed(attemptId, submitErr.message);
        throw submitErr;
      }

      // 2d. Confirm reasoning and orphan older attempts
      orphanOlderAttempts(decisionPda, attemptId);
      markConfirmed(attemptId, tx);

      console.log(`Gate: ${gateStatus} | TX: ${tx.slice(0, 16)}...`);

      const result: AgentCycleResult = {
        agentId: agentConfig.id,
        agentName: agentConfig.name,
        decision,
        gateStatus,
        decisionPda,
        txSignature: tx,
      };

      // 2e. Execute if approved
      if (gateStatus === "approved") {
        try {
          const execTx = await solana.executeDecision(
            agentConfig.id,
            cycleId
          );
          result.executionTx = execTx;
          console.log(`Executed: ${execTx.slice(0, 16)}...`);
        } catch (execErr: any) {
          console.error(`Execution failed: ${execErr.message}`);
          result.error = `Execution failed: ${execErr.message}`;
        }
      }

      results.push(result);
    } catch (err: any) {
      console.error(`Agent ${agentConfig.name} failed:`, err.message);
      results.push({
        agentId: agentConfig.id,
        agentName: agentConfig.name,
        decision: {
          action: "hold",
          side: "SOL",
          amount: 0,
          confidence: 0,
          reasoning: `Error: ${err.message}`,
        },
        gateStatus: "error",
        decisionPda: "",
        txSignature: "",
        error: err.message,
      });
    }
  }

  const cycleResult: CycleResult = { cycleId, snapshot, decisions: results };
  cycleHistory.push(cycleResult);

  // Keep last 50 cycles
  if (cycleHistory.length > 50) cycleHistory.shift();

  console.log(`\nCYCLE ${cycleId} COMPLETE`);
  console.log(`${"=".repeat(60)}\n`);

  return cycleResult;
}
