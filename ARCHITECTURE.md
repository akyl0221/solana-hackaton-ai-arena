# AI Arena Architecture (Consolidated)

## Purpose

This document describes the technical architecture for the hackathon MVP of **AI Arena + PoI Gate**.

The system is intentionally narrow.

It is designed to prove one thing well:

`AI decision -> on-chain record -> confidence gate -> guarded execution -> outcome tracking`

This is not a production trading platform.

This is the final consolidated version after three review rounds (R1-R16, P1-P3, F1-F3).

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
- show agent states and current positions
- show decision feed with gate evaluation visualization
- show execution and gate results
- show Solana Explorer links for on-chain transactions
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
- serve reasoning full text from SQLite by decision PDA

Recommended stack:

- Node.js
- TypeScript

### Agent Runtime

Responsibilities:

- fetch market snapshot (with cycle_id)
- run agent logic (deterministic signal + LLM confidence/reasoning)
- produce structured decision payload
- persist reasoning to SQLite with `pending` status
- submit decision transaction
- update reasoning status to `confirmed` or `failed`
- trigger execution when approved

### Market Data Service

Responsibilities:

- fetch `SOL/USDC` market data
- read Pyth oracle price for canonical reference
- compute indicators for all agents (SMA, momentum, volatility)
- generate a canonical market snapshot for each cycle
- include `cycle_id` in snapshot to match on-chain cycle counter

### Indexer / Read Model

Responsibilities:

- index on-chain decision, execution, and position accounts
- compute leaderboard metrics
- serve query-friendly data to frontend

Implementation: `getProgramAccounts` with memcmp filters on account type discriminator. Refresh every 3 seconds or on-demand after cycle completion.

### Solana Program

Responsibilities:

- store arena state
- register agents and initialize positions
- record decisions with oracle price
- evaluate gate rules
- record executions and update positions
- record outcomes and update PnL

---

## High-Level Data Flow

### Decision Cycle

```
Cycle N:
  1. record_outcome for Cycle N-1 decisions (using current oracle price)
  2. fetch market snapshot (indicators + cycle_id)
  3. agent runtime sends the same snapshot to all agents
  4. each agent returns a structured decision
  5. backend persists reasoning to SQLite (status: pending)
  6. backend submits `submit_decision` (records decision + evaluates gate atomically)
  7. backend updates reasoning status (confirmed / failed)
  8. if gate passed, backend submits `execute_decision`
  9. indexer updates leaderboard
  10. frontend renders updated state
```

### Why this flow is correct for the hackathon

- AI output exists before on-chain change
- the contract records the decision and gate result in one atomic write
- blocked decisions still become part of the audit trail
- reasoning text survives backend restarts (SQLite)
- oracle price is read on-chain, not trusted from backend

### Transaction count per cycle

- `record_outcome` × 3 agents (previous cycle) = 3 tx
- `submit_decision` × 3 agents = 3 tx
- `execute_decision` × approved agents only = 0-3 tx

Total: 6-9 transactions per cycle. At ~400ms each on devnet = 2.4-3.6 seconds.

---

## On-Chain Design

### Core Accounts

#### ArenaState

PDA seeds: `["arena", authority]`

Purpose: top-level arena configuration.

Fields:

- `authority: Pubkey` — deployer, can register agents
- `operator: Pubkey` — backend wallet, can submit decisions and execute
- `active_pair: String` — max 12 chars, e.g. "SOL/USDC"
- `cycle_counter: u64` — incremented each cycle
- `agents_count: u8` — number of registered agents
- `min_confidence: u8` — default confidence threshold
- `max_trade_size: u64` — default max order size
- `cooldown_seconds: i64` — min time between agent decisions
- `bump: u8`

Estimated size: ~115 bytes

#### AgentProfile

PDA seeds: `["agent", arena, agent_id (u64 bytes)]`

Purpose: one record per pre-built agent.

Fields:

- `arena: Pubkey`
- `agent_id: u64`
- `strategy_name: String` — max 32 chars
- `model_id: String` — max 32 chars
- `status: AgentStatus` — enum: Active, Paused, Stopped
- `max_trade_size: u64` — per-agent override
- `last_decision_ts: i64`
- `bump: u8`

Estimated size: ~138 bytes

#### AgentPosition

PDA seeds: `["position", arena, agent_id (u64 bytes)]`

