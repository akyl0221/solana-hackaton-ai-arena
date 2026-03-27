import { SolanaClient } from "./solana";
import { createApi } from "./api";
import { config } from "./config";
import { AGENT_CONFIGS } from "./agents";

async function setup(solana: SolanaClient) {
  // Check if arena already initialized
  try {
    await solana.getArenaState();
    console.log("Arena already initialized");
  } catch {
    console.log("Initializing arena...");
    await solana.initializeArena();
  }

  // Register agents if not already registered
  for (const agent of AGENT_CONFIGS) {
    try {
      await solana.getAgentProfile(agent.id);
      console.log(`Agent ${agent.id} (${agent.name}) already registered`);
    } catch {
      console.log(`Registering agent ${agent.id} (${agent.name})...`);
      await solana.registerAgent(
        agent.id,
        agent.name,
        agent.model,
        agent.maxTradeSize,
        agent.maxPositionSize
      );
    }
  }
}

async function main() {
  console.log("AI Arena Backend starting...");
  console.log(`RPC: ${config.solanaRpcUrl}`);
  console.log(`Program: ${config.programId}`);
  console.log(`Operator: ${config.operatorKeypair.publicKey.toBase58()}`);
  console.log(`Anthropic API: ${config.anthropicApiKey ? "configured" : "NOT SET (using fallback)"}`);

  const solana = new SolanaClient();

  // Setup arena and agents on-chain
  await setup(solana);

  // Start API server
  const app = createApi(solana);
  app.listen(config.port, () => {
    console.log(`\nAPI server running at http://localhost:${config.port}`);
    console.log(`\nEndpoints:`);
    console.log(`  POST /api/cycle          - Run next decision cycle`);
    console.log(`  GET  /api/cycles         - Get cycle history`);
    console.log(`  GET  /api/arena          - Get arena state`);
    console.log(`  GET  /api/agents         - Get agent profiles + positions`);
    console.log(`  GET  /api/decisions      - Get all decisions`);
    console.log(`  GET  /api/leaderboard    - Get leaderboard`);
    console.log(`  GET  /api/reasoning/:pda - Get reasoning text`);
    console.log(`\nReady! Call POST /api/cycle to run a decision cycle.`);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
