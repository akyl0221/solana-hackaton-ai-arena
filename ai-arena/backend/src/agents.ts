import { MarketSnapshot } from "./market";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config";

export interface AgentSignal {
  action: "buy" | "sell" | "hold";
  side: "SOL";
  amount: number;
}

export interface AgentDecision {
  action: "buy" | "sell" | "hold";
  side: "SOL";
  amount: number;
  confidence: number;
  reasoning: string;
}

// ============================================================================
// Deterministic strategies — generate signal without LLM
// ============================================================================

function momentumStrategy(snapshot: MarketSnapshot): AgentSignal {
  const { momentum, sma10, sma30, price } = snapshot;

  if (momentum > 0.01 && price > sma10) {
    // Strong upward momentum
    return { action: "buy", side: "SOL", amount: 10 };
  } else if (momentum < -0.01 && price < sma10) {
    // Downward momentum
    return { action: "sell", side: "SOL", amount: 8 };
  }
  return { action: "hold", side: "SOL", amount: 0 };
}

function meanReversionStrategy(snapshot: MarketSnapshot): AgentSignal {
  const { price, sma30, volatility } = snapshot;
  const deviation = (price - sma30) / sma30;

  if (deviation < -0.02) {
    // Price below average — buy the dip
    return { action: "buy", side: "SOL", amount: 8 };
  } else if (deviation > 0.02) {
    // Price above average — sell the rip
    return { action: "sell", side: "SOL", amount: 6 };
  }
  return { action: "hold", side: "SOL", amount: 0 };
}

function riskOffStrategy(snapshot: MarketSnapshot): AgentSignal {
  const { volatility, momentum } = snapshot;

  if (volatility < 0.005 && momentum > 0.005) {
    // Low vol + slight uptrend — small buy
    return { action: "buy", side: "SOL", amount: 3 };
  } else if (volatility > 0.02 || momentum < -0.02) {
    // High vol or strong downtrend — exit
    return { action: "sell", side: "SOL", amount: 5 };
  }
  return { action: "hold", side: "SOL", amount: 0 };
}

const strategies: Record<string, (snapshot: MarketSnapshot) => AgentSignal> = {
  "Momentum Agent": momentumStrategy,
  "Mean Reversion Agent": meanReversionStrategy,
  "Risk-Off Agent": riskOffStrategy,
};

// ============================================================================
// LLM layer — adds confidence and reasoning
// ============================================================================

let anthropic: Anthropic | null = null;

function getAnthropic(): Anthropic | null {
  if (!config.anthropicApiKey) return null;
  if (!anthropic) {
    anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return anthropic;
}

async function llmConfidence(
  strategyName: string,
  signal: AgentSignal,
  snapshot: MarketSnapshot
): Promise<{ confidence: number; reasoning: string }> {
  const client = getAnthropic();

  if (!client) {
    // Fallback: deterministic confidence based on signal strength
    return fallbackConfidence(strategyName, signal, snapshot);
  }

  try {
    const prompt = `You are an AI trading agent named "${strategyName}".
You analyze SOL/USDC market data and assess the confidence of trading signals.

Current market data:
- Price: $${snapshot.price.toFixed(2)}
- SMA(10): $${snapshot.sma10.toFixed(2)}
- SMA(30): $${snapshot.sma30.toFixed(2)}
- Momentum (5-period): ${(snapshot.momentum * 100).toFixed(3)}%
- Volatility: ${(snapshot.volatility * 100).toFixed(3)}%
- Recent prices: ${snapshot.priceHistory.map((p) => "$" + p.toFixed(2)).join(", ")}

The deterministic strategy has generated this signal:
- Action: ${signal.action.toUpperCase()}
- Amount: ${signal.amount} SOL

Based on the market data, assess the confidence of this signal (0-100) and provide a brief reasoning (2-3 sentences).

Respond ONLY in this JSON format:
{"confidence": <number 0-100>, "reasoning": "<string>"}`;

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    const parsed = JSON.parse(text);

    return {
      confidence: Math.min(100, Math.max(0, Math.round(parsed.confidence))),
      reasoning: parsed.reasoning || "No reasoning provided.",
    };
  } catch (err) {
    console.error(`LLM call failed for ${strategyName}:`, err);
    return fallbackConfidence(strategyName, signal, snapshot);
  }
}

function fallbackConfidence(
  strategyName: string,
  signal: AgentSignal,
  snapshot: MarketSnapshot
): { confidence: number; reasoning: string } {
  let confidence = 50;
  let reasoning = "";

  if (signal.action === "hold") {
    confidence = 60 + Math.floor(Math.random() * 20);
    reasoning = `${strategyName}: Market conditions are neutral. Holding position.`;
  } else if (signal.action === "buy") {
    const strength = Math.abs(snapshot.momentum) * 1000;
    confidence = Math.min(95, 55 + Math.floor(strength + Math.random() * 15));
    reasoning = `${strategyName}: Positive signal detected. Momentum: ${(snapshot.momentum * 100).toFixed(2)}%, Price vs SMA10: ${((snapshot.price / snapshot.sma10 - 1) * 100).toFixed(2)}%.`;
  } else {
    const strength = Math.abs(snapshot.momentum) * 1000;
    confidence = Math.min(95, 50 + Math.floor(strength + Math.random() * 15));
    reasoning = `${strategyName}: Negative signal detected. Momentum: ${(snapshot.momentum * 100).toFixed(2)}%, Volatility: ${(snapshot.volatility * 100).toFixed(2)}%.`;
  }

  return { confidence, reasoning };
}

// ============================================================================
// Public API
// ============================================================================

export async function runAgent(
  strategyName: string,
  snapshot: MarketSnapshot
): Promise<AgentDecision> {
  const strategyFn = strategies[strategyName];
  if (!strategyFn) {
    throw new Error(`Unknown strategy: ${strategyName}`);
  }

  // Step 1: Deterministic signal
  const signal = strategyFn(snapshot);

  // Step 2: LLM confidence + reasoning
  const { confidence, reasoning } = await llmConfidence(
    strategyName,
    signal,
    snapshot
  );

  return {
    action: signal.action,
    side: signal.side,
    amount: signal.amount,
    confidence,
    reasoning,
  };
}

export const AGENT_CONFIGS = [
  { id: 1, name: "Momentum Agent", model: "claude-haiku", maxTradeSize: 50, maxPositionSize: 250 },
  { id: 2, name: "Mean Reversion Agent", model: "claude-haiku", maxTradeSize: 30, maxPositionSize: 150 },
  { id: 3, name: "Risk-Off Agent", model: "claude-haiku", maxTradeSize: 20, maxPositionSize: 60 },
];
