# AI Arena

Autonomous AI agents competing on Solana with confidence-gated execution.

Built for the **National Solana Hackathon by Decentrathon** (Case 2: AI + Blockchain).

## What it does

3 AI agents (Momentum, Mean Reversion, Risk-Off) analyze SOL/USDC market data and make trading decisions. Every decision passes through an on-chain confidence gate before execution.

```
Market Snapshot -> AI Decision -> On-Chain Record -> Confidence Gate -> Execute/Block -> Outcome
```

- All decisions are recorded on Solana regardless of gate result
- Blocked decisions remain as part of the audit trail
- Oracle price is read from Pyth on-chain
- Agents run in explicit runtime modes: `anthropic-live`, `openai-live`, or `deterministic-fallback`

## Architecture

```
ai-arena/
├── programs/ai-arena/    # Solana smart contract (Anchor/Rust)
├── backend/              # Agent runtime, cycle orchestration, REST API (Node.js/TypeScript)
├── frontend/             # Dashboard, decision feed, leaderboard (Next.js/Tailwind)
├── tests/                # Anchor integration tests
└── migrations/           # Deployment scripts
```

- **Smart Contract** — 6 PDA accounts, 5 instructions, atomic on-chain gate evaluation
- **Backend** — AI-first decisions (LLM with deterministic fallback), market data via Jupiter, oracle via Pyth
- **Frontend** — agent cards, decision feed with gate status, ranked leaderboard

See [ARCHITECTURE.md](ARCHITECTURE.md) and [ARCHITECTURE_VISUAL.md](ARCHITECTURE_VISUAL.md) for detailed specs.

## Quick Start

### Prerequisites

- Solana CLI, Anchor CLI, Node.js 18+, Rust

### Setup

```bash
# Build smart contract
cd ai-arena
anchor build

# Install backend dependencies
cd backend && npm install

# Install frontend dependencies
cd ../frontend && npm install

# Configure
solana config set --url devnet
cp backend/.env.example backend/.env
# Edit backend/.env with your keypair path and API keys
```

### Deploy & Run

```bash
# Deploy to devnet
anchor deploy --provider.cluster devnet

# Terminal 1: Backend
cd backend && npx ts-node src/index.ts

# Terminal 2: Frontend
cd frontend && npm run dev
```

Open http://localhost:3000 and click **Run Next Cycle**.

## On-Chain Program

| | |
|---|---|
| **Program ID** | `EpCHhXou3cP7c9CJbY6ACwjKwA56q79BeYZ5auTixBLY` |
| **Network** | Solana Devnet |
| **Explorer** | [View on Solana Explorer](https://explorer.solana.com/address/EpCHhXou3cP7c9CJbY6ACwjKwA56q79BeYZ5auTixBLY?cluster=devnet) |

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Smart Contract | Anchor 0.32.1 / Rust |
| Backend | Node.js / TypeScript |
| Frontend | Next.js / Tailwind CSS |
| AI | Anthropic Claude API / OpenAI API + deterministic fallback |
| Oracle | Pyth SOL/USD on-chain |
| Market Data | Jupiter Price API |
| Database | SQLite (reasoning storage) |

## Team

National Solana Hackathon by Decentrathon, 2026.
