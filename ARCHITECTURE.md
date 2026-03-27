# AI Arena Architecture

## Purpose

This document describes the technical architecture for the hackathon MVP of **AI Arena + PoI Gate**.

The system is intentionally narrow.

It is designed to prove one thing well:

`AI decision -> on-chain record -> confidence gate -> guarded execution -> outcome tracking`

This is not a production trading platform.

---

## System Summary

The product has two layers:

### 1. Product Layer: AI Arena

This is the user-facing system:

- pre-built AI agents
- market decision cycles
- execution feed
- leaderboard
- agent comparison UI

### 2. Trust Layer: PoI Gate

This is the execution control and audit system:

- structured decision recording
- reasoning hash anchoring
- confidence-based gating
- execution permission or rejection
- outcome recording

The user experiences one product, but technically the trust layer sits between agent output and execution.

---

## Top-Level Components

### Frontend

Responsibilities:

- render arena dashboard
- show agent states
- show decision feed
- show execution and gate results
- show off-chain leaderboard

Recommended stack:

- Next.js
- Tailwind
- Solana Wallet Adapter

### Backend API

Responsibilities:

- expose arena state to frontend
- trigger agent cycle manually for demo
- return indexed decision and execution history
- expose leaderboard data

Recommended stack:

- Node.js
- TypeScript

### Agent Runtime

Responsibilities:

- fetch market snapshot
- run agent logic
- produce structured decision payload
- submit decision transaction
- trigger gate evaluation
- trigger execution when approved

### Market Data Service

Responsibilities:

- fetch or normalize `SOL/USDC` market data
- compute indicators for all agents
- generate a canonical market snapshot for each cycle

### Indexer / Read Model

Responsibilities:

- index on-chain decision and execution accounts
- compute leaderboard metrics
- serve query-friendly data to frontend

### Solana Program

Responsibilities:

- store arena state
- register agents
- record decisions
- evaluate gate rules
- record executions and outcomes

---

## High-Level Data Flow

### Decision Cycle

1. backend requests a fresh market snapshot
2. market data service normalizes the snapshot
3. agent runtime sends the same snapshot to all agents
4. each agent returns a structured decision
5. backend submits `record_decision`
6. backend submits `evaluate_gate`
7. if gate passes, backend submits `execute_decision`
8. backend submits `record_outcome`
9. indexer updates leaderboard
10. frontend renders updated state

### Why this flow is correct for the hackathon

- AI output exists before on-chain change
- the contract records the decision before execution
- the gate is explicit and visible
- blocked decisions still become part of the audit trail

---

## On-Chain Design

### Core Accounts

#### ArenaState

Purpose:

- top-level arena configuration

Suggested fields:

- authority
- active pair
- cycle counter
- active agents count
- default min confidence
- default max trade size
- cooldown seconds

#### AgentProfile

Purpose:

- one record per pre-built agent

Suggested fields:

- arena
- agent id
- strategy name
- model id
- status
- max trade size
- last decision timestamp

#### DecisionRecord

Purpose:

- one on-chain record for one agent decision

Suggested fields:

- arena
- agent
- cycle id
- input hash
- action
- side
- amount
- confidence
- reasoning hash
- gate status
- created at

#### ConfidenceGate

Purpose:

- explicit policy account for gate evaluation

Suggested fields:

- arena
- min confidence
- max trade size
- allowed actions bitmask or enum set
- block low confidence
- block oversize orders

#### ExecutionRecord

Purpose:

- one record for attempted or completed execution

Suggested fields:

- decision
- executed flag
- blocked flag
- execution price
- resulting position delta
- pnl delta
- timestamp

### Important Solana Constraint

Do not use unbounded vectors like:

- `decisions[]`
- `executions[]`
- `investors[]`

Every decision and execution must be a separate PDA-derived record.

This keeps the account model realistic and reviewable.

---

## Program Instructions

### `initialize_arena`

Creates:

- `ArenaState`
- `ConfidenceGate`

### `register_agent`

Creates:

- `AgentProfile`

