# Review Follow-Up: Feedback on Architecture Review

This document captures additional feedback received after the initial architecture review (ARCHITECTURE.md, section "Architecture Review Notes").

These are corrections and additions to the review itself — not direct edits to the architecture.

When applying fixes from the review, these follow-ups should be applied on top.

---

## P1. Missing persistent state for agent position [Critical]

**What the review missed:**

The review strengthened DecisionRecord and ExecutionRecord, but did not catch that there is no account tracking the agent's **current position state** across cycles.

Without this, the following are impossible to enforce on-chain:

- `max_position_size` guardrail — contract doesn't know how much the agent already holds
- cooldown validation — contract doesn't know when the last execution happened per agent
- correct cross-cycle PnL — there's no `average_entry_price` or `realized_pnl` accumulator

Right now `AgentProfile` stores `max_trade_size` and `last_decision_timestamp`, but these describe limits and metadata, not live state.

**Fix: add `AgentPosition` account**

```
AgentPosition (PDA: ["position", arena, agent_id])

Fields:
  - arena: Pubkey
  - agent: Pubkey
  - current_side: enum (Long, Short, Flat)
  - current_size: u64              # current position size in base units
  - average_entry_price: u64       # weighted average entry (fixed-point)
  - realized_pnl: i64             # accumulated realized PnL across cycles
  - unrealized_pnl: i64           # last computed unrealized PnL
  - total_executed: u64            # total number of executed decisions
  - last_executed_cycle: u64       # cycle_id of last execution
  - last_executed_at: i64          # timestamp of last execution
  - bump: u8
```

Estimated size: 8 + 32 + 32 + 1 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 1 = ~130 bytes

**How it integrates:**

- Created once via `register_agent` (initialized to Flat/zero)
- Updated by `execute_decision` — adjusts size, entry price, side
- Updated by `record_outcome` — updates realized/unrealized PnL
- Read by `submit_decision` (merged instruction) — checks position size against max, checks cooldown

**Impact on existing review items:**

- R1: add PDA seed `["position", arena, agent_id]`
- R3: `execute_decision` must have write access to AgentPosition
- R4: add ~130 bytes to size estimates, 3 accounts total = ~0.003 SOL

**Why this matters for the demo:**

Without AgentPosition, if an agent buys 10 SOL in cycle 1 and buys 10 SOL in cycle 2, the contract has no idea the agent is now holding 20 SOL. The `max_position_size` guardrail becomes fiction. Judges who look at the contract will notice this immediately.

---

## P2. Reasoning storage must be SQLite, not in-memory [Important]

**What the review said (R8):**

> "simplest option: in-memory store or SQLite on the backend"

**Why this is wrong:**

Leaving in-memory as a valid option is dangerous for demo. If the backend process restarts (crash, deploy, OOM), all reasoning text is lost. On-chain you still have `reasoning_hash` values, but the frontend shows empty cards with hashes instead of readable text.

During a live demo, this is an unrecoverable failure. You can't re-generate the same reasoning to match the hash.

**Fix:**

R8 should read: **SQLite only. Not in-memory.**

SQLite specifics:

- One file: `reasoning.db`
- One table: `reasoning (decision_pda TEXT PRIMARY KEY, full_text TEXT, created_at INTEGER)`
- Backend writes reasoning before submitting the on-chain transaction
- Frontend reads via backend API: `GET /api/reasoning/:decisionPda`
- Survives restart, no external dependencies, zero config

In-memory caching on top of SQLite is fine for performance. But SQLite is the source of truth.

---

## P3. Canonical price source must be defined [Important]

**What the review said (R5 + R13):**

R5 added `price_at_decision` to the off-chain JSON schema and said "store on-chain in DecisionRecord."

R13 added `cycle_id` to market snapshot.

**The conflict:**

If price exists in the off-chain snapshot AND in DecisionRecord, there are two sources of truth. The agent might see price $145.00 from the snapshot API, but by the time the transaction lands on-chain the price could be $145.30. Which one is "real" for PnL?

**Fix: Pyth oracle is the single canonical price source.**

Design:

1. **Off-chain snapshot** contains indicators (SMA, momentum signals, volatility) but NOT a "canonical price" field. Agents use indicators to generate signals, not raw price.
2. **On-chain `submit_decision`** reads the Pyth SOL/USD price account and writes `oracle_price`, `oracle_timestamp`, `oracle_confidence` into DecisionRecord.
3. **PnL calculation** always uses on-chain oracle prices: `entry_oracle_price` vs `exit_oracle_price`. Never off-chain prices.

Updated DecisionRecord fields (additive to R4 sizing):

```
+ oracle_price: u64         # Pyth price at decision time (fixed-point, e.g. price * 10^6)
+ oracle_timestamp: i64     # Pyth publish_time
+ oracle_confidence: u64    # Pyth confidence interval
```

Additional size: +24 bytes per DecisionRecord (173 → ~197 bytes).

Updated off-chain JSON schema — no price field:

```json
{
  "action": "buy",
  "side": "SOL",
  "amount": 10,
  "confidence": 84,
  "summary": "Momentum remains positive on the latest interval."
}
```

**Consequences:**

- R5 is superseded: no `price` in off-chain schema, oracle price written on-chain instead
- R10 is upgraded from "nice Solana depth points" to "structurally required for correct PnL"
- R13 still valid: `cycle_id` in snapshot creates audit link, but price comes from oracle not snapshot
- Pyth devnet SOL/USD feed address should be pinned in config

---

## Updated Summary

After applying P1-P3, the full account set becomes:

```
ArenaState          ["arena", authority]                    ~115 bytes
AgentProfile        ["agent", arena, agent_id]              ~138 bytes
AgentPosition       ["position", arena, agent_id]           ~130 bytes   <- NEW
DecisionRecord      ["decision", arena, agent, cycle_id]    ~197 bytes   <- updated (+24)
ConfidenceGate      ["gate", arena]                         ~51 bytes
ExecutionRecord     ["execution", decision]                 ~75 bytes
```

Updated instruction access:

```
initialize_arena:    creates ArenaState + ConfidenceGate
register_agent:      creates AgentProfile + AgentPosition
submit_decision:     creates DecisionRecord, reads ConfidenceGate + AgentPosition + Pyth
execute_decision:    creates ExecutionRecord, writes AgentPosition
record_outcome:      writes ExecutionRecord + AgentPosition (pnl update)
```

Updated review table with changes:

| # | Original | After P1-P3 |
|---|----------|-------------|
| R1 | 5 PDA seeds | 6 PDA seeds (+ AgentPosition) |
| R4 | 5 account sizes | 6 account sizes (+ AgentPosition ~130b) |
| R5 | Add price to JSON + on-chain | **Superseded**: no price in JSON, oracle price on-chain |
| R8 | In-memory or SQLite | **SQLite only** |
| R10 | Nice-to-have Pyth | **Structurally required** for canonical pricing |
