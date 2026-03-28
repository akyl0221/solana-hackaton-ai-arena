# Plan: Replace Fallback Logic with Real AI Agent Runtime

## Summary

- Current runtime is only partially AI-driven: deterministic strategies choose `action/amount`, while Anthropic optionally adds `confidence/reasoning`; without API key the system falls back to heuristic text and random-ish confidence.
- Target state: move to a **hybrid AI runtime** where the LLM becomes the primary decision engine for `action`, `amount`, `confidence`, and `reasoning`, but remains constrained by a strict schema, bounded prompts, and the existing on-chain gate.
- This preserves the architecture's core promise: AI makes a real decision, Solana records and gates it, and the system remains demo-safe even if the model degrades or the provider fails.

## Implementation Changes

### 1. Introduce a real agent decision contract

- Replace the current `AgentSignal -> llmConfidence -> AgentDecision` pipeline with `AgentContext -> llmDecision -> validated AgentDecision`.
- Keep the public decision shape minimal and stable:
  - `action: buy | sell | hold`
  - `side: SOL`
  - `amount: number`
  - `confidence: number`
  - `reasoning: string`
- Add an internal validation layer before anything reaches Solana:
  - clamp `confidence` to `0-100`
  - reject invalid `action`
  - normalize `amount` to non-negative numeric size
  - cap `amount` to agent-level `maxTradeSize`
  - if output is malformed, fall back to safe `hold`
- Keep `runAgent(strategyName, snapshot)` as the backend entrypoint so the rest of the runtime does not need a broad refactor.

### 2. Replace deterministic action generation with LLM-first agent profiles

- Convert each current agent into a prompt-defined persona instead of a hardcoded strategy function:
  - Momentum Agent
  - Mean Reversion Agent
  - Risk-Off Agent
- Feed the LLM the same structured market snapshot for all agents:
  - price
  - sma10 / sma30
  - momentum
  - volatility
  - recent price history
  - current on-chain position state for that agent
  - agent-level trade limits
- Require the model to output strict JSON only, with one decision object per call.
- Keep deterministic heuristics only as a **fallback mode**, not the primary source of action selection.
- Chosen default: Anthropic remains the primary provider because the repo is already wired for it; do not add a second provider in this phase unless there is a clear runtime need.

### 3. Make agent decisions architecture-safe

- Preserve the current hybrid safety model even though the LLM now chooses the action:
  - backend validation first
  - on-chain `submit_decision` gate second
  - on-chain `execute_decision` only if approved
- Extend the prompt so each agent is explicitly bounded:
  - no leverage
  - no shorts
  - only `SOL`
  - only bounded amounts
  - prefer `hold` when uncertainty is high
- Add a backend "safe decision builder" path:
  - if provider unavailable
  - if JSON parse fails
  - if reasoning is empty
  - if amount is nonsensical
  then emit a deterministic `hold` with medium-low confidence and explicit fallback reasoning.
- Remove `Math.random()` from fallback behavior so demo outcomes remain reproducible and auditable.

### 4. Add provider abstraction and failure handling

- Introduce a small AI provider interface in backend:
  - `generateDecision(agentProfile, snapshot, positionState) -> AgentDecision`
- Implement one concrete provider first:
  - `AnthropicDecisionProvider`
- Keep provider initialization in config/startup:
  - if `ANTHROPIC_API_KEY` exists, run real AI mode
  - otherwise run deterministic safe fallback mode
- Log mode explicitly at startup:
  - `AI mode: anthropic-live`
  - `AI mode: deterministic-fallback`
- Do not silently market fallback mode as "AI" in logs or README.

### 5. Update docs and demo framing

- Update architecture text so the agent section reflects the new runtime:
  - LLM now generates the structured decision
  - backend validates it
  - on-chain gate remains the final policy layer
- Update README to describe two runtime modes honestly:
  - live AI mode with Anthropic
  - safe fallback mode without API key
- Adjust judge/demo script:
  - show one live cycle in real AI mode
  - highlight that decisions are model-generated but still constrained by explicit guardrails and on-chain gate
- Keep the pitch grounded:
  - "AI proposes structured actions"
  - "Solana enforces execution policy"
  - not "fully autonomous trading bot"

## Public Interfaces / Types

- Keep the on-chain interface unchanged for this phase.
- Backend internal interfaces change:
  - `runAgent(...)` becomes LLM-first instead of deterministic-first
  - introduce a provider abstraction for decision generation
  - add a validated fallback path returning a proper `AgentDecision`
- Optional config additions:
  - `AI_MODE=live|fallback|auto` if explicit mode control is needed
  - otherwise default to `auto` based on presence of `ANTHROPIC_API_KEY`

## Test Plan

- Unit tests:
  - valid model JSON becomes a normalized `AgentDecision`
  - malformed JSON falls back to safe `hold`
  - oversized `amount` is clamped or rejected into safe fallback
  - confidence outside range is normalized
  - fallback mode is deterministic and does not use randomness
- Provider integration tests:
  - Anthropic provider handles successful JSON response
  - Anthropic provider handles timeout/error and returns safe fallback
- Runtime tests:
  - one cycle in live AI mode produces model-generated action/confidence/reasoning
  - one cycle without API key still completes with safe fallback decisions
  - submitted decisions still pass through existing on-chain gate and execution flow
- Demo acceptance:
  - logs clearly show whether runtime is in live AI or fallback mode
  - frontend reasoning remains readable and persists through SQLite lifecycle
  - blocked and approved decisions still appear correctly in the feed

## Assumptions

- Chosen target is `Hybrid`: the LLM becomes the primary decision-maker, but backend validation and on-chain gate remain mandatory.
- Anthropic is the only live provider in this phase because it is already integrated.
- No attempt is made in this phase to train a custom model or add embeddings/RAG.
- No attempt is made in this phase to let users create arbitrary agents; only the 3 built-in personas are upgraded.
- Safe fallback remains required so the demo still works when the API key is missing or the provider is down.
