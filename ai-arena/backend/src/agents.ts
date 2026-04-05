import { MarketSnapshot } from "./market";
import { config } from "./config";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ============================================================================
// Types
// ============================================================================

export interface AgentDecision {
  action: "buy" | "sell" | "hold";
  side: "SOL";
  amount: number;
  confidence: number;
  reasoning: string;
}

export interface AgentConfig {
  id: number;
  name: string;
  model: string;
  maxTradeSize: number;
  maxPositionSize: number;
  persona: string;
}

export interface PositionState {
  currentSide: string;
  currentSize: number;
  averageEntryPrice: number;
  realizedPnl: number;
  unrealizedPnl: number;
}

// ============================================================================
// Agent Personas — prompt-defined, not hardcoded logic
// ============================================================================

export const AGENT_CONFIGS: AgentConfig[] = [
  {
    id: 1,
    name: "Momentum Agent",
    model: "gemini-2.0-flash-lite",
    maxTradeSize: 50,
    maxPositionSize: 250,
    persona: `You are a momentum-based SOL/USDC trader.
Your strategy: follow the trend. When momentum is positive and price is above short-term SMA, buy. When momentum turns negative and price falls below SMA, sell. When signals are mixed, hold.
You are moderately aggressive — you take positions when trends are clear, but avoid choppy markets.
You prefer larger position sizes when trends are strong and smaller sizes when they are weak.`,
  },
  {
    id: 2,
    name: "Mean Reversion Agent",
    model: "gemini-2.0-flash-lite",
    maxTradeSize: 30,
    maxPositionSize: 150,
    persona: `You are a mean-reversion SOL/USDC trader.
Your strategy: buy when price drops significantly below the longer-term average (SMA30), sell when price rises significantly above it. When price is near the average, hold.
You are patient — you wait for clear deviations before acting.
You prefer moderate position sizes and take profits early.`,
  },
  {
    id: 3,
    name: "Risk-Off Agent",
    model: "gemini-2.0-flash-lite",
    maxTradeSize: 20,
    maxPositionSize: 60,
    persona: `You are a conservative, risk-averse SOL/USDC trader.
Your strategy: prioritize capital preservation. Only buy when volatility is very low AND there is a slight uptrend. Sell or hold in most other conditions. When in doubt, always hold.
You are very cautious — you take small positions rarely and exit at the first sign of trouble.
You strongly prefer holding cash over taking risk.`,
  },
];

// ============================================================================
// AI Provider: Gemini
// ============================================================================

let gemini: GoogleGenerativeAI | null = null;

function getGemini(): GoogleGenerativeAI | null {
  if (!config.geminiApiKey) return null;
  if (!gemini) {
    gemini = new GoogleGenerativeAI(config.geminiApiKey);
  }
  return gemini;
}

function buildPrompt(
  agent: AgentConfig,
  snapshot: MarketSnapshot,
  position: PositionState | null
): string {
  const positionDesc = position
    ? `Current position: ${position.currentSide.toUpperCase()}, size: ${(position.currentSize / 1_000_000).toFixed(1)} SOL, entry: $${(position.averageEntryPrice / 1_000_000).toFixed(2)}, realized PnL: $${(position.realizedPnl / 1_000_000).toFixed(2)}, unrealized PnL: $${(position.unrealizedPnl / 1_000_000).toFixed(2)}`
    : "Current position: FLAT (no open position)";

  return `${agent.persona}

MARKET DATA:
- SOL/USDC Price: $${snapshot.price.toFixed(2)}
- SMA(10): $${snapshot.sma10.toFixed(2)}
- SMA(30): $${snapshot.sma30.toFixed(2)}
- Momentum (5-period): ${(snapshot.momentum * 100).toFixed(3)}%
- Volatility: ${(snapshot.volatility * 100).toFixed(3)}%
- Recent prices: ${snapshot.priceHistory.map((p) => "$" + p.toFixed(2)).join(", ")}

POSITION STATE:
${positionDesc}

CONSTRAINTS:
- Max trade size: ${agent.maxTradeSize} SOL
- Max position size: ${agent.maxPositionSize} SOL
- Only SOL/USDC pair
- No leverage, no shorting
- Amount must be 0 for hold, positive integer for buy/sell

Analyze the market data and your current position. Make a trading decision.

Respond with ONLY a valid JSON object, nothing else:
{"action": "buy" | "sell" | "hold", "amount": <integer 0-${agent.maxTradeSize}>, "confidence": <integer 0-100>, "reasoning": "<2-3 sentence explanation>"}`;
}

async function geminiDecision(
  agent: AgentConfig,
  snapshot: MarketSnapshot,
  position: PositionState | null
): Promise<AgentDecision | null> {
  const client = getGemini();
  if (!client) return null;

  try {
    const model = client.getGenerativeModel({ model: agent.model });
    const prompt = buildPrompt(agent, snapshot, position);

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const parsed = JSON.parse(jsonMatch[0]);
    return validateDecision(parsed, agent);
  } catch (err: any) {
    console.error(`Gemini call failed for ${agent.name}:`, err.message);
    return null;
  }
}

