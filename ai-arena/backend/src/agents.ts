import { MarketSnapshot } from "./market";
import { config } from "./config";
import { ModelProvider, resolveLiveModelProvider } from "./model-providers";

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

export interface AgentPositionContext {
  currentSide: "flat" | "long";
  currentSize: number;
  averageEntryPrice: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalExecuted: number;
}

interface AgentRuntimeContext {
  agent: AgentConfig;
  snapshot: MarketSnapshot;
  position: AgentPositionContext;
}

interface DecisionProvider {
  readonly mode: string;
  generateDecision(context: AgentRuntimeContext): Promise<AgentDecision>;
}

interface RawDecision {
  action?: string;
  side?: string;
  amount?: number;
  confidence?: number;
  reasoning?: string;
}

const DEFAULT_FALLBACK_CONFIDENCE = 45;
const HOLD_REASONING =
  "Safe fallback mode: unable to obtain a valid AI decision, so the agent holds position.";

const AGENT_CONFIGS: AgentConfig[] = [
  {
    id: 1,
    name: "Momentum Agent",
    model: "claude-haiku",
    maxTradeSize: 50,
    maxPositionSize: 250,
    persona:
      "You are a momentum trader. Prefer buying only when price action and short-term direction are aligned. Sell or reduce only when momentum clearly turns negative. Hold when the edge is weak.",
  },
  {
    id: 2,
    name: "Mean Reversion Agent",
    model: "claude-haiku",
    maxTradeSize: 30,
    maxPositionSize: 150,
    persona:
      "You are a mean reversion trader. Prefer buying oversold conditions below average and selling overextended moves above average. Hold when the market sits near fair value.",
  },
  {
    id: 3,
    name: "Risk-Off Agent",
    model: "claude-haiku",
    maxTradeSize: 20,
    maxPositionSize: 60,
    persona:
      "You are a defensive risk manager. Prefer small exposure when volatility is calm and cut risk quickly during stressed or fast-falling conditions. Hold whenever uncertainty dominates.",
  },
];

let provider: DecisionProvider | null = null;

function normalizeAction(action?: string): AgentDecision["action"] {
  if (action === "buy" || action === "sell" || action === "hold") return action;
  return "hold";
}

function normalizeSide(side?: string): AgentDecision["side"] {
  if (side === "SOL") return side;
  return "SOL";
}

function normalizeConfidence(confidence?: number): number {
  if (!Number.isFinite(confidence)) return DEFAULT_FALLBACK_CONFIDENCE;
  return Math.max(0, Math.min(100, Math.round(confidence!)));
}

function normalizeAmount(amount?: number): number {
  if (!Number.isFinite(amount) || amount! < 0) return 0;
  return Math.round(amount! * 1000) / 1000;
}

function safeHold(reasoning: string): AgentDecision {
  return {
    action: "hold",
    side: "SOL",
    amount: 0,
    confidence: DEFAULT_FALLBACK_CONFIDENCE,
    reasoning,
  };
}

function buildDecisionPrompt(context: AgentRuntimeContext): string {
  const { agent, snapshot, position } = context;
  return `You are ${agent.name}, an AI trading agent for a Solana hackathon demo.

${agent.persona}

You must make exactly one bounded decision for SOL/USDC.

Hard constraints:
- You may only return one of: buy, sell, hold
- Side must always be SOL
- No leverage
- No shorts
- Never exceed max trade size of ${agent.maxTradeSize} SOL
- Current position size is ${position.currentSize.toFixed(3)} SOL
- Max position size is ${agent.maxPositionSize} SOL
- If uncertainty is high, prefer hold
- Return valid JSON only

Current market snapshot:
- Price: $${snapshot.price.toFixed(2)}
- SMA(10): $${snapshot.sma10.toFixed(2)}
- SMA(30): $${snapshot.sma30.toFixed(2)}
- Momentum: ${(snapshot.momentum * 100).toFixed(3)}%
- Volatility: ${(snapshot.volatility * 100).toFixed(3)}%
- Recent prices: ${snapshot.priceHistory.map((p) => p.toFixed(2)).join(", ")}

Current on-chain position:
- Side: ${position.currentSide}
- Size: ${position.currentSize.toFixed(3)} SOL
- Average entry price: $${position.averageEntryPrice.toFixed(2)}
- Realized PnL: ${position.realizedPnl.toFixed(2)}
- Unrealized PnL: ${position.unrealizedPnl.toFixed(2)}
- Total executed decisions: ${position.totalExecuted}

Respond with JSON only:
{"action":"buy|sell|hold","side":"SOL","amount":<number>,"confidence":<0-100>,"reasoning":"2-3 concise sentences"}`;
}

function parseJsonDecision(text: string): RawDecision {
  const trimmed = text.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("Model returned non-JSON output");
  }
}

function validateDecision(raw: RawDecision, context: AgentRuntimeContext): AgentDecision {
  const action = normalizeAction(raw.action);
  const side = normalizeSide(raw.side);
  let amount = normalizeAmount(raw.amount);
  let confidence = normalizeConfidence(raw.confidence);
  let reasoning = (raw.reasoning || "").trim();

  if (!reasoning) {
    return safeHold(HOLD_REASONING);
  }

  amount = Math.min(amount, context.agent.maxTradeSize);

  const remainingCapacity = Math.max(
    0,
    context.agent.maxPositionSize - context.position.currentSize
  );

  if (action === "buy") {
    amount = Math.min(amount, remainingCapacity);
    if (amount <= 0) {
      return safeHold(
        `${context.agent.name}: buy decision reduced to hold because max position size has already been reached.`
      );
    }
  }

  if (action === "sell") {
    amount = Math.min(amount, context.position.currentSize);
    if (amount <= 0) {
      return safeHold(
        `${context.agent.name}: sell decision reduced to hold because there is no open long position to reduce.`
      );
    }
  }

  if (action === "hold") {
    amount = 0;
    confidence = Math.max(confidence, 40);
  }

  return {
    action,
    side,
    amount,
    confidence,
    reasoning,
  };
}