Purpose: persistent position state across cycles. Without this, guardrails like max_position_size and cooldown cannot be enforced on-chain.

Fields:

- `arena: Pubkey`
- `agent: Pubkey`
- `current_side: PositionSide` — enum: `Flat`, `Long` (no Short in MVP)
- `current_size: u64` — current position size in base units
- `average_entry_price: u64` — weighted average entry, fixed-point (price × 10^6)
- `realized_pnl: i64` — accumulated realized PnL across cycles
- `unrealized_pnl: i64` — last computed unrealized PnL
- `total_executed: u64` — total number of executed decisions
- `last_executed_cycle: u64` — cycle_id of last execution
- `last_executed_at: i64` — timestamp of last execution
- `bump: u8`

Estimated size: ~130 bytes

No `Short` variant in MVP. The system only supports Flat and Long positions. This aligns with the no-leverage, no-shorting MVP boundary.

#### DecisionRecord

PDA seeds: `["decision", arena, agent, cycle_id (u64 bytes)]`

Purpose: one on-chain record for one agent decision. Seeds guarantee one decision per agent per cycle at the protocol level.

Fields:

- `arena: Pubkey`
- `agent: Pubkey`
- `cycle_id: u64`
- `input_hash: [u8; 32]` — SHA-256 of the market snapshot
- `action: DecisionAction` — enum: Buy, Sell, Hold
- `side: TradeSide` — enum: Base (SOL), Quote (USDC)
- `amount: u64`
- `confidence: u8` — 0-100
- `reasoning_hash: [u8; 32]` — SHA-256 of full reasoning text
- `gate_status: GateStatus` — enum: Approved, BlockedLowConfidence, BlockedRiskLimit, BlockedPositionLimit, BlockedCooldown
- `oracle_price: u64` — Pyth price at decision time, fixed-point (price × 10^6)
- `oracle_timestamp: i64` — Pyth publish_time
- `oracle_confidence: u64` — Pyth confidence interval
- `created_at: i64`
- `bump: u8`

Estimated size: ~197 bytes

Price model: `oracle_price` is the **execution-time reference price** read from Pyth on-chain during `submit_decision`. This is NOT necessarily the exact price the AI saw in the snapshot — there may be a small delta. The AI's input context is captured via `input_hash`. PnL is always calculated using on-chain oracle prices.

#### ConfidenceGate

PDA seeds: `["gate", arena]`

Purpose: explicit policy account for gate evaluation.

Fields:

- `arena: Pubkey`
- `min_confidence: u8` — minimum confidence to pass gate
- `max_trade_size: u64` — maximum single order size
- `allowed_actions: u8` — bitmask (bit 0 = Buy, bit 1 = Sell, bit 2 = Hold)
- `bump: u8`

Estimated size: ~51 bytes

#### ExecutionRecord

PDA seeds: `["execution", decision]`

Purpose: one record for attempted or completed execution. Seeds guarantee one execution attempt per decision.

Fields:

- `decision: Pubkey`
- `executed: bool`
- `blocked: bool`
- `execution_price: u64` — oracle price at execution, fixed-point
- `position_delta: i64` — change in position size
- `pnl_delta: i64` — realized PnL from this execution
- `timestamp: i64`
- `bump: u8`

Estimated size: ~75 bytes

### Account Size Summary

```
ArenaState          ["arena", authority]                    ~115 bytes    ×1
AgentProfile        ["agent", arena, agent_id]              ~138 bytes    ×3
AgentPosition       ["position", arena, agent_id]           ~130 bytes    ×3
DecisionRecord      ["decision", arena, agent, cycle_id]    ~197 bytes    ×N (3 per cycle)
ConfidenceGate      ["gate", arena]                         ~51 bytes     ×1
ExecutionRecord     ["execution", decision]                 ~75 bytes     ×N (0-3 per cycle)
```

Rent cost: each DecisionRecord ~0.002 SOL. 3 agents × 50 cycles = 150 records = ~0.3 SOL total on devnet.

### Important Solana Constraints

- Do not use unbounded vectors like `decisions[]`, `executions[]`, `investors[]`
- Every decision and execution must be a separate PDA-derived record
- All string fields must have defined max lengths (see sizes above)
- Deploy with upgrade authority on devnet for iteration speed

---

