# AI Arena

Autonomous AI agents competing on Solana with confidence-gated execution.

Built for the National Solana Hackathon by Decentrathon (Case 2: AI + Blockchain).

## What it does

3 AI agents (Momentum, Mean Reversion, Risk-Off) analyze SOL/USDC market data and make trading decisions. Every decision passes through an on-chain confidence gate before execution.

**Core flow:**
```
Market Snapshot -> AI Decision -> On-Chain Record -> Confidence Gate -> Execute/Block -> Outcome
```

- Decisions are recorded on Solana regardless of gate result
- Blocked decisions remain as part of the audit trail
- Oracle price is read from Pyth on-chain
- Reasoning text is stored with a stateful lifecycle (pending/confirmed/failed)

## Architecture

- **Smart Contract** (Anchor/Rust) — 6 accounts, 5 instructions, on-chain gate evaluation
- **Backend** (Node.js/TypeScript) — agent runtime, market data, cycle orchestration, REST API
- **Frontend** (Next.js/Tailwind) — dashboard with decision feed, leaderboard, agent cards

See `ARCHITECTURE.md` and `ARCHITECTURE_VISUAL.md` for details.

## Quick Start

### Prerequisites

- Solana CLI (`solana --version`)
- Anchor CLI (`anchor --version`)
- Node.js 18+ (`node --version`)
- Rust (`cargo --version`)

### 1. Install dependencies

```bash
# Smart contract
anchor build

# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### 2. Configure

```bash
# Set Solana to devnet
solana config set --url devnet

# Create keypair (if needed)
solana-keygen new

# Get devnet SOL
# Visit https://faucet.solana.com and request SOL for your address:
solana address

# Backend env
cp backend/.env.example backend/.env
# Edit backend/.env with your program ID and keypair path
```

### 3. Deploy contract

```bash
anchor build
anchor deploy --provider.cluster devnet
```

### 4. Run

```bash
# Terminal 1: Backend
cd backend
npx ts-node src/index.ts

# Terminal 2: Frontend
cd frontend
npm run dev
```

### 5. Demo

Open http://localhost:3000 and click "Run Next Cycle".

## On-Chain Program

**Program ID:** `EpCHhXou3cP7c9CJbY6ACwjKwA56q79BeYZ5auTixBLY`

**Network:** Solana Devnet

**Explorer:** [View on Solana Explorer](https://explorer.solana.com/address/EpCHhXou3cP7c9CJbY6ACwjKwA56q79BeYZ5auTixBLY?cluster=devnet)

### Accounts

| Account | Purpose |
|---------|---------|
| ArenaState | Global arena config |
| AgentProfile | Per-agent strategy and limits |
| AgentPosition | Live position state (side, size, PnL) |
| DecisionRecord | One record per agent per cycle |
| ConfidenceGate | Gate evaluation policy |
| ExecutionRecord | Execution result and outcome |

### Instructions

| Instruction | Description |
|-------------|-------------|
| initialize_arena | Create arena + gate |
| register_agent | Register agent + initialize position |
| submit_decision | Record decision + evaluate gate (atomic) |
| execute_decision | Execute approved decision, update position |
| record_outcome | Record PnL outcome for previous cycle |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/cycle | Run next decision cycle |
| GET | /api/cycles | Get cycle history |
| GET | /api/arena | Get arena state |
| GET | /api/agents | Get agent profiles + positions |
| GET | /api/decisions | Get all decisions from chain |
| GET | /api/leaderboard | Get ranked leaderboard |
| GET | /api/reasoning/:pda | Get confirmed reasoning text |

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Smart Contract | Anchor 0.32.1 / Rust |
| Backend | Node.js / TypeScript |
| Frontend | Next.js / Tailwind CSS |
| AI | Anthropic Claude API (optional fallback) |
| Oracle | Pyth SOL/USD on-chain |
| Market Data | Jupiter Price API |
| Database | SQLite (reasoning storage) |

## Tests

```bash
# Smart contract tests (13 tests)
anchor test

# All tests cover:
# - Arena initialization
# - Agent registration
# - Decision submission (approved/blocked)
# - Gate evaluation (confidence, risk, cooldown)
# - Execution and position updates
# - PnL outcome recording
# - Access control
```
