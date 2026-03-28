"use client";

import { useState, useEffect, useCallback } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface AgentData {
  id: number;
  name: string;
  profile: any;
  position: {
    currentSide: string;
    currentSize: number;
    averageEntryPrice: number;
    realizedPnl: number;
    unrealizedPnl: number;
    totalExecuted: number;
    lastExecutedCycle: number;
  } | null;
}

interface DecisionResult {
  agentId: number;
  agentName: string;
  decision: {
    action: string;
    side: string;
    amount: number;
    confidence: number;
    reasoning: string;
  };
  gateStatus: string;
  decisionPda: string;
  txSignature: string;
  executionTx?: string;
  error?: string;
}

interface CycleResult {
  cycleId: number;
  snapshot: {
    price: number;
    momentum: number;
    volatility: number;
    sma10: number;
    sma30: number;
  };
  decisions: DecisionResult[];
}

interface LeaderboardEntry {
  agentId: number;
  agentName: string;
  totalDecisions: number;
  approved: number;
  gatePassRate: number;
  totalExecuted: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  currentSize: number;
  currentSide: string;
}

function formatPnl(pnl: number): string {
  const val = pnl / 1_000_000;
  const sign = val >= 0 ? "+" : "";
  return `${sign}$${val.toFixed(2)}`;
}

function formatSize(size: number): string {
  return (size / 1_000_000).toFixed(1);
}

function gateColor(status: string): string {
  if (status === "approved") return "text-green-400";
  return "text-red-400";
}

function gateBg(status: string): string {
  if (status === "approved") return "bg-green-900/20 border-green-800/30";
  return "bg-red-900/20 border-red-800/30";
}

function gateLabel(status: string): string {
  const labels: Record<string, string> = {
    approved: "APPROVED",
    blockedLowConfidence: "BLOCKED: Low Confidence",
    blockedRiskLimit: "BLOCKED: Risk Limit",
    blockedPositionLimit: "BLOCKED: Position Limit",
    blockedCooldown: "BLOCKED: Cooldown",
    blockedInvalidAction: "BLOCKED: Invalid Action",
    error: "ERROR",
  };
  return labels[status] || status;
}

function ConfidenceBar({ confidence, threshold }: { confidence: number; threshold: number }) {
  const passed = confidence >= threshold;
  return (
    <div className="flex items-center gap-2 text-sm">
      <div className="w-20 h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${passed ? "bg-green-500" : "bg-red-500"}`}
          style={{ width: `${confidence}%` }}
        />
      </div>
      <span className={`font-mono text-xs ${passed ? "text-green-400" : "text-red-400"}`}>
        {confidence}
      </span>
      <span className="text-gray-600 text-xs">/{threshold}</span>
    </div>
  );
}

function GateStep({ status, confidence }: { status: string; confidence: number }) {
  const approved = status === "approved";
  return (
    <div className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded border ${gateBg(status)}`}>
      <span className="text-gray-400">Gate:</span>
      <span className={`font-mono ${approved ? "text-green-400" : "text-red-400"}`}>
        {confidence}
      </span>
      <span className="text-gray-500">&gt;=70?</span>
      <span className={`font-bold ${approved ? "text-green-400" : "text-red-400"}`}>
        {approved ? "PASS" : "FAIL"}
      </span>
    </div>
  );
}

function ReasoningBlock({ decisionPda, inlineReasoning }: { decisionPda: string; inlineReasoning: string }) {
  const [expanded, setExpanded] = useState(false);
  const [reasoning, setReasoning] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchReasoning = async () => {
    if (reasoning || !decisionPda) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/reasoning/${decisionPda}`);
      if (res.ok) {
        const data = await res.json();
        setReasoning(data.full_text);
      } else {
        setReasoning(inlineReasoning || "No reasoning available");
      }
    } catch {
      setReasoning(inlineReasoning || "Failed to fetch reasoning");
    }
    setLoading(false);
  };

  const toggle = () => {
    if (!expanded) fetchReasoning();
    setExpanded(!expanded);
  };

  return (
    <div className="mt-1">
      <button
        onClick={toggle}
        className="text-xs text-indigo-400 hover:text-indigo-300 cursor-pointer"
      >
        {expanded ? "Hide reasoning" : "Show reasoning"}
      </button>
      {expanded && (
        <p className="text-xs text-gray-400 mt-1 pl-1 italic">
          {loading ? "Loading..." : (reasoning || inlineReasoning)}
        </p>
      )}
    </div>
  );
}