function deterministicSignal(context: AgentRuntimeContext): RawDecision {
  const { snapshot, position, agent } = context;
  const { momentum, sma10, sma30, price, volatility } = snapshot;
  const deviation = (price - sma30) / sma30;

  if (agent.name === "Momentum Agent") {
    if (momentum > 0.01 && price > sma10 && position.currentSize < agent.maxPositionSize) {
      return {
        action: "buy",
        side: "SOL",
        amount: Math.min(agent.maxTradeSize, 10),
        confidence: 72 + Math.min(18, Math.round(momentum * 1000)),
        reasoning:
          `${agent.name}: deterministic fallback sees strong upside momentum with price above SMA10, so it adds exposure within configured limits.`,
      };
    }
    if (momentum < -0.01 && price < sma10 && position.currentSize > 0) {
      return {
        action: "sell",
        side: "SOL",
        amount: Math.min(position.currentSize, Math.min(agent.maxTradeSize, 8)),
        confidence: 68 + Math.min(20, Math.round(Math.abs(momentum) * 1000)),
        reasoning:
          `${agent.name}: deterministic fallback sees downside momentum with price below SMA10, so it reduces the current long position.`,
      };
    }
  }

  if (agent.name === "Mean Reversion Agent") {
    if (deviation < -0.02 && position.currentSize < agent.maxPositionSize) {
      return {
        action: "buy",
        side: "SOL",
        amount: Math.min(agent.maxTradeSize, 8),
        confidence: 70 + Math.min(15, Math.round(Math.abs(deviation) * 1000)),
        reasoning:
          `${agent.name}: deterministic fallback sees price materially below SMA30 and treats it as a buy-the-dip setup.`,
      };
    }
    if (deviation > 0.02 && position.currentSize > 0) {
      return {
        action: "sell",
        side: "SOL",
        amount: Math.min(position.currentSize, Math.min(agent.maxTradeSize, 6)),
        confidence: 66 + Math.min(16, Math.round(Math.abs(deviation) * 1000)),
        reasoning:
          `${agent.name}: deterministic fallback sees price stretched above SMA30 and trims exposure into strength.`,
      };
    }
  }

  if (agent.name === "Risk-Off Agent") {
    if (
      volatility < 0.005 &&
      momentum > 0.005 &&
      position.currentSize < agent.maxPositionSize
    ) {
      return {
        action: "buy",
        side: "SOL",
        amount: Math.min(agent.maxTradeSize, 3),
        confidence: 64,
        reasoning:
          `${agent.name}: deterministic fallback sees calm volatility and mild positive drift, so it opens only a small defensive long.`,
      };
    }
    if ((volatility > 0.02 || momentum < -0.02) && position.currentSize > 0) {
      return {
        action: "sell",
        side: "SOL",
        amount: Math.min(position.currentSize, Math.min(agent.maxTradeSize, 5)),
        confidence: 78,
        reasoning:
          `${agent.name}: deterministic fallback sees stressed conditions and exits risk to protect capital.`,
      };
    }
  }

  return {
    action: "hold",
    side: "SOL",
    amount: 0,
    confidence: 58,
    reasoning:
      `${agent.name}: deterministic fallback does not see a strong bounded edge in the current snapshot, so it holds position.`,
  };
}

class FallbackDecisionProvider implements DecisionProvider {
  readonly mode = "deterministic-fallback";

  async generateDecision(context: AgentRuntimeContext): Promise<AgentDecision> {
    return validateDecision(deterministicSignal(context), context);
  }
}

class LLMDecisionProvider implements DecisionProvider {
  readonly mode: string;
  private readonly modelProvider: ModelProvider;

  constructor(modelProvider: ModelProvider) {
    this.modelProvider = modelProvider;
    this.mode = modelProvider.name;
  }

  async generateDecision(context: AgentRuntimeContext): Promise<AgentDecision> {
    const prompt = buildDecisionPrompt(context);
    const text = await this.modelProvider.generateJson(prompt);
    const parsed = parseJsonDecision(text);
    return validateDecision(parsed, context);
  }
}

function buildProvider(): DecisionProvider {
  if (config.aiMode === "fallback") {
    return new FallbackDecisionProvider();
  }

  const modelProvider = resolveLiveModelProvider();
  if (modelProvider) {
    return new LLMDecisionProvider(modelProvider);
  }

  return new FallbackDecisionProvider();
}

function getProvider(): DecisionProvider {
  if (!provider) {
    provider = buildProvider();
  }
  return provider;
}

export function getAiRuntimeMode(): string {
  return getProvider().mode;
}

export async function runAgent(
  agent: AgentConfig,
  snapshot: MarketSnapshot,
  position: AgentPositionContext
): Promise<AgentDecision> {
  const context: AgentRuntimeContext = { agent, snapshot, position };
  const activeProvider = getProvider();

  if (!activeProvider.mode.endsWith("-live")) {
    return activeProvider.generateDecision(context);
  }

  try {
    return await activeProvider.generateDecision(context);
  } catch (err) {
    console.error(`Live AI decision failed for ${agent.name}:`, err);
    return safeHold(
      `${agent.name}: live AI provider failed, so the runtime switched this cycle to a safe hold decision.`
    );
  }
}

export { AGENT_CONFIGS };
