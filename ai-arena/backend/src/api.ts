import express from "express";
import cors from "cors";
import { SolanaClient } from "./solana";
import { runCycle, getCycleHistory, getCurrentCycleId } from "./cycle";
import { getReasoning } from "./db";
import { AGENT_CONFIGS } from "./agents";

export function createApi(solana: SolanaClient) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", cycleId: getCurrentCycleId() });
  });

  // Run next cycle (demo trigger)
  app.post("/api/cycle", async (_req, res) => {
    try {
      const result = await runCycle(solana);
      res.json(result);
    } catch (err: any) {
      console.error("Cycle error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Get cycle history
  app.get("/api/cycles", (_req, res) => {
    res.json(getCycleHistory());
  });

  // Get arena state
  app.get("/api/arena", async (_req, res) => {
    try {
      const state = await solana.getArenaState();
      res.json(state);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get all agent profiles + positions
  app.get("/api/agents", async (_req, res) => {
    try {
      const agents = [];
      for (const cfg of AGENT_CONFIGS) {
        try {
          const profile = await solana.getAgentProfile(cfg.id);
          const position = await solana.getAgentPosition(cfg.id);
          agents.push({
            id: cfg.id,
            name: cfg.name,
            profile,
            position: {
              currentSide: Object.keys(position.currentSide)[0],
              currentSize: position.currentSize.toNumber(),
              averageEntryPrice: position.averageEntryPrice.toNumber(),
              realizedPnl: position.realizedPnl.toNumber(),
              unrealizedPnl: position.unrealizedPnl.toNumber(),
              totalExecuted: position.totalExecuted.toNumber(),
              lastExecutedCycle: position.lastExecutedCycle.toNumber(),
            },
          });
        } catch {
          // Agent not registered yet
          agents.push({ id: cfg.id, name: cfg.name, profile: null, position: null });
        }
      }
      res.json(agents);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get all decisions (raw on-chain data)
  app.get("/api/decisions", async (_req, res) => {
    try {
      const decisions = await solana.getAllDecisions();
      const formatted = decisions.map((d) => ({
        publicKey: d.publicKey.toBase58(),
        agent: d.account.agent.toBase58(),
        cycleId: d.account.cycleId.toNumber(),
        action: Object.keys(d.account.action)[0],
        confidence: d.account.confidence,
        gateStatus: Object.keys(d.account.gateStatus)[0],
        oraclePrice: d.account.oraclePrice.toNumber(),
        createdAt: d.account.createdAt.toNumber(),
      }));
      res.json(formatted);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Durable decision feed — built from on-chain data + SQLite reasoning
  // Survives backend restarts, no dependency on in-memory cycleHistory
  app.get("/api/feed", async (_req, res) => {
    try {
      const decisions = await solana.getAllDecisions();

      // Group by cycleId
      const byCycle: Record<number, any[]> = {};
      for (const d of decisions) {
        const cycleId = d.account.cycleId.toNumber();
        if (!byCycle[cycleId]) byCycle[cycleId] = [];

        // Find agent name
        const agentPda = d.account.agent.toBase58();
        const agentCfg = AGENT_CONFIGS.find((a) => {
          return solana.agentProfilePda(a.id).toBase58() === agentPda;
        });

        // Get confirmed reasoning from SQLite
        const reasoning = getReasoning(d.publicKey.toBase58());

        byCycle[cycleId].push({
          agentId: agentCfg?.id || 0,
          agentName: agentCfg?.name || "Unknown",
          action: Object.keys(d.account.action)[0],
          amount: d.account.amount.toNumber(),
          confidence: d.account.confidence,
          gateStatus: Object.keys(d.account.gateStatus)[0],
          oraclePrice: d.account.oraclePrice.toNumber(),
          decisionPda: d.publicKey.toBase58(),
          reasoning: reasoning?.full_text || null,
          createdAt: d.account.createdAt.toNumber(),
        });
      }

      // Sort cycles descending, return last 20
      const cycles = Object.entries(byCycle)
        .map(([cycleId, decisions]) => ({
          cycleId: parseInt(cycleId),
          decisions: decisions.sort((a, b) => a.agentId - b.agentId),
        }))
        .sort((a, b) => b.cycleId - a.cycleId)
        .slice(0, 20);

      res.json(cycles);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get reasoning by decision PDA
  app.get("/api/reasoning/:decisionPda", (req, res) => {
    const reasoning = getReasoning(req.params.decisionPda);
    if (!reasoning) {
      return res.status(404).json({ error: "Not found" });
    }
    res.json(reasoning);
  });

  // Get leaderboard
  app.get("/api/leaderboard", async (_req, res) => {
    try {
      const leaderboard = [];
      const decisions = await solana.getAllDecisions();

      for (const cfg of AGENT_CONFIGS) {
        try {
          const position = await solana.getAgentPosition(cfg.id);
          const agentPda = solana.agentProfilePda(cfg.id).toBase58();

          const agentDecisions = decisions.filter(
            (d) => d.account.agent.toBase58() === agentPda
          );
          const totalDecisions = agentDecisions.length;
          const approved = agentDecisions.filter(
            (d) => Object.keys(d.account.gateStatus)[0] === "approved"
          ).length;
          const gatePassRate =
            totalDecisions > 0
              ? Math.round((approved / totalDecisions) * 100)
              : 0;

          leaderboard.push({
            agentId: cfg.id,
            agentName: cfg.name,
            totalDecisions,
            approved,
            gatePassRate,
            totalExecuted: position.totalExecuted.toNumber(),
            realizedPnl: position.realizedPnl.toNumber(),
            unrealizedPnl: position.unrealizedPnl.toNumber(),
            totalPnl:
              position.realizedPnl.toNumber() +
              position.unrealizedPnl.toNumber(),
            currentSize: position.currentSize.toNumber(),
            currentSide: Object.keys(position.currentSide)[0],
          });
        } catch {
          // Agent not registered
        }
      }

      // Sort by total PnL descending
      leaderboard.sort((a, b) => b.totalPnl - a.totalPnl);

      res.json(leaderboard);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return app;
}
