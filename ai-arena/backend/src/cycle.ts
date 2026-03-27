import { SolanaClient } from "./solana";
import { fetchMarketSnapshot, MarketSnapshot } from "./market";
import { runAgent, AGENT_CONFIGS, AgentDecision } from "./agents";
import { saveReasoning, confirmReasoning, failReasoning } from "./db";

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
const cycleHistory: CycleResult[] = [];

export function getCycleHistory(): CycleResult[] {
  return cycleHistory;
}

export function getCurrentCycleId(): number {
  return currentCycleId;
}

export async function runCycle(solana: SolanaClient): Promise<CycleResult> {
  currentCycleId++;
  const cycleId = currentCycleId;
  console.log(`\n${"=".repeat(60)}`);
  console.log(`CYCLE ${cycleId} START`);
  console.log(`${"=".repeat(60)}`);

  // 1. Fetch market snapshot
  const snapshot = await fetchMarketSnapshot(cycleId);
  console.log(
    `Market: $${snapshot.price.toFixed(2)} | Momentum: ${(snapshot.momentum * 100).toFixed(3)}% | Vol: ${(snapshot.volatility * 100).toFixed(3)}%`
  );

  const snapshotJson = JSON.stringify(snapshot);
  const results: AgentCycleResult[] = [];

  // 2. Run each agent
  for (const agentConfig of AGENT_CONFIGS) {
    console.log(`\n--- Agent: ${agentConfig.name} ---`);

    try {
      // 2a. Generate decision (deterministic + LLM)
      const decision = await runAgent(agentConfig.name, snapshot);
      console.log(
        `Signal: ${decision.action.toUpperCase()} ${decision.amount} SOL | Confidence: ${decision.confidence}`
      );

      // 2b. Save reasoning to SQLite (pending)
      const decisionPdaKey = solana.decisionPda(agentConfig.id, cycleId);
      saveReasoning(
        decisionPdaKey.toBase58(),
        require("crypto")
          .createHash("sha256")
          .update(decision.reasoning)
          .digest("hex"),
        decision.reasoning
      );

      // 2c. Submit decision on-chain
      const { tx, decisionPda, gateStatus } = await solana.submitDecision(
        agentConfig.id,
        cycleId,
        decision,
        snapshotJson,
        snapshot.price
      );

      // 2d. Update reasoning status
      confirmReasoning(decisionPda, tx);

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
