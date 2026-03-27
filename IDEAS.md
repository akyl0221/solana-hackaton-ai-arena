# Solana Hackathon Ideas — National Solana Hackathon by Decentrathon

> Deadline: April 7, 2026, 23:59 (GMT+5)
> Submit: Google Forms + Colosseum

Все три идеи нацелены на **Case 2 (AI + Blockchain)** с бонусными баллами за реальные сценарии (finance, real estate, energy). Каждая идея включает полный end-to-end flow: AI принимает решение → on-chain транзакция → изменение состояния смарт-контракта.

---

## Idea 1: AI Arena — Автономные AI-агенты с кошельками, конкурирующие on-chain

### Концепт

Платформа, где пользователи создают и запускают AI-агентов на Solana. Каждый агент получает собственный PDA-кошелек и автономно торгует/управляет активами. Агенты конкурируют друг с другом — дарвиновский отбор on-chain. Лучшие агенты привлекают инвесторов.

> "Что если бы AI-боты конкурировали за ваши деньги — прозрачно и on-chain?"

### Проблемы, которые решаем

- **Непрозрачность AI в финансах** — каждое решение AI записывается on-chain с хешем reasoning'а
- **Нет инструментов для автоматического управления DeFi** — агенты полностью автономны
- **Сложно доверять AI** — смарт-контракт ограничивает агента (risk limits, max drawdown), пользователи видят каждый шаг
- **Ручное управление портфелем** — "set and forget", AI работает 24/7

### Архитектура

```
┌─────────────────────────────────────────────────────┐
│                    Frontend (Next.js)                │
│  ┌─────────┐  ┌──────────┐  ┌─────────────────────┐ │
│  │ Agent   │  │ Leader-  │  │ Invest / Withdraw   │ │
│  │ Creator │  │ board    │  │ Panel               │ │
│  └─────────┘  └──────────┘  └─────────────────────┘ │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              Backend / AI Engine (Node.js)           │
│  ┌──────────────────────────────────────────────┐   │
│  │ Agent Runtime                                │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐        │   │
│  │  │ Agent 1 │ │ Agent 2 │ │ Agent N │        │   │
│  │  │ (GPT-4) │ │ (Claude)│ │ (Custom)│        │   │
│  │  └────┬────┘ └────┬────┘ └────┬────┘        │   │
│  │       │           │           │              │   │
│  │       ▼           ▼           ▼              │   │
│  │  ┌──────────────────────────────────┐        │   │
│  │  │ Decision Engine                  │        │   │
│  │  │ - Market data analysis           │        │   │
│  │  │ - Strategy execution             │        │   │
│  │  │ - Risk assessment                │        │   │
│  │  └──────────────┬───────────────────┘        │   │
│  └─────────────────┼───────────────────────────┘   │
└────────────────────┼────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│              Solana Blockchain (Devnet)              │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │ Arena Program (Anchor)                       │   │
│  │                                              │   │
│  │  ┌────────────┐  ┌───────────────────────┐   │   │
│  │  │ Arena      │  │ Agent Account (PDA)   │   │   │
│  │  │ State      │  │ - wallet (PDA)        │   │   │
│  │  │ - agents[] │  │ - strategy_config     │   │   │
│  │  │ - epoch    │  │ - performance_stats   │   │   │
│  │  │ - fees     │  │ - decision_log[]      │   │   │
│  │  └────────────┘  │ - risk_limits         │   │   │
│  │                  │ - investors[]          │   │   │
│  │                  └───────────────────────┘   │   │
│  │                                              │   │
│  │  Instructions:                               │   │
│  │  - create_agent(strategy, risk_params)       │   │
│  │  - execute_decision(action, reasoning_hash)  │   │
│  │  - invest_in_agent(agent, amount)            │   │
│  │  - withdraw_from_agent(agent, amount)        │   │
│  │  - update_leaderboard()                      │   │
│  │  - claim_rewards()                           │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │ Token Accounts (SPL)                         │   │
│  │ - USDC vault per agent                       │   │
│  │ - Agent share tokens (LP-like)               │   │
│  └──────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

### Смарт-контракт (Anchor/Rust) — ключевые структуры

```rust
#[account]
pub struct Arena {
    pub authority: Pubkey,
    pub total_agents: u64,
    pub epoch: u64,             // текущая эпоха (раунд конкуренции)
    pub epoch_duration: i64,    // длительность эпохи в секундах
    pub min_stake: u64,         // минимальный стейк для создания агента
    pub protocol_fee_bps: u16,  // комиссия протокола (basis points)
    pub bump: u8,
}