## Program Instructions

### Access Control

```
initialize_arena:   authority (deployer) — signer
register_agent:     authority — signer
submit_decision:    operator (backend wallet) — signer, checked against ArenaState.operator
execute_decision:   operator — signer
record_outcome:     operator — signer
```

### `initialize_arena`

Creates:

- `ArenaState`
- `ConfidenceGate`

Signer: authority

### `register_agent`

Creates:

- `AgentProfile`
- `AgentPosition` (initialized to Flat, zero size)

Signer: authority

Used only for the fixed set of pre-built agents.

### `submit_decision`

Creates:

- `DecisionRecord`

Reads:

- `ConfidenceGate`
- `AgentProfile`
- `AgentPosition`
- Pyth SOL/USD price account (remaining account)

This instruction atomically:

1. Reads Pyth oracle price and writes `oracle_price`, `oracle_timestamp`, `oracle_confidence`
2. Stores the structured decision (action, side, amount, confidence, reasoning_hash, input_hash)
3. Evaluates gate rules against ConfidenceGate config and AgentPosition state
4. Writes `gate_status` result

Gate evaluation checks:

- `confidence >= gate.min_confidence`
- `amount <= gate.max_trade_size`
- `action` is in `gate.allowed_actions`
- `agent.status == Active`
- position size after execution would not exceed agent max
- cooldown has elapsed since last execution

If any check fails, the decision is still recorded but `gate_status` is set to the appropriate blocked reason. No trade is executed.

Signer: operator

### `execute_decision`

Reads:

- approved `DecisionRecord` (must have `gate_status == Approved`)

Writes:

- `AgentPosition` — updates side, size, average_entry_price, last_executed_cycle, last_executed_at

Creates:

- `ExecutionRecord`

For MVP: use deterministic simulated execution with oracle price as execution price. No dependency on live swap routing.

Signer: operator

### `record_outcome`

Reads:

- `ExecutionRecord`
- Pyth price account (current price)

Writes:

- `ExecutionRecord` — updates pnl_delta
- `AgentPosition` — updates realized_pnl, unrealized_pnl

Timing: called at the START of cycle N for cycle N-1 decisions. Uses current oracle price as exit reference.

Signer: operator

### Optional: `close_decision`

Closes a `DecisionRecord` + associated `ExecutionRecord` and refunds rent to authority. Not required for MVP but shows Solana maturity.

---

## Off-Chain Design

### Agent Strategy Layer

Use exactly 3 agents:

- `Momentum Agent` — buy when short-term momentum is positive, sell when trend weakens, otherwise hold
- `Mean Reversion Agent` — buy when price drops below recent average, sell when price rises above, otherwise hold
- `Risk-Off Agent` — prefers hold, only takes small positions, exits early when confidence drops

### Agent Implementation: Deterministic + LLM Hybrid

The boundary between deterministic and LLM is explicit:

```
Deterministic layer (no LLM):
  - receives: market snapshot (indicators, not raw price)
  - computes: strategy-specific signal
  - outputs: { action: buy/sell/hold, amount: N }

LLM layer:
  - receives: signal + market context + agent persona prompt
  - outputs: { confidence: 0-100, reasoning: string }
```

Why this split:

- The action is deterministic — demo is reproducible, agents behave differently
- The confidence comes from LLM — the gate has real variance (some pass, some get blocked)
- The reasoning comes from LLM — readable audit trail for frontend
- If LLM fails, use default confidence=50 and generic reasoning — graceful degradation

If LLM generates the action itself, you risk:

- malformed outputs killing the demo
- all 3 agents making the same decision (LLMs tend to converge)
- no visible difference between agent strategies

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

No `price` field in the off-chain schema. The canonical price is read from Pyth oracle on-chain during `submit_decision`.

Validation rules:

- `action` must be one of: `buy`, `sell`, `hold`
- `amount` must be numeric and bounded (0 < amount <= max_trade_size)
- `confidence` must be `0..100`
- `summary` must be non-empty string
- invalid schema → decision is blocked before submission

### Reasoning Storage

**SQLite only. Not in-memory.**

If the backend restarts, reasoning text must survive. On-chain `reasoning_hash` values without matching text render the audit trail useless during demo.

Schema:

```sql
CREATE TABLE reasoning (
  decision_pda TEXT PRIMARY KEY,
  reasoning_hash TEXT NOT NULL,
  full_text TEXT NOT NULL,
  tx_signature TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  confirmed_at INTEGER
);
```

Lifecycle:

1. Agent produces reasoning → write to SQLite with status `pending`
2. Submit `submit_decision` transaction
3. Transaction confirmed → update status to `confirmed`, save `tx_signature` and `confirmed_at`
4. Transaction failed → update status to `failed`
5. Transaction retried with new hash → mark old row `orphaned`, create new `pending` row

Frontend API: `GET /api/reasoning/:decisionPda` — returns full text if status is `confirmed`.

### Pricing Model

Two distinct concepts — do not conflate:

**1. Snapshot price (what the AI saw)**

- Part of the market snapshot built by Market Data Service
- Used by agents to compute signals
- Captured via `input_hash` (SHA-256 of full snapshot)
- Not stored on-chain as a separate field

**2. Oracle reference price (for execution and PnL)**

- Read from Pyth SOL/USD on-chain during `submit_decision`
- Stored in DecisionRecord as `oracle_price`, `oracle_timestamp`, `oracle_confidence`
- Used as entry price for PnL calculation
- Used as execution price in `execute_decision`
- Exit price = oracle price at `record_outcome` (next cycle)

There may be a small delta between snapshot price and oracle price at submit time. This is acceptable for MVP. The key guarantee is: all PnL is calculated from on-chain oracle prices only.

---

## Execution Model

### MVP Mode: Deterministic Simulated Execution

- execution uses the on-chain oracle price at decision time
- the contract records the action and updates AgentPosition
- no dependency on unstable live swap routing during demo

### Why this is preferred

- fewer external failures
- more stable demo
- still satisfies the hackathon requirement: AI decisions drive on-chain state changes

### Alternative Mode

If the team has extra time:

- add one real devnet swap path via Jupiter
- keep simulated execution as fallback

### Guardrails (enforced on-chain)

- max trade size per agent (checked in gate)
- max position size per agent (checked in gate via AgentPosition)
- cooldown between decisions (checked in gate via AgentPosition.last_executed_at)
- no leverage
- no shorting (PositionSide only allows Flat | Long)
- no multi-hop execution

---

## Leaderboard Design

Leaderboard must remain off-chain.

### Inputs

- decision records
- execution records
- agent position states
- blocked decision counts

### Metrics

- total decisions
- gate pass rate
- blocked rate
- executed decisions
- realized PnL
- unrealized PnL
- last action time

### Why off-chain

- no reason to pay on-chain costs for read-heavy ranking logic
- easier to iterate and explain
- avoids a fake on-chain feature that adds no value

---

## Frontend Information Architecture

### Arena Dashboard

Shows:

- agent cards with current position state
- recent decisions
- recent blocked decisions (part of the product story)
- leaderboard
- Solana Explorer links for on-chain transactions

### Agent Details

Shows:

- strategy description
- current position (side, size, entry price, PnL)
- model id
- decision timeline
- gate results
- execution history

### Decision Feed

Each event should show visual gate evaluation:

```
[Decision] -> [Gate: confidence 84 >= 70? PASS] -> [Executed at $145.20] -> [Result: +$2.30]
[Decision] -> [Gate: confidence 42 >= 70? FAIL] -> [Blocked: LowConfidence]
```

This feed is central to the product story. The visual gate step makes the PoI layer tangible to judges in 2 seconds.

Each decision and execution shows a clickable Solana Explorer link (devnet). This is a powerful proof moment for judges.

---

## Demo Topology

### Minimal Deployment Setup

- Solana Devnet
- one deployed Anchor program (with upgrade authority)
- one backend service
- one frontend app
- one SQLite file for reasoning
- indexer runs as part of backend process

### Demo Control

Add one manual trigger:

- `Run Next Cycle`

This button should:

1. record outcomes for previous cycle
2. fetch market snapshot with cycle_id
3. run all agents (deterministic signal + LLM)
4. persist reasoning to SQLite
5. submit decisions on-chain
6. execute approved actions
7. refresh UI

This reduces demo randomness.

### Pre-seeding

Before demo, pre-run 5-10 cycles so the dashboard already shows:

- decision history
- leaderboard with differentiated scores
- some blocked decisions in the feed