// ============================================================================
// Validation — ensure LLM output is safe
// ============================================================================

function validateDecision(raw: any, agent: AgentConfig): AgentDecision | null {
  // Validate action
  const action = raw.action?.toLowerCase();
  if (!["buy", "sell", "hold"].includes(action)) return null;

  // Validate and clamp amount
  let amount = parseInt(raw.amount) || 0;
  if (action === "hold") amount = 0;
  if (amount < 0) amount = 0;
  if (amount > agent.maxTradeSize) amount = agent.maxTradeSize;

  // Validate and clamp confidence
  let confidence = parseInt(raw.confidence) || 50;
  if (confidence < 0) confidence = 0;
  if (confidence > 100) confidence = 100;

  // Validate reasoning
  const reasoning = typeof raw.reasoning === "string" && raw.reasoning.length > 0
    ? raw.reasoning
    : `${agent.name}: decision made based on current market conditions.`;

  return { action, side: "SOL", amount, confidence, reasoning };
}

// ============================================================================
// Deterministic Fallback — no randomness, reproducible
// ============================================================================

function deterministicFallback(
  agent: AgentConfig,
  snapshot: MarketSnapshot
): AgentDecision {
  const { momentum, sma10, sma30, price, volatility } = snapshot;

  let action: "buy" | "sell" | "hold" = "hold";
  let amount = 0;
  let confidence = 45;
  let reasoning = "";

  switch (agent.name) {
    case "Momentum Agent":
      if (momentum > 0.01 && price > sma10) {
        action = "buy";
        amount = 10;
        confidence = 55 + Math.min(30, Math.floor(Math.abs(momentum) * 1000));
        reasoning = `Fallback: Positive momentum (${(momentum * 100).toFixed(2)}%), price above SMA10. Buying.`;
      } else if (momentum < -0.01 && price < sma10) {
        action = "sell";
        amount = 8;
        confidence = 50 + Math.min(30, Math.floor(Math.abs(momentum) * 1000));
        reasoning = `Fallback: Negative momentum (${(momentum * 100).toFixed(2)}%), price below SMA10. Selling.`;
      } else {
        confidence = 40;
        reasoning = `Fallback: Mixed momentum signals. Holding.`;
      }
      break;

    case "Mean Reversion Agent": {
      const deviation = (price - sma30) / sma30;
      if (deviation < -0.02) {
        action = "buy";
        amount = 8;
        confidence = 55 + Math.min(30, Math.floor(Math.abs(deviation) * 500));
        reasoning = `Fallback: Price ${(deviation * 100).toFixed(2)}% below SMA30. Buying the dip.`;
      } else if (deviation > 0.02) {
        action = "sell";
        amount = 6;
        confidence = 50 + Math.min(30, Math.floor(Math.abs(deviation) * 500));
        reasoning = `Fallback: Price ${(deviation * 100).toFixed(2)}% above SMA30. Selling the rip.`;
      } else {
        confidence = 40;
        reasoning = `Fallback: Price near SMA30. Holding.`;
      }
      break;
    }

    case "Risk-Off Agent":
      if (volatility < 0.005 && momentum > 0.005) {
        action = "buy";
        amount = 3;
        confidence = 50;
        reasoning = `Fallback: Low volatility (${(volatility * 100).toFixed(3)}%), slight uptrend. Small buy.`;
      } else if (volatility > 0.02 || momentum < -0.02) {
        action = "sell";
        amount = 5;
        confidence = 55;
        reasoning = `Fallback: High volatility or downtrend. Risk-off sell.`;
      } else {
        confidence = 45;
        reasoning = `Fallback: Conditions uncertain. Holding (risk-off default).`;
      }
      break;

    default:
      confidence = 30;
      reasoning = `Fallback: Unknown agent. Holding.`;
  }

  return { action, side: "SOL", amount, confidence, reasoning };
}

// ============================================================================
// Runtime mode detection
// ============================================================================

export type AIMode = "gemini-live" | "deterministic-fallback";

export function getAIMode(): AIMode {
  if (config.geminiApiKey) return "gemini-live";
  return "deterministic-fallback";
}

// ============================================================================
// Public API
// ============================================================================

export async function runAgent(
  strategyName: string,
  snapshot: MarketSnapshot,
  position?: PositionState | null
): Promise<AgentDecision> {
  const agent = AGENT_CONFIGS.find((a) => a.name === strategyName);
  if (!agent) throw new Error(`Unknown agent: ${strategyName}`);

  // Try Gemini first
  const aiDecision = await geminiDecision(agent, snapshot, position || null);
  if (aiDecision) {
    return aiDecision;
  }

  // Fallback — deterministic, no randomness
  return deterministicFallback(agent, snapshot);
}