#[account]
pub struct AgentAccount {
    pub owner: Pubkey,
    pub arena: Pubkey,
    pub agent_id: u64,
    pub name: String,                  // имя агента
    pub strategy_description: String,  // описание стратегии
    pub wallet: Pubkey,                // PDA-кошелек агента
    pub total_deposited: u64,          // всего вложено инвесторами
    pub total_pnl: i64,               // общий PnL
    pub total_decisions: u64,          // кол-во решений
    pub win_rate: u16,                 // % успешных решений (basis points)
    pub max_drawdown_bps: u16,         // максимальный допустимый drawdown
    pub max_position_size_bps: u16,    // макс размер позиции
    pub is_active: bool,
    pub created_at: i64,
    pub last_decision_at: i64,
    pub bump: u8,
}

#[account]
pub struct Decision {
    pub agent: Pubkey,
    pub decision_id: u64,
    pub action: DecisionAction,        // Buy, Sell, Hold, Rebalance
    pub asset: String,                 // какой актив
    pub amount: u64,
    pub reasoning_hash: [u8; 32],      // SHA-256 хеш reasoning'а AI
    pub confidence_score: u8,          // 0-100
    pub executed: bool,
    pub result_pnl: i64,              // результат после исполнения
    pub timestamp: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum DecisionAction {
    Buy,
    Sell,
    Hold,
    Rebalance,
    StopLoss,
}
```

### AI Engine — как агент принимает решения

```typescript
// Цикл работы AI-агента
async function agentLoop(agent: AgentConfig) {
  while (agent.isActive) {
    // 1. Собираем данные
    const marketData = await fetchMarketData(); // цены, объемы, тренды
    const portfolio = await getAgentPortfolio(agent.pda);
    const riskMetrics = calculateRisk(portfolio);

    // 2. AI принимает решение
    const decision = await callAI({
      model: agent.model, // "gpt-4" | "claude" | custom
      prompt: buildPrompt(marketData, portfolio, riskMetrics, agent.strategy),
    });

    // 3. Проверяем risk limits (off-chain pre-check)
    if (!passesRiskCheck(decision, agent.riskParams)) {
      logSkipped(decision, "risk_limit_exceeded");
      continue;
    }

    // 4. Записываем решение on-chain
    const reasoningHash = sha256(JSON.stringify(decision.reasoning));
    await program.methods
      .executeDecision({
        action: decision.action,
        asset: decision.asset,
        amount: decision.amount,
        reasoningHash: reasoningHash,
        confidenceScore: decision.confidence,
      })
      .accounts({ agent: agent.pda, ... })
      .rpc();

    // 5. Ждем следующий цикл
    await sleep(agent.interval);
  }
}
```

### User Flow

1. **Создать агента** → Выбрать AI-модель, стратегию, risk limits → Внести стейк → Агент создается on-chain с PDA-кошельком
2. **Агент работает автономно** → Анализирует рынок → Принимает решения → Исполняет on-chain
3. **Лидерборд** → Все агенты ранжируются по PnL, Sharpe ratio, win rate
4. **Инвестировать** → Выбрать агента с лидерборда → Внести USDC → Получить share-токены
5. **Withdraw** → Сжечь share-токены → Получить долю портфеля агента

### Технологический стек

| Компонент | Технология |
|-----------|-----------|
| Smart Contract | Anchor (Rust) |
| Backend | Node.js / TypeScript |
| AI Models | OpenAI API / Anthropic API |
| Frontend | Next.js + Tailwind + Wallet Adapter |
| Data Feeds | Jupiter API, Pyth Oracle |
| Deployment | Solana Devnet |

### Почему это WOW

- **Визуальный демо**: 3-4 AI-агента торгуют live, лидерборд обновляется в реальном времени — как гонка
- **Глубокий Solana**: PDA wallets, SPL tokens (share tokens), CPI calls, on-chain decision logging
- **Инновация**: нет аналогов — конкурентный AI marketplace on-chain
- **Реальная ценность**: автоматизация DeFi management с прозрачностью

---

## Idea 2: NeuralEstate — AI, автономно управляющий токенизированной недвижимостью

### Концепт

Платформа для токенизации недвижимости с AI-управляющим. Объект недвижимости представлен как NFT, дробное владение через SPL-токены. AI-агент автономно управляет портфелем: устанавливает арендные ставки, распределяет доход, предлагает покупку/продажу — всё on-chain.

> "AI управляет зданием, вы получаете ренту в токенах"

### Проблемы, которые решаем

- **Высокий порог входа** — дробное владение позволяет купить 0.01% здания
- **Низкая ликвидность недвижимости** — токены можно продать мгновенно на DEX
- **Непрозрачность** — вся история владения и доходов on-chain
- **Сложное управление** — AI автоматизирует ценообразование, распределение и отчетность
- **Недоверие к посредникам** — смарт-контракт заменяет управляющую компанию

### Архитектура

```
┌──────────────────────────────────────────────────────┐
│                  Frontend (Next.js)                   │
│  ┌───────────┐ ┌────────────┐ ┌────────────────────┐ │
│  │ Property  │ │ Portfolio  │ │ AI Manager         │ │
│  │ Explorer  │ │ Dashboard  │ │ Dashboard          │ │
│  │ - Browse  │ │ - My tokens│ │ - Decisions log    │ │
│  │ - Buy     │ │ - Yield    │ │ - Performance      │ │
│  │ - Sell    │ │ - History  │ │ - Veto panel       │ │
│  └───────────┘ └────────────┘ └────────────────────┘ │
└──────────────────────┬───────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────┐
│             AI Property Manager (Node.js)            │
│                                                       │
│  ┌─────────────────────────────────────────────┐     │
│  │ Data Aggregator                             │     │
│  │ - Real estate price feeds (API)             │     │
│  │ - Rental market data                        │     │
│  │ - Occupancy rates                           │     │
│  │ - Macroeconomic indicators                  │     │
│  └──────────────────┬──────────────────────────┘     │
│                     │                                 │
│  ┌──────────────────▼──────────────────────────┐     │
│  │ AI Decision Engine (LLM + Custom Logic)     │     │
│  │                                             │     │
│  │ Capabilities:                               │     │
│  │ - Set optimal rental price                  │     │
│  │ - Trigger yield distribution                │     │
│  │ - Propose property acquisition/sale         │     │
│  │ - Risk assessment                           │     │
│  │ - Market trend analysis                     │     │
│  └──────────────────┬──────────────────────────┘     │
└─────────────────────┼────────────────────────────────┘
                      │
┌─────────────────────▼────────────────────────────────┐
│              Solana Blockchain (Devnet)               │
│                                                       │
│  ┌───────────────────────────────────────────────┐   │
│  │ NeuralEstate Program (Anchor)                 │   │
│  │                                               │   │
│  │  ┌─────────────────┐  ┌────────────────────┐  │   │
│  │  │ Property (PDA)  │  │ PropertyToken      │  │   │
│  │  │ - metadata      │  │ (SPL Token Mint)   │  │   │
│  │  │ - valuation     │  │ - total_supply     │  │   │
│  │  │ - rental_price  │  │ - per property     │  │   │
│  │  │ - yield_rate    │  │                    │  │   │
│  │  │ - ai_manager    │  └────────────────────┘  │   │
│  │  │ - oracle_data   │                          │   │
│  │  └─────────────────┘  ┌────────────────────┐  │   │
│  │                       │ YieldVault (PDA)   │  │   │
│  │  ┌─────────────────┐  │ - accumulated_rent │  │   │
│  │  │ AI Decision Log │  │ - last_distribution│  │   │
│  │  │ - action        │  │ - claimable[]      │  │   │
│  │  │ - reasoning_hash│  └────────────────────┘  │   │
│  │  │ - confidence    │                          │   │
│  │  │ - veto_deadline │  ┌────────────────────┐  │   │
│  │  │ - vetoed?       │  │ Governance (PDA)   │  │   │
│  │  └─────────────────┘  │ - veto_threshold   │  │   │
│  │                       │ - vote_period      │  │   │
│  │                       └────────────────────┘  │   │
│  │                                               │   │
│  │  Instructions:                                │   │
│  │  - create_property(metadata, valuation)       │   │
│  │  - mint_shares(property, investor, amount)    │   │
│  │  - ai_set_rental_price(property, price, hash) │   │
│  │  - distribute_yield(property)                 │   │
│  │  - claim_yield(property, investor)            │   │
│  │  - ai_propose_action(property, action, hash)  │   │
│  │  - veto_decision(decision_id)                 │   │
│  │  - transfer_shares(from, to, amount)          │   │
│  └───────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────┘
```

### Смарт-контракт — ключевые структуры

```rust
#[account]
pub struct Property {
    pub authority: Pubkey,
    pub property_id: u64,
    pub name: String,
    pub location: String,
    pub property_type: PropertyType,     // Residential, Commercial, Industrial
    pub total_area_sqm: u32,
    pub valuation_usd: u64,              // оценка в центах
    pub token_mint: Pubkey,              // SPL mint для дробного владения
    pub total_shares: u64,               // общее кол-во токенов
    pub current_rental_price: u64,       // текущая арендная ставка (cents/month)
    pub accumulated_yield: u64,          // накопленный yield
    pub last_yield_distribution: i64,    // timestamp последнего распределения
    pub ai_manager: Pubkey,              // кто может вызывать AI instructions
    pub oracle_data_hash: [u8; 32],      // хеш последних данных от оракула
    pub is_active: bool,
    pub created_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum PropertyType {
    Residential,
    Commercial,
    Industrial,
    Mixed,
}

#[account]
pub struct AIProposal {
    pub property: Pubkey,
    pub proposal_id: u64,
    pub action: ProposalAction,
    pub reasoning_hash: [u8; 32],
    pub confidence: u8,
    pub proposed_at: i64,
    pub veto_deadline: i64,              // до этого времени можно наложить вето
    pub veto_votes: u64,                 // кол-во голосов "против"
    pub veto_threshold: u64,             // порог для отмены
    pub executed: bool,
    pub vetoed: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum ProposalAction {
    SetRentalPrice { new_price: u64 },
    DistributeYield,
    ProposeAcquisition { target_property: String, price: u64 },
    ProposeSale { min_price: u64 },
    AdjustValuation { new_valuation: u64 },
}
```

### AI Property Manager — логика

```typescript
async function propertyManagerLoop(property: PropertyConfig) {
  while (true) {
    // 1. Собираем рыночные данные
    const marketData = await fetchRealEstateData(property.location);
    const rentalComps = await fetchRentalComparables(property);
    const occupancy = await fetchOccupancyData(property);
    const macro = await fetchMacroIndicators(); // ставки, инфляция

    // 2. AI анализирует и принимает решение
    const analysis = await callAI({
      model: "claude-sonnet-4-6",
      prompt: `
        You are a property manager AI. Analyze the following data and decide:
        1. Should the rental price be adjusted? If yes, to what?
        2. Should yield be distributed to token holders now?
        3. Are there any risks or opportunities?

        Property: ${JSON.stringify(property.metadata)}
        Current rental: $${property.rentalPrice}/month
        Market comparables: ${JSON.stringify(rentalComps)}
        Occupancy: ${occupancy}%
        Macro: ${JSON.stringify(macro)}

        Respond with a structured decision.
      `,
    });

    // 3. Если нужно менять цену — отправляем proposal on-chain
    if (analysis.adjustRentalPrice) {
      const reasoningHash = sha256(analysis.fullReasoning);

      await program.methods
        .aiProposeAction({
          action: {
            setRentalPrice: { newPrice: analysis.newPrice }
          },
          reasoningHash,
          confidence: analysis.confidence,
        })
        .accounts({ property: property.pda, aiManager: wallet.publicKey })
        .rpc();

      // Proposal создан — у холдеров есть 24h на вето
    }

    // 4. Распределение yield (если пришло время)
    if (analysis.distributeYield) {
      await program.methods
        .distributeYield()
        .accounts({ property: property.pda })
        .rpc();
    }

    await sleep(6 * 60 * 60 * 1000); // каждые 6 часов
  }
}
```

### User Flow

1. **Админ создает объект** → Загружает метаданные (фото, документы, локация) → Устанавливает оценку → Минтит share-токены
2. **Инвестор покупает доли** → Просматривает каталог → Покупает токены за USDC → Получает пропорциональное право на yield
3. **AI управляет** → Автоматически корректирует арендные ставки → Распределяет доход → Предлагает стратегические решения
4. **Governance** → Если холдеры не согласны с AI — голосуют за вето → Если набирается порог — решение отменяется
5. **Claim yield** → Инвестор забирает накопленный доход в USDC

### Технологический стек

| Компонент | Технология |
|-----------|-----------|
| Smart Contract | Anchor (Rust) |
| AI Manager | Node.js + Anthropic API |
| Frontend | Next.js + Tailwind + Wallet Adapter |
| Real Estate Data | Mock API (для MVP) |
| Oracle | Custom off-chain oracle (property valuation) |
| Deployment | Solana Devnet |

### Почему это WOW

- **Два кейса в одном**: RWA (токенизация недвижимости) + AI (автономное управление) — максимальные бонусные баллы
- **Понятно судьям**: "AI управляет зданием, вы получаете ренту в токенах" — не нужно объяснять
- **Human-AI governance**: уникальная механика вето — доверяй AI, но проверяй
- **Глубокий Solana**: SPL tokens для дробного владения, PDA для property accounts, on-chain yield distribution

---

## Idea 3: Proof of Intelligence (PoI) — Инфраструктурный протокол для верифицируемого AI on-chain

### Концепт

Инфраструктурный протокол-стандарт, который позволяет любому AI-агенту доказать свои решения on-chain. Не приложение, а **слой** — другие проекты строят поверх. Включает SDK, стандарт записи решений, систему верификации и демо-приложение.

> "ERC-20 для AI решений. Стандарт того, как AI взаимодействует с блокчейном."

### Проблемы, которые решаем

- **Нет стандарта для AI + blockchain** — каждый проект изобретает свой формат, нет interoperability
- **Непрозрачность AI** — невозможно верифицировать, что AI действительно принял решение (а не человек)
- **Сложно интегрировать AI с контрактами** — разработчикам нужно писать всё с нуля
- **Нет accountability** — если AI ошибся, нет аудит-трейла
- **Фрагментация** — 100 AI-агентов, 100 форматов, 0 совместимости

### Архитектура

```
┌──────────────────────────────────────────────────────────┐
│                    Consumer Applications                  │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ AI       │  │ Autonomous   │  │ Any dApp using     │  │
│  │ Trading  │  │ Lending      │  │ PoI Protocol       │  │
│  │ Bot      │  │ Protocol     │  │                    │  │
│  └─────┬────┘  └──────┬───────┘  └─────────┬──────────┘  │
└────────┼──────────────┼────────────────────┼─────────────┘
         │              │                    │
         ▼              ▼                    ▼
┌──────────────────────────────────────────────────────────┐
│                  PoI SDK (TypeScript)                     │
│                                                          │
│  // 10 lines to connect any AI to Solana                 │
│  const poi = new PoIClient(connection, wallet);          │
│  const decision = await myAI.analyze(data);              │
│  await poi.submitDecision({                              │
│    action: "swap",                                       │
│    params: { from: "SOL", to: "USDC", amount: 100 },    │
│    reasoning: decision.reasoning,                        │
│    confidence: decision.confidence,                      │
│    modelId: "claude-sonnet-4-6",                         │
│  });                                                     │
│                                                          │
│  Classes:                                                │
│  - PoIClient — main client                               │
│  - DecisionBuilder — construct decisions                 │
│  - VerificationClient — verify past decisions            │
│  - OracleConnector — feed external data                  │
└────────────────────────┬─────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────┐
│              Solana Blockchain (Devnet)                   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │ PoI Protocol Program (Anchor)                    │    │
│  │                                                  │    │
│  │  ┌──────────────────┐  ┌──────────────────────┐  │    │
│  │  │ Registry (PDA)   │  │ Agent Registry       │  │    │
│  │  │ - protocol_ver   │  │ - agent_id           │  │    │
│  │  │ - total_agents   │  │ - owner              │  │    │
│  │  │ - total_decisions│  │ - model_id           │  │    │
│  │  │ - fee_config     │  │ - total_decisions    │  │    │
│  │  └──────────────────┘  │ - accuracy_score     │  │    │
│  │                        │ - reputation         │  │    │
│  │                        └──────────────────────┘  │    │
│  │                                                  │    │
│  │  ┌──────────────────────────────────────────┐    │    │
│  │  │ Decision Record (PDA)                    │    │    │
│  │  │ - agent: Pubkey                          │    │    │
│  │  │ - decision_type: DecisionType            │    │    │
│  │  │ - input_data_hash: [u8; 32]              │    │    │
│  │  │ - reasoning_hash: [u8; 32]               │    │    │
│  │  │ - output_action: ActionPayload           │    │    │
│  │  │ - confidence: u8                         │    │    │
│  │  │ - model_id: String                       │    │    │
│  │  │ - timestamp: i64                         │    │    │
│  │  │ - verification_status: VerifStatus       │    │    │
│  │  │ - outcome: Option<Outcome>               │    │    │
│  │  └──────────────────────────────────────────┘    │    │
│  │                                                  │    │
│  │  ┌──────────────────────────────────────────┐    │    │
│  │  │ Confidence Gate (PDA)                    │    │    │
│  │  │ - min_confidence: u8                     │    │    │
│  │  │ - required_verifications: u8             │    │    │
│  │  │ - allowed_models: Vec<String>            │    │    │
│  │  │ - auto_execute: bool                     │    │    │
│  │  │ - callback_program: Option<Pubkey>       │    │    │
│  │  └──────────────────────────────────────────┘    │    │
│  │                                                  │    │
│  │  Instructions:                                   │    │
│  │  - register_agent(model_id, metadata)            │    │
│  │  - submit_decision(decision_data)                │    │
│  │  - verify_decision(decision_id, outcome)         │    │
│  │  - create_confidence_gate(params)                │    │
│  │  - execute_gated_action(decision_id)             │    │
│  │  - update_reputation(agent_id, delta)            │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │ Demo App: AI-Managed Lending Pool                │    │
│  │ - AI sets interest rates based on market         │    │
│  │ - Uses PoI to record every rate decision         │    │
│  │ - Confidence Gate: rate changes only if          │    │
│  │   confidence > 80%                               │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

### Смарт-контракт — ключевые структуры

```rust
#[account]
pub struct ProtocolRegistry {
    pub authority: Pubkey,
    pub version: u8,
    pub total_agents: u64,
    pub total_decisions: u64,
    pub protocol_fee_lamports: u64,
    pub bump: u8,
}

#[account]
pub struct AIAgent {
    pub owner: Pubkey,
    pub agent_id: u64,
    pub model_id: String,              // "claude-sonnet-4-6", "gpt-4", etc.
    pub metadata_uri: String,          // IPFS/Arweave link to agent description
    pub total_decisions: u64,
    pub correct_decisions: u64,
    pub reputation_score: u32,         // 0-10000 (basis points)
    pub is_active: bool,
    pub registered_at: i64,
    pub bump: u8,
}

#[account]
pub struct DecisionRecord {
    pub agent: Pubkey,
    pub decision_id: u64,
    pub decision_type: DecisionType,
    pub input_data_hash: [u8; 32],     // hash входных данных
    pub reasoning_hash: [u8; 32],      // hash reasoning'а AI
    pub output_action: Vec<u8>,        // сериализованное действие
    pub confidence: u8,                // 0-100
    pub model_id: String,
    pub timestamp: i64,
    pub verification_status: VerificationStatus,
    pub outcome_pnl: Option<i64>,      // результат, если измерим
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum DecisionType {
    Trade,           // buy/sell
    RateAdjustment,  // изменение параметров
    RiskAssessment,  // оценка риска
    Allocation,      // распределение активов
    Custom(String),  // кастомный тип
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum VerificationStatus {
    Pending,
    Verified,
    Disputed,
    Expired,
}

/// Confidence Gate — фильтр, который пропускает только
/// решения с достаточной уверенностью
#[account]
pub struct ConfidenceGate {
    pub owner: Pubkey,
    pub min_confidence: u8,             // минимальный confidence score
    pub required_verifications: u8,     // сколько подтверждений нужно
    pub allowed_models: Vec<String>,    // какие модели допускаются
    pub auto_execute: bool,             // автоисполнение при прохождении
    pub callback_program: Option<Pubkey>, // CPI в другую программу
    pub total_passed: u64,
    pub total_rejected: u64,
    pub bump: u8,
}
```

### SDK — пример использования (TypeScript)

```typescript
import { PoIClient, DecisionBuilder } from "@poi-protocol/sdk";

// Инициализация
const poi = new PoIClient(connection, wallet);

// 1. Регистрация AI-агента
const agentId = await poi.registerAgent({
  modelId: "claude-sonnet-4-6",
  metadata: {
    name: "My Trading Bot",
    description: "Momentum-based SOL/USDC trader",
    version: "1.0.0",
  },
});

// 2. AI принимает решение
const marketData = await fetchMarketData();
const aiResponse = await anthropic.messages.create({
  model: "claude-sonnet-4-6",
  messages: [{ role: "user", content: `Analyze: ${JSON.stringify(marketData)}` }],
});

// 3. Записываем решение on-chain (3 строки!)
const decision = new DecisionBuilder()
  .setType("trade")
  .setAction({ swap: { from: "SOL", to: "USDC", amount: 100 } })
  .setReasoning(aiResponse.content)
  .setConfidence(85)
  .build();

const txHash = await poi.submitDecision(agentId, decision);

// 4. Верификация (позже, когда известен результат)
await poi.verifyDecision(decision.id, {
  outcome: "profit",
  pnl: 250, // $2.50 profit
});

// 5. Проверка решений другого агента
const history = await poi.getAgentDecisions(otherAgentId, { limit: 50 });
const reputation = await poi.getAgentReputation(otherAgentId);
```

### Demo App: AI-Managed Lending Pool

Для демонстрации протокола строим приложение поверх:

```
Lending Pool + PoI Protocol:

1. AI анализирует рынок каждый час
2. AI предлагает новую процентную ставку
3. Решение записывается через PoI Protocol
4. Confidence Gate проверяет: confidence >= 80?
   - Да → ставка автоматически меняется в lending pool
   - Нет → решение отклоняется, используется предыдущая ставка
5. Через время: результат решения записывается → reputation агента обновляется
```

### User Flow

**Для разработчиков (основная аудитория):**
1. `npm install @poi-protocol/sdk`
2. Зарегистрировать AI-агента (1 вызов)
3. Подключить свою AI-модель
4. Записывать решения через SDK (3 строки кода)

**Для конечных пользователей (demo app):**
1. Открыть Lending Pool UI
2. Видеть текущую ставку и историю решений AI
3. Кликнуть на любое решение → увидеть confidence, модель, timestamp
4. Внести средства в пул

### Технологический стек

| Компонент | Технология |
|-----------|-----------|
| Protocol Program | Anchor (Rust) |
| SDK | TypeScript (npm package) |
| Demo App Backend | Node.js + Anthropic API |
| Demo App Frontend | Next.js + Tailwind |
| Documentation | Docusaurus / README |
| Deployment | Solana Devnet |

### Почему это WOW

- **Инфраструктурный масштаб**: "Мы не построили приложение — мы построили протокол, на котором другие строят приложения"
- **SDK за 10 строк**: судьи увидят, как просто подключить AI к Solana
- **Confidence Gate** — уникальная on-chain примитива, которой нет нигде
- **Reputation system** — on-chain репутация AI-агентов, верифицируемая и прозрачная
- **Demo app** — не просто протокол, а работающее приложение поверх

---

## Сравнительная таблица

| Критерий | AI Arena | NeuralEstate | Proof of Intelligence |
|----------|----------|-------------|----------------------|
| **WOW-фактор демо** | ★★★★★ | ★★★★☆ | ★★★☆☆ |
| **Инновационность** | ★★★★★ | ★★★★☆ | ★★★★★ |
| **Понятность судьям** | ★★★★☆ | ★★★★★ | ★★★☆☆ |
| **Глубина Solana** | ★★★★★ | ★★★★☆ | ★★★★★ |
| **Реальная ценность** | ★★★★☆ | ★★★★★ | ★★★★☆ |
| **Бонус за RWA** | ☆☆☆☆☆ | ★★★★★ | ★★☆☆☆ |
| **Сложность разработки** | High | Medium | Medium-High |
| **Скорость MVP** | ~8 дней | ~6 дней | ~7 дней |

## Рекомендация

Если выбирать одну:
- **Максимальный WOW** → AI Arena (живые агенты, конкурирующие на демо)
- **Самый безопасный выбор** → NeuralEstate (два кейса в одном, понятно всем)
- **Самый амбициозный** → Proof of Intelligence (инфраструктура > приложение)

## Комбинация-убийца

Можно объединить **PoI Protocol + AI Arena**: AI-агенты конкурируют, но все решения записываются через стандартизированный PoI-протокол. Это даёт и инфраструктуру, и визуальный демо.