The live "Run Next Cycle" adds a fresh decision on top of existing history.

---

## Failure Modes

### Invalid AI Output

- reject at schema validation layer
- optionally write blocked record with reason

### Low Confidence

- decision is still recorded on-chain
- marked as blocked by gate
- not executed

### Oversized Action / Position Limit

- decision is still recorded on-chain
- marked as blocked by risk rule
- not executed

### RPC Failure

- retry once or twice
- show pending state in UI
- do not fake success
- reasoning status remains `pending` in SQLite

### Market Data Failure

- use last valid snapshot with stale marker
- or skip cycle cleanly

### LLM Failure

- skip that agent's LLM call
- use deterministic signal with default confidence=50
- show agent warning state
- continue processing other agents

---

## Security and Safety Constraints

For MVP:

- no leverage
- no short positions (PositionSide: Flat | Long only)
- no external user funds
- no dynamic agent uploads
- bounded order size per agent
- bounded position size per agent (enforced via AgentPosition)
- cooldown between decisions (enforced via AgentPosition)
- operator wallet is the only signer for state-changing instructions

---

## Build Priorities

### Priority 1

- on-chain accounts (ArenaState, AgentProfile, AgentPosition, DecisionRecord, ConfidenceGate)
- `submit_decision` instruction with gate evaluation
- structured agent output (deterministic + LLM hybrid)
- SQLite reasoning storage

### Priority 2

- `execute_decision` with AgentPosition updates
- `record_outcome` with PnL calculation
- ExecutionRecord
- decision feed UI

### Priority 3

- leaderboard
- Pyth oracle integration
- Explorer links
- charts and visual polish
- pre-seeded demo data

If time gets tight, never sacrifice the core decision-to-gate-to-record loop for cosmetic features.

---

## Final Positioning

The architecture should be presented as:

**a compact Solana system for transparent, bounded AI execution**

not as:

- a fully autonomous hedge fund
- a generalized AI protocol standard
- a production trading platform

---

## Review History

This document has been through three rounds of review. All findings have been incorporated into the main sections above.

### Round 1: Architecture Review (R1-R16)

| # | Finding | Status |
|---|---------|--------|
| R1 | PDA seeds undefined | Applied — seeds defined for all 6 accounts |
| R2 | 3 tx per decision too slow | Applied — merged record_decision + evaluate_gate into submit_decision |
| R3 | Access control undefined | Applied — operator/authority model defined |
| R4 | Account sizes not estimated | Applied — sizes estimated for all 6 accounts |
| R5 | Missing price_at_decision | Superseded by P3 — oracle price on-chain, no price in off-chain JSON |
| R6 | Hybrid agent logic underspecified | Applied — deterministic signal + LLM confidence/reasoning split |
| R7 | Indexer strategy unspecified | Applied — getProgramAccounts with memcmp filters |
| R8 | Reasoning storage location | Applied + hardened by P2/F1 — SQLite only with stateful lifecycle |
| R9 | Outcome timing unclear | Applied — next-cycle lookback model |
| R10 | Pyth oracle integration | Upgraded — structurally required for canonical pricing (P3) |
| R11 | Pre-seed demo data | Applied — noted in Demo Topology |
| R12 | Explorer links | Applied — noted in Frontend Architecture |
| R13 | cycle_id in snapshot | Applied — noted in Market Data Service |
| R14 | Visual gate step in UI | Applied — noted in Decision Feed |
| R15 | close instruction | Applied — noted as optional instruction |
| R16 | Deploy with upgrade authority | Applied — noted in Demo Topology |

### Round 2: Follow-Up Review (P1-P3)

| # | Finding | Status |
|---|---------|--------|
| P1 | Missing AgentPosition for persistent state | Applied — new account added |
| P2 | Reasoning storage must be SQLite only | Applied — in-memory option removed |
| P3 | Canonical price source undefined | Applied — Pyth oracle = single source, snapshot price separate |

### Round 3: Response Findings (F1-F3)

| # | Finding | Status |
|---|---------|--------|
| F1 | SQLite needs stateful lifecycle (pending/confirmed/failed) | Applied — full lifecycle defined |
| F2 | AgentPosition must not include Short | Applied — PositionSide = Flat, Long only |
| F3 | Snapshot price != oracle price at submit time | Applied — two concepts explicitly separated in Pricing Model |