export default function Home() {
  const [agents, setAgents] = useState<AgentData[]>([]);
  const [cycles, setCycles] = useState<CycleResult[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cycleCount, setCycleCount] = useState(0);

  const fetchData = useCallback(async () => {
    try {
      const [agentsRes, cyclesRes, lbRes] = await Promise.all([
        fetch(`${API}/api/agents`),
        fetch(`${API}/api/cycles`),
        fetch(`${API}/api/leaderboard`),
      ]);
      setAgents(await agentsRes.json());
      setCycles(await cyclesRes.json());
      setLeaderboard(await lbRes.json());
      setError(null);
    } catch {
      setError("Cannot connect to backend. Make sure it is running on port 3001.");
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const runCycle = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/cycle`, { method: "POST" });
      if (!res.ok) throw new Error("Cycle failed");
      setCycleCount((c) => c + 1);
      await fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const latestCycle = cycles.length > 0 ? cycles[cycles.length - 1] : null;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">AI Arena</h1>
          <p className="text-gray-400 mt-1 text-sm">
            Autonomous AI agents competing on Solana with confidence-gated execution
          </p>
        </div>
        <div className="flex items-center gap-4">
          {latestCycle && (
            <div className="text-right text-sm">
              <div className="text-gray-400">Cycle #{latestCycle.cycleId}</div>
              <div className="font-mono text-lg">${latestCycle.snapshot.price.toFixed(2)}</div>
            </div>
          )}
          <button
            onClick={runCycle}
            disabled={loading}
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg font-semibold transition-colors cursor-pointer"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Running...
              </span>
            ) : (
              "Run Next Cycle"
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Agent Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {agents.map((agent) => {
          const totalPnl = agent.position
            ? agent.position.realizedPnl + agent.position.unrealizedPnl
            : 0;
          return (
            <div
              key={agent.id}
              className="bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-700 transition-colors"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-lg">{agent.name}</h3>
                <span
                  className={`text-xs px-2 py-1 rounded-full font-medium ${
                    agent.position?.currentSide === "long"
                      ? "bg-green-900/50 text-green-300 border border-green-800/50"
                      : "bg-gray-800 text-gray-400 border border-gray-700"
                  }`}
                >
                  {agent.position?.currentSide?.toUpperCase() || "FLAT"}
                </span>
              </div>

              {agent.position ? (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Position</span>
                    <span className="font-mono">{formatSize(agent.position.currentSize)} SOL</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Entry Price</span>
                    <span className="font-mono">
                      ${(agent.position.averageEntryPrice / 1_000_000).toFixed(2)}
                    </span>
                  </div>
                  <div className="border-t border-gray-800 my-2" />
                  <div className="flex justify-between">
                    <span className="text-gray-400">Total PnL</span>
                    <span
                      className={`font-mono font-semibold ${
                        totalPnl >= 0 ? "text-green-400" : "text-red-400"
                      }`}
                    >
                      {formatPnl(totalPnl)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Executions</span>
                    <span className="font-mono">{agent.position.totalExecuted}</span>
                  </div>
                </div>
              ) : (
                <p className="text-gray-500 text-sm">Not registered</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Flow explanation */}
      <div className="mb-6 px-4 py-3 bg-gray-900/50 border border-gray-800 rounded-lg">
        <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
          <span className="px-2 py-1 bg-gray-800 rounded">Market Snapshot</span>
          <span>-&gt;</span>
          <span className="px-2 py-1 bg-gray-800 rounded">AI Decision</span>
          <span>-&gt;</span>
          <span className="px-2 py-1 bg-gray-800 rounded">On-Chain Record</span>
          <span>-&gt;</span>
          <span className="px-2 py-1 bg-indigo-900/50 border border-indigo-800/50 rounded">Confidence Gate</span>
          <span>-&gt;</span>
          <span className="px-2 py-1 bg-gray-800 rounded">Execute / Block</span>
          <span>-&gt;</span>
          <span className="px-2 py-1 bg-gray-800 rounded">Outcome</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Decision Feed */}
        <div className="lg:col-span-2">
          <h2 className="text-xl font-semibold mb-4">Decision Feed</h2>
          <div className="space-y-3 max-h-[700px] overflow-y-auto pr-2">
            {cycles.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                <p className="text-lg mb-2">No cycles yet</p>
                <p className="text-sm">Click &quot;Run Next Cycle&quot; to start the AI agents</p>
              </div>
            )}
            {[...cycles].reverse().map((cycle) => (
              <div
                key={cycle.cycleId}
                className="bg-gray-900 border border-gray-800 rounded-xl p-4"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold">Cycle #{cycle.cycleId}</span>
                    <span className="text-xs text-gray-500 font-mono">
                      SOL ${cycle.snapshot.price.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <span>Mom: {(cycle.snapshot.momentum * 100).toFixed(2)}%</span>
                    <span>Vol: {(cycle.snapshot.volatility * 100).toFixed(2)}%</span>
                  </div>
                </div>

                <div className="space-y-2">
                  {cycle.decisions.map((d) => (
                    <div
                      key={`${cycle.cycleId}-${d.agentId}`}
                      className={`rounded-lg px-3 py-2 border ${gateBg(d.gateStatus)}`}
                    >
                      <div className="flex items-center gap-3 text-sm">
                        <span className="w-36 font-medium truncate">
                          {d.agentName}
                        </span>
                        <span className={`w-12 text-center font-mono uppercase font-bold ${
                          d.decision.action === "buy" ? "text-green-400" :
                          d.decision.action === "sell" ? "text-red-400" : "text-gray-400"
                        }`}>
                          {d.decision.action}
                        </span>
                        <span className="w-16 text-center text-gray-400 font-mono text-xs">
                          {d.decision.amount > 0
                            ? `${d.decision.amount} SOL`
                            : "-"}
                        </span>
                        <ConfidenceBar confidence={d.decision.confidence} threshold={70} />
                        <GateStep status={d.gateStatus} confidence={d.decision.confidence} />
                        {d.txSignature && (
                          <a
                            href={`https://explorer.solana.com/tx/${d.txSignature}?cluster=devnet`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-indigo-400 hover:text-indigo-300 text-xs ml-1"
                            title="View on Solana Explorer"
                          >
                            TX
                          </a>
                        )}
                      </div>
                      <ReasoningBlock
                        decisionPda={d.decisionPda}
                        inlineReasoning={d.decision.reasoning}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right column */}
        <div>
          {/* Leaderboard */}
          <h2 className="text-xl font-semibold mb-4">Leaderboard</h2>
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            {leaderboard.length === 0 ? (
              <p className="text-gray-500 p-4 text-center">No data yet</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 text-left border-b border-gray-800">
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Agent</th>
                    <th className="px-4 py-3 text-right">PnL</th>
                    <th className="px-4 py-3 text-right">Pass%</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((entry, i) => (
                    <tr
                      key={entry.agentId}
                      className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
                    >
                      <td className="px-4 py-3 font-bold text-gray-500">
                        {i === 0 ? "1" : i + 1}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{entry.agentName}</div>
                        <div className="text-xs text-gray-500">
                          {entry.totalDecisions} dec | {entry.totalExecuted} exec
                        </div>
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono ${
                          entry.totalPnl >= 0
                            ? "text-green-400"
                            : "text-red-400"
                        }`}
                      >
                        {formatPnl(entry.totalPnl)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={`font-mono ${
                            entry.gatePassRate >= 50
                              ? "text-green-400"
                              : "text-yellow-400"
                          }`}
                        >
                          {entry.gatePassRate}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Market */}
          {latestCycle && (
            <div className="mt-4 bg-gray-900 border border-gray-800 rounded-xl p-4">
              <h3 className="font-semibold mb-3">Market</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">SOL/USDC</span>
                  <span className="font-mono font-semibold">${latestCycle.snapshot.price.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">SMA(10)</span>
                  <span className="font-mono">${latestCycle.snapshot.sma10.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Momentum</span>
                  <span
                    className={`font-mono ${
                      latestCycle.snapshot.momentum >= 0
                        ? "text-green-400"
                        : "text-red-400"
                    }`}
                  >
                    {(latestCycle.snapshot.momentum * 100).toFixed(3)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Volatility</span>
                  <span className="font-mono">
                    {(latestCycle.snapshot.volatility * 100).toFixed(3)}%
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* On-Chain */}
          <div className="mt-4 bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h3 className="font-semibold mb-3">On-Chain</h3>
            <div className="text-xs space-y-2">
              <div>
                <span className="text-gray-400">Program: </span>
                <a
                  href="https://explorer.solana.com/address/EpCHhXou3cP7c9CJbY6ACwjKwA56q79BeYZ5auTixBLY?cluster=devnet"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-400 hover:text-indigo-300 font-mono"
                >
                  EpCHhX...xBLY
                </a>
              </div>
              <div>
                <span className="text-gray-400">Oracle: </span>
                <a
                  href="https://explorer.solana.com/address/J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix?cluster=devnet"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-400 hover:text-indigo-300 font-mono"
                >
                  Pyth SOL/USD
                </a>
              </div>
              <div>
                <span className="text-gray-400">Network: </span>
                <span>Solana Devnet</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
