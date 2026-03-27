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
