# AI Arena MVP

## Idea

**AI Arena** is a Solana-based demo where pre-built AI agents compete on the same `SOL/USDC` market, and every decision passes through a PoI-style confidence gate before execution.

This MVP is designed for the hackathon, not for production trading.

The goal is to show a clean chain:

`market input -> AI decision -> on-chain record -> confidence gate -> guarded execution -> result -> leaderboard`

---

## MVP Goal

Build a working demo where:

1. 2-3 pre-built AI agents receive the same market snapshot
2. each agent produces a structured trading decision
3. the decision is recorded on-chain
4. the confidence gate allows or blocks execution
5. allowed decisions execute within strict limits
6. outcomes are tracked
7. leaderboard updates off-chain

The key success criterion is not PnL.

The key success criterion is proving:

- AI is part of the decision loop
- Solana stores the execution-critical audit trail
- contract state changes based on AI output

---

## Product Scope

### In Scope

- one pair: `SOL/USDC`
- 2-3 fixed agents
- one simple execution path
- on-chain decision recording
- on-chain confidence gate
- on-chain execution result record
- off-chain leaderboard
- dashboard UI

### Out of Scope

- user-created agents
- real investor capital
- LP/share tokens
- copy trading
- agent marketplace
- multi-asset portfolio management
- advanced routing across protocols
- full autonomous treasury system

---

## Agent Set

Use exactly 3 agents max.

### 1. Momentum Agent

Behavior:

- buy when short-term momentum is positive
- sell when trend weakens
- otherwise hold

### 2. Mean Reversion Agent

Behavior:

- buy when price drops below recent average
- sell when price rises above recent average
- otherwise hold

### 3. Risk-Off Agent

Behavior:

- prefers hold
- only takes small positions
- exits early when confidence drops

These can be implemented as:

- LLM-generated structured decisions
- or hybrid logic where LLM wraps deterministic signals

For MVP, hybrid logic is safer.

---

## On-Chain Design

### Accounts

- `ArenaState`
- `AgentProfile`
- `DecisionRecord`
- `ConfidenceGate`
- `ExecutionRecord`

### Account Responsibilities

#### ArenaState

- arena authority
- active market pair
- total agents
- global risk config

#### AgentProfile

- agent id
- model id
- strategy name
- status
- max position size
- max notional

#### DecisionRecord

- agent
- timestamp
- input hash
- action
- side
- amount
- confidence
- reasoning hash
- gate status

#### ConfidenceGate

- min confidence
- max order size
- allowed actions
- block reason

#### ExecutionRecord

- linked decision
- executed flag
- execution price
- pnl delta
- timestamp

### Instructions

- `initialize_arena`
- `register_agent`
- `record_decision`
- `evaluate_gate`
- `execute_decision`
- `record_outcome`

Important constraint:

Do not store growing arrays like `decisions[]` or `investors[]` inside a single account.

Each decision should be its own account or PDA-derived record.

---

## Confidence Gate

This is the PoI layer inside the product.

### Gate Rules for MVP

A decision can execute only if:

- confidence >= configured threshold
- amount <= max order size
- action is in allowed action set
- agent is active

If a decision fails the gate:

- it is still recorded on-chain
- it is marked as blocked
- it does not execute

This is important for the demo, because blocked decisions are part of the story.

---

## Execution Model

Keep execution minimal.

### Recommended MVP approach

Use one simplified execution path:

- mock execution engine
- or devnet swap simulation against a single route

If real swaps add too much instability, use deterministic simulated execution with market price snapshots.

For the hackathon, reliability is more important than pretending to be a production trading engine.

### Guardrails

- max trade size per agent
- no leverage
- no shorting
- no multi-hop execution
- cooldown between decisions

---

## Off-Chain Services

### 1. Market Data Service

Responsibilities:

- fetch price snapshot
- compute simple indicators
- normalize data for agents

### 2. Agent Runtime

Responsibilities:

- run agent loop on interval
- build structured prompt or signal payload
- collect decision output
- submit on-chain transaction

### 3. Leaderboard Indexer

Responsibilities:

- read decision and execution records
- compute:
  - total decisions
  - passed gate rate
  - executed decisions
  - realized pnl
  - blocked decisions
- expose leaderboard to frontend

Leaderboard should stay off-chain.

---

## Frontend Structure

### 1. Arena Dashboard

Show:

- active agents
- current rankings
- recent decisions
- recent blocked actions

### 2. Agent Detail Page

Show:

- strategy description
- model id
- decision history
- gate pass/fail history
- pnl chart

### 3. Execution Feed

Show:

- decision submitted
- gate approved or blocked
- execution result

This feed is one of the strongest visual parts of the demo.

---

## Demo Script

### 3-Minute Demo

1. open arena dashboard
2. show 3 agents with different strategies
3. trigger or wait for one decision cycle
4. show raw AI decision output
5. show on-chain decision record
6. show gate result
7. show one allowed execution and one blocked execution
8. show updated leaderboard

### Main Demo Message

"This is not just an AI bot. This is a bounded AI execution system where every decision is recorded, checked, and either executed or blocked on Solana."

---

## Technical Stack

### Smart Contract

- Anchor
- Rust
- Solana Devnet

### Backend

- Node.js
- TypeScript
- OpenAI or Anthropic API

### Frontend

- Next.js
- Tailwind
- Solana Wallet Adapter

### Market Data

- Jupiter price endpoints
- Pyth or mock snapshots

---

## Day-by-Day Plan

### Day 1

- initialize repo structure
- define on-chain account model
- define decision JSON schema
- finalize fixed agent strategies

### Day 2

- implement Anchor accounts and base instructions
- support `initialize_arena`, `register_agent`, `record_decision`
- write basic tests for account creation

### Day 3

- implement `evaluate_gate` and `execute_decision`
- add execution guardrails
- add tests for blocked vs allowed decisions

### Day 4

- build agent runtime
- integrate market snapshot input
- generate structured agent decisions
- send transactions from backend

### Day 5

- build frontend arena dashboard
- show agent cards, decision feed, gate status
- build basic leaderboard from indexer data

### Day 6

- polish demo flow
- add one-click trigger for a demo cycle
- stabilize decision formatting and UI states
- improve charts and logs

### Day 7

- rehearse end-to-end demo
- record screenshots or backup video
- tighten README and architecture explanation
- prepare judge-facing pitch narrative

---

## Success Criteria

The MVP is successful if:

- three agents can run end to end
- each produces structured decisions
- decisions are written on-chain
- some decisions pass the gate and some fail
- at least one execution result is recorded
- leaderboard updates from indexed data
- demo is understandable in under 3 minutes

---

## Non-Goals

Do not add these unless the core loop is already solid:

- investor deposits
- tokenized shares
- advanced strategy customization
- arbitrary agent creation
- real production trading claims
- complex DeFi integrations

---

## Final Build Order

If time gets tight, build in this order:

1. on-chain decision log
2. confidence gate
3. one execution path
4. two agents
5. leaderboard
6. third agent
7. visual polish