Used only for the fixed set of pre-built agents.

### `record_decision`

Creates:

- `DecisionRecord`

Stores:

- structured action
- confidence
- input hash
- reasoning hash

This instruction should not execute any trade.

### `evaluate_gate`

Reads:

- `DecisionRecord`
- `ConfidenceGate`
- `AgentProfile`

Writes:

- gate result into `DecisionRecord`

Possible results:

- `Approved`
- `BlockedLowConfidence`
- `BlockedRiskLimit`
- `BlockedInvalidAction`

### `execute_decision`

Reads:

- approved `DecisionRecord`

Creates:

- `ExecutionRecord`

This instruction should only execute a bounded action.

For MVP it may:

- call a mock execution path
- or record a deterministic simulated execution

### `record_outcome`

Writes final measurable result:

- execution result
- pnl delta
- optional success/failure flag

---

## Off-Chain Design

### Agent Strategy Layer

Use 2-3 agents only.

Recommended agents:

- `Momentum Agent`
- `Mean Reversion Agent`
- `Risk-Off Agent`

### Agent Implementation Strategy

Recommended implementation:

- deterministic signal generation
- LLM used for structured explanation and final action formatting

Why this is safer:

- better reproducibility
- lower risk of malformed outputs
- easier demo control

### Structured Decision Schema

All agents must return the same JSON shape:

```json
{
  "action": "buy",
  "side": "SOL",
  "amount": 10,
  "confidence": 84,
  "summary": "Momentum remains positive on the latest interval."
}
```

Validation rules:

- `action` must be one of allowed values
- `amount` must be numeric and bounded
- `confidence` must be `0..100`
- invalid schema becomes blocked before execution

### Reasoning Storage

Store:

- full explanation off-chain
- explanation hash on-chain

This keeps on-chain state compact but still auditable.

---

## Execution Model

### Preferred MVP Mode

Use deterministic simulated execution.

Meaning:

- execution uses the current market snapshot price
- the contract records the action and resulting state
- no dependency on unstable live swap routing during demo

### Why this is preferred

- fewer external failures
- more stable demo
- still satisfies the hackathon requirement because AI decisions drive on-chain state changes

### Alternative Mode

If the team has extra time:

- add one real devnet swap path
- keep simulated execution as fallback

---

## Leaderboard Design

Leaderboard must remain off-chain.

### Inputs

- decision records
- execution records
- blocked decision counts

### Metrics

- total decisions
- gate pass rate
- blocked rate
- executed decisions
- realized pnl
- last action time

### Why off-chain

- no reason to pay on-chain costs for read-heavy ranking logic
- easier to iterate and explain
- avoids a fake on-chain feature that adds no value

---

## Frontend Information Architecture

### Arena Dashboard

Shows:

- agent cards
- recent decisions
- recent blocked decisions
- leaderboard

### Agent Details

Shows:

- strategy description
- current status
- decision timeline
- gate results
- execution history

### Decision Feed

Each event should show:

- agent
- action
- confidence
- gate result
- executed or blocked
- timestamp

This feed is central to the product story.

---

## Demo Topology

### Minimal Deployment Setup

- Solana Devnet
- one deployed Anchor program
- one backend service
- one frontend app
- one small indexer process

### Demo Control

Add one manual trigger:

- `Run Next Cycle`

This button should:

- fetch market snapshot
- run all agents
- submit decisions
- evaluate gate
- execute approved actions
- refresh UI

This reduces demo randomness.

---

## Failure Modes

### Invalid AI Output

Handling:

- reject at schema validation layer
- optionally write blocked record with reason

### Low Confidence

Handling:

- record decision
- mark blocked by gate
- do not execute

### Oversized Action

Handling:

- record decision
- mark blocked by risk rule
- do not execute

### RPC Failure

Handling:

- retry once or twice
- show pending state in UI
- do not fake success

### Market Data Failure

Handling:

- use last valid snapshot with stale marker
- or skip cycle cleanly

### LLM Failure

Handling:

- skip that agent cycle
- show agent error state
- continue processing other agents

---

## Security and Safety Constraints

For MVP:

- no leverage
- no short positions
- no external user funds
- no dynamic agent uploads
- bounded order size per agent
- cooldown between decisions

This is essential for keeping the system believable and safe.

---

## Build Priorities

### Priority 1

- on-chain decision recording
- confidence gate
- structured agent output

### Priority 2

- deterministic execution
- execution records
- decision feed UI

### Priority 3

- leaderboard
- charts
- visual polish

If time gets tight, never sacrifice the core decision-to-gate-to-record loop for cosmetic features.

---

## Review Questions

When giving this document to reviewers, ask them to focus on:

- whether the on-chain account model is realistic
- whether the scope is small enough for the deadline
- whether simulated execution is acceptable for the demo
- whether the PoI Gate boundary is clear enough
- whether any unnecessary complexity remains

---

## Final Positioning

The architecture should be presented as:

**a compact Solana system for transparent, bounded AI execution**

not as:

- a fully autonomous hedge fund
- a generalized AI protocol standard
- a production trading platform

---

## Architecture Review Notes

Independent review of the architecture with concrete issues, risks, and improvements.

Organized by severity: **critical** (blocks demo or loses major points), **important** (weakens the submission), **nice-to-have** (polish if time allows).

---

### Critical

#### R1. PDA seeds are not defined

The document says "PDA-derived records" but never specifies the seeds. This is the first thing needed for implementation and the most common source of bugs.

Recommended seeds:

```
ArenaState:       ["arena", authority]
AgentProfile:     ["agent", arena, agent_id (u64 bytes)]
DecisionRecord:   ["decision", arena, agent, cycle_id (u64 bytes)]
ConfidenceGate:   ["gate", arena]
ExecutionRecord:  ["execution", decision]
```

Why this matters:

- `DecisionRecord` keyed on `[arena, agent, cycle_id]` guarantees one decision per agent per cycle — enforced at the protocol level, not just off-chain
- `ExecutionRecord` keyed on `[decision]` guarantees one execution attempt per decision
- Without defined seeds, two developers will implement different PDA schemes and break each other's work

#### R2. Three transactions per decision is too slow for demo

Current flow per agent: `record_decision` → `evaluate_gate` → `execute_decision` = 3 transactions.

For 3 agents per cycle = 9 transactions. At ~400ms confirmation each on devnet = **3.6 seconds minimum**, often 5-8 seconds with network jitter.

During a live demo with the "Run Next Cycle" button, the audience will watch a spinner for 5-8 seconds. That's too long.

Recommended fix:

Merge `record_decision` + `evaluate_gate` into a single instruction `submit_decision`. One transaction records the decision AND evaluates the gate atomically. Then `execute_decision` is a second transaction only if gate passes.

New flow per agent: `submit_decision` → (if approved) `execute_decision` = 1-2 transactions.
For 3 agents: 3-6 transactions = **1.2-2.4 seconds**. Much better for demo.

The audit trail is identical — the DecisionRecord still stores action, confidence, reasoning_hash, AND gate_status in one atomic write.

#### R3. Access control is undefined

Who can call each instruction? The document never specifies signers.

If anyone can call `record_decision` or `execute_decision`, the system has no integrity.

Recommended access model:

```
initialize_arena:   authority (deployer)
register_agent:     authority
submit_decision:    agent_authority (backend wallet designated per agent, or global operator)
execute_decision:   operator (same backend wallet)
record_outcome:     operator
```

The `agent_authority` or `operator` should be a field on `ArenaState`. This is simple but must be explicit in the contract.

#### R4. Account sizes not estimated

Anchor requires fixed account sizes at `init`. Strings like `strategy_name` and `model_id` need max lengths.

Estimated sizes:

```
ArenaState:       8 (discriminator) + 32 (authority) + 32 (operator) + 4+12 (pair string, max 12)
                  + 8 (cycle_counter) + 1 (agents_count) + 1 (min_confidence)
                  + 8 (max_trade_size) + 8 (cooldown) + 1 (bump) = ~115 bytes

AgentProfile:     8 + 32 (arena) + 8 (agent_id) + 4+32 (strategy_name)
                  + 4+32 (model_id) + 1 (status) + 8 (max_trade_size)
                  + 8 (last_decision_ts) + 1 (bump) = ~138 bytes

DecisionRecord:   8 + 32 (arena) + 32 (agent) + 8 (cycle_id) + 32 (input_hash)
                  + 1 (action enum) + 1 (side enum) + 8 (amount) + 1 (confidence)
                  + 32 (reasoning_hash) + 1 (gate_status enum) + 8 (price_at_decision)
                  + 8 (created_at) + 1 (bump) = ~173 bytes

ExecutionRecord:  8 + 32 (decision) + 1 (executed) + 1 (blocked) + 8 (exec_price)
                  + 8 (position_delta) + 8 (pnl_delta) + 8 (timestamp) + 1 (bump) = ~75 bytes

ConfidenceGate:   8 + 32 (arena) + 1 (min_confidence) + 8 (max_trade_size)
                  + 1 (allowed_actions bitmask) + 1 (bump) = ~51 bytes
```

Each DecisionRecord costs ~0.002 SOL rent. 3 agents × 50 cycles = 150 accounts = ~0.3 SOL. Fine for devnet, but should be known.

---

### Important

#### R5. Decision JSON schema is missing `price_at_decision`

Current schema:

```json
{
  "action": "buy",
  "side": "SOL",
  "amount": 10,
  "confidence": 84,
  "summary": "..."
}
```

Problem: without `price_at_decision`, PnL cannot be calculated later. The execution price alone isn't enough — you need the reference price to show "agent decided to buy at $145, execution filled at $145.20, outcome at $148 = +$2.80".

Fixed schema:

```json
{
  "action": "buy",
  "side": "SOL",
  "amount": 10,
  "confidence": 84,
  "price": 145.00,
  "summary": "Momentum remains positive on the latest interval."
}
```

This `price` should also be stored on-chain in DecisionRecord for full auditability.

#### R6. Hybrid agent logic split is underspecified

The document says "deterministic signal generation + LLM for structured explanation" but doesn't define the boundary.

Recommended split:

```
Deterministic layer (no LLM):
  - compute indicators from market snapshot
  - generate signal: { action: buy/sell/hold, amount: N }

LLM layer:
  - receives: signal + market data + agent persona
  - returns: { confidence: 0-100, reasoning: string }
```

Why this split:

- The action is deterministic → demo is reproducible and controllable
- The confidence comes from LLM → the gate has real variance (some get blocked, some pass)
- The reasoning comes from LLM → readable audit trail
- If LLM fails, you still have the signal → graceful degradation (use default confidence=50)

This is important because if LLM generates the action itself, you risk:
- malformed outputs killing the demo
- all 3 agents making the same decision (LLMs tend to converge)
- no visible difference between agent strategies

#### R7. Indexer strategy is not specified

"Index on-chain decision and execution accounts" — how?

Options:

1. **RPC polling** — `getProgramAccounts` with filters every few seconds. Simple. Works for MVP with <500 accounts. This is the right choice.
2. **WebSocket subscription** — `onProgramAccountChange`. More reactive but more complex. Overkill for MVP.
3. **Geyser plugin** — production-grade. Not for hackathon.

Recommendation: use `getProgramAccounts` with memcmp filters on account type discriminator. Refresh every 3 seconds or on-demand after cycle completion.

#### R8. No mention of reasoning storage location

Reasoning hash goes on-chain, but the full text needs to live somewhere.

For MVP, simplest option: **in-memory store or SQLite on the backend**. The backend already has the reasoning text when the agent produces it. Store it keyed by `decision PDA pubkey`. Frontend fetches it from backend API.

Do not use IPFS or Arweave for MVP — it adds complexity and latency with zero hackathon points.

#### R9. `record_outcome` timing and trigger are unclear

When does outcome get recorded? The document says "final measurable result" but doesn't say when or how.

Recommended approach for MVP:

- Outcome = price delta from decision price to next cycle's price
- `record_outcome` is called at the START of the next cycle for the PREVIOUS cycle's decisions
- This gives a clean 1-cycle lookback window

Flow:
```
Cycle N:
  1. record_outcome for Cycle N-1 decisions (using current price)
  2. submit_decision for Cycle N
  3. execute approved decisions
```

#### R10. Pyth on-chain price feed adds Solana depth points

Currently market data is fully off-chain (Jupiter API / mock). This works but leaves points on the table for "Use of Solana (15 pts)".

Low-cost improvement: read Pyth SOL/USD price feed in `execute_decision` instruction. Pass the Pyth price account as a remaining account, read and validate the price on-chain.

This adds:
- real oracle integration (judges love this)
- on-chain price verification (not just trusting the backend)
- ~20 lines of Rust code

Pyth devnet SOL/USD feed exists and is reliable.

---

### Nice-to-Have

#### R11. Pre-seed historical data for richer demo

Starting the demo cold (0 decisions) makes the dashboard look empty. Consider pre-running 5-10 cycles before the demo so there's already:

- decision history visible
- leaderboard with differentiated scores
- some blocked decisions in the feed

The "Run Next Cycle" button then adds a live decision on top of existing history.

#### R12. Show Solana Explorer links in decision feed

Each DecisionRecord and ExecutionRecord is an on-chain transaction. Show the transaction signature as a clickable link to Solana Explorer (devnet).

This is a powerful "proof moment" for judges: click → see the actual on-chain data. Takes 30 minutes to implement but scores well on "Use of Solana" and "Demo & Presentation".

#### R13. Add `cycle_id` to market snapshot

The market snapshot should include a `cycle_id` that matches the on-chain cycle counter. This creates a provable link between "what data the AI saw" and "what the contract recorded."

#### R14. Frontend should show the gate evaluation visually

When a decision goes through the gate, show it as a visual step:

```
[Decision] → [Gate Check: confidence 84 >= 70? ✓] → [Executed] → [Result: +$2.30]
[Decision] → [Gate Check: confidence 42 >= 70? ✗] → [Blocked]
```

This visual makes the PoI Gate layer tangible to judges in 2 seconds.

#### R15. Consider `close` instruction for account cleanup

After demo, hundreds of PDA accounts will hold rent. A `close_decision` instruction that refunds rent to authority keeps things tidy. Not required for MVP but shows Solana maturity.

#### R16. Program should be deployed with upgrade authority

For hackathon iteration speed, keep upgrade authority on devnet. This allows redeploying without changing the program ID. Obvious for experienced Solana devs but worth noting for the team.

---

### Summary of Recommended Changes

| # | Change | Severity | Effort |
|---|--------|----------|--------|
| R1 | Define PDA seeds | Critical | 30 min |
| R2 | Merge record_decision + evaluate_gate | Critical | 2 hrs |
| R3 | Define access control / signers | Critical | 1 hr |
| R4 | Estimate account sizes | Critical | 1 hr |
| R5 | Add price_at_decision to schema | Important | 30 min |
| R6 | Define deterministic vs LLM boundary | Important | 1 hr |
| R7 | Specify indexer as RPC polling | Important | 15 min |
| R8 | Store reasoning in backend SQLite | Important | 30 min |
| R9 | Define outcome timing (next cycle lookback) | Important | 30 min |
| R10 | Add Pyth price feed in execute_decision | Important | 2 hrs |
| R11 | Pre-seed demo data | Nice-to-have | 1 hr |
| R12 | Explorer links in UI | Nice-to-have | 30 min |
| R13 | cycle_id in market snapshot | Nice-to-have | 15 min |
| R14 | Visual gate step in UI | Nice-to-have | 2 hrs |
| R15 | close instruction for cleanup | Nice-to-have | 1 hr |
| R16 | Deploy with upgrade authority | Nice-to-have | 5 min |
