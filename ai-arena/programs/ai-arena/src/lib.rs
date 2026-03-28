use anchor_lang::prelude::*;

declare_id!("EpCHhXou3cP7c9CJbY6ACwjKwA56q79BeYZ5auTixBLY");

// Pyth SOL/USD price feed on devnet
pub const PYTH_SOL_USD_DEVNET: &str = "J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix";

// ============================================================================
// Constants
// ============================================================================

pub const MAX_STRATEGY_NAME_LEN: usize = 32;
pub const MAX_MODEL_ID_LEN: usize = 32;
pub const MAX_PAIR_LEN: usize = 12;

// ============================================================================
// Program
// ============================================================================

#[program]
pub mod ai_arena {
    use super::*;

    pub fn initialize_arena(
        ctx: Context<InitializeArena>,
        active_pair: String,
        min_confidence: u8,
        max_trade_size: u64,
        cooldown_seconds: i64,
    ) -> Result<()> {
        require!(active_pair.len() <= MAX_PAIR_LEN, ArenaError::StringTooLong);
        require!(min_confidence <= 100, ArenaError::InvalidConfidence);
        require!(max_trade_size > 0, ArenaError::InvalidAmount);

        let arena = &mut ctx.accounts.arena_state;
        arena.authority = ctx.accounts.authority.key();
        arena.operator = ctx.accounts.authority.key(); // default: authority is operator
        arena.active_pair = active_pair;
        arena.cycle_counter = 0;
        arena.agents_count = 0;
        arena.bump = ctx.bumps.arena_state;

        let gate = &mut ctx.accounts.confidence_gate;
        gate.arena = arena.key();
        gate.min_confidence = min_confidence;
        gate.max_trade_size = max_trade_size;
        gate.allowed_actions = 0b111; // Buy=1, Sell=2, Hold=4 — all allowed
        gate.cooldown_seconds = cooldown_seconds;
        gate.bump = ctx.bumps.confidence_gate;

        msg!("Arena initialized: {}", arena.active_pair);
        Ok(())
    }

    pub fn set_operator(ctx: Context<SetOperator>, new_operator: Pubkey) -> Result<()> {
        ctx.accounts.arena_state.operator = new_operator;
        msg!("Operator set to: {}", new_operator);
        Ok(())
    }

    pub fn register_agent(
        ctx: Context<RegisterAgent>,
        agent_id: u64,
        strategy_name: String,
        model_id: String,
        max_trade_size: u64,
        max_position_size: u64,
    ) -> Result<()> {
        require!(strategy_name.len() <= MAX_STRATEGY_NAME_LEN, ArenaError::StringTooLong);
        require!(model_id.len() <= MAX_MODEL_ID_LEN, ArenaError::StringTooLong);
        require!(max_position_size >= max_trade_size, ArenaError::InvalidAmount);

        let profile = &mut ctx.accounts.agent_profile;
        profile.arena = ctx.accounts.arena_state.key();
        profile.agent_id = agent_id;
        profile.strategy_name = strategy_name.clone();
        profile.model_id = model_id;
        profile.status = AgentStatus::Active;
        profile.max_trade_size = max_trade_size;
        profile.max_position_size = max_position_size;
        profile.last_decision_ts = 0;
        profile.bump = ctx.bumps.agent_profile;

        let position = &mut ctx.accounts.agent_position;
        position.arena = ctx.accounts.arena_state.key();
        position.agent = profile.key();
        position.current_side = PositionSide::Flat;
        position.current_size = 0;
        position.average_entry_price = 0;
        position.realized_pnl = 0;
        position.unrealized_pnl = 0;
        position.total_executed = 0;
        position.last_executed_cycle = 0;
        position.last_executed_at = 0;
        position.bump = ctx.bumps.agent_position;

        let arena = &mut ctx.accounts.arena_state;
        arena.agents_count += 1;

        msg!("Agent registered: {} (id={})", strategy_name, agent_id);
        Ok(())
    }

    pub fn submit_decision(
        ctx: Context<SubmitDecision>,
        cycle_id: u64,
        input_hash: [u8; 32],
        action: DecisionAction,
        side: TradeSide,
        amount: u64,
        confidence: u8,
        reasoning_hash: [u8; 32],
        fallback_oracle_price: u64,
        fallback_oracle_timestamp: i64,
        fallback_oracle_confidence: u64,
    ) -> Result<()> {
        require!(confidence <= 100, ArenaError::InvalidConfidence);

        let arena = &ctx.accounts.arena_state;
        let gate = &ctx.accounts.confidence_gate;
        let agent = &ctx.accounts.agent_profile;
        let position = &ctx.accounts.agent_position;
        let clock = Clock::get()?;

        // --- Read oracle price ---
        // Runtime (devnet): Pyth account is required as remaining_accounts[0].
        // Local tests only: no remaining accounts → use fallback values.
        let (oracle_price, oracle_timestamp, oracle_confidence) =
            if let Some(pyth_account) = ctx.remaining_accounts.first() {
                // Validate this is the expected Pyth SOL/USD feed
                let expected_pyth: Pubkey = PYTH_SOL_USD_DEVNET.parse().unwrap();
                require!(pyth_account.key() == expected_pyth, ArenaError::OracleInvalidAccount);

                let data = pyth_account.try_borrow_data()?;
                require!(data.len() >= 224, ArenaError::OracleError);

                // Pyth V2 PriceAccount layout:
                // Offset 20:  exponent (i32)
                // Offset 200: agg.publish_time (i64)
                // Offset 208: agg.price (i64)
                // Offset 216: agg.conf (u64)
                let expo = i32::from_le_bytes(data[20..24].try_into().map_err(|_| ArenaError::OracleError)?);
                let agg_price = i64::from_le_bytes(data[208..216].try_into().map_err(|_| ArenaError::OracleError)?);
                let agg_conf = u64::from_le_bytes(data[216..224].try_into().map_err(|_| ArenaError::OracleError)?);
                let agg_timestamp = i64::from_le_bytes(data[200..208].try_into().map_err(|_| ArenaError::OracleError)?);

                require!(agg_price > 0, ArenaError::OracleError);

                let price_val = if expo >= 0 {
                    (agg_price as u64) * 10u64.pow(expo as u32) * 1_000_000
                } else {
                    let divisor = 10i64.pow((-expo) as u32);
                    ((agg_price as i128 * 1_000_000) / divisor as i128) as u64
                };
                let conf_val = if expo >= 0 {
                    agg_conf * 10u64.pow(expo as u32) * 1_000_000
                } else {
                    let divisor = 10u64.pow((-expo) as u32);
                    (agg_conf * 1_000_000) / divisor
                };

                let age = clock.unix_timestamp - agg_timestamp;
                // NOTE: Pyth devnet feed is stale (last updated Aug 2024).
                // In production, enforce: require!(age < 300, ArenaError::OraclePriceStale);
                msg!("Oracle on-chain: price={} conf={} age={}s (devnet feed stale)", price_val, conf_val, age);
                (price_val, agg_timestamp, conf_val)
            } else {
                // Local test mode only — no Pyth account available on localnet
                msg!("LOCAL TEST MODE: fallback oracle price={}", fallback_oracle_price);
                (fallback_oracle_price, fallback_oracle_timestamp, fallback_oracle_confidence)
            };

        // --- Gate evaluation ---
        let gate_status = evaluate_gate(
            &action,
            amount,
            confidence,
            gate,
            agent,
            position,
            arena,
            clock.unix_timestamp,
        );

        // --- Write DecisionRecord ---
        let record = &mut ctx.accounts.decision_record;
        record.arena = arena.key();
        record.agent = agent.key();
        record.cycle_id = cycle_id;
        record.input_hash = input_hash;
        record.action = action;
        record.side = side;
        record.amount = amount;
        record.confidence = confidence;
        record.reasoning_hash = reasoning_hash;
        record.gate_status = gate_status.clone();
        record.oracle_price = oracle_price;
        record.oracle_timestamp = oracle_timestamp;
        record.oracle_confidence = oracle_confidence;
        record.created_at = clock.unix_timestamp;
        record.bump = ctx.bumps.decision_record;

        // Update agent last decision timestamp
        let agent_profile = &mut ctx.accounts.agent_profile;
        agent_profile.last_decision_ts = clock.unix_timestamp;

        match gate_status {
            GateStatus::Approved => msg!("Decision APPROVED (cycle={}, confidence={})", cycle_id, confidence),
            _ => msg!("Decision BLOCKED: {:?} (cycle={}, confidence={})", gate_status, cycle_id, confidence),
        }

        Ok(())
    }

    pub fn execute_decision(ctx: Context<ExecuteDecision>) -> Result<()> {
        let decision = &ctx.accounts.decision_record;
        require!(decision.gate_status == GateStatus::Approved, ArenaError::DecisionNotApproved);

        let clock = Clock::get()?;

        // --- Update AgentPosition ---
        let position = &mut ctx.accounts.agent_position;

        let (executed, position_delta, pnl_delta) = match decision.action {
            DecisionAction::Buy => {
                let new_size = position.current_size.checked_add(decision.amount)
                    .ok_or(ArenaError::Overflow)?;

                // Update average entry price (weighted average)
                if position.current_size == 0 {
                    position.average_entry_price = decision.oracle_price;
                } else {
                    let total_cost = (position.average_entry_price as u128)
                        .checked_mul(position.current_size as u128)
                        .ok_or(ArenaError::Overflow)?;
                    let new_cost = (decision.oracle_price as u128)
                        .checked_mul(decision.amount as u128)
                        .ok_or(ArenaError::Overflow)?;
                    let combined = total_cost.checked_add(new_cost)
                        .ok_or(ArenaError::Overflow)?;
                    position.average_entry_price = (combined / new_size as u128) as u64;
                }

                position.current_size = new_size;
                position.current_side = PositionSide::Long;

                (true, decision.amount as i64, 0i64)
            }
            DecisionAction::Sell => {
                let sell_amount = decision.amount.min(position.current_size);

                // Calculate realized PnL
                let pnl = if position.average_entry_price > 0 && sell_amount > 0 {
                    let entry = position.average_entry_price as i64;
                    let exit = decision.oracle_price as i64;
                    let diff = exit - entry;
                    (diff as i128 * sell_amount as i128 / 1_000_000) as i64 // adjust for fixed-point
                } else {
                    0
                };

                position.current_size = position.current_size.saturating_sub(sell_amount);
                if position.current_size == 0 {
                    position.current_side = PositionSide::Flat;
                    position.average_entry_price = 0;
                }
                position.realized_pnl = position.realized_pnl.checked_add(pnl).unwrap_or(position.realized_pnl);

                (true, -(sell_amount as i64), pnl)
            }
            DecisionAction::Hold => {
                (true, 0, 0)
            }
        };

        position.total_executed += 1;
        position.last_executed_cycle = decision.cycle_id;
        position.last_executed_at = clock.unix_timestamp;

        // --- Create ExecutionRecord ---
        let execution = &mut ctx.accounts.execution_record;
        execution.decision = decision.key();
        execution.executed = executed;
        execution.blocked = false;
        execution.execution_price = decision.oracle_price;
        execution.position_delta = position_delta;
        execution.pnl_delta = pnl_delta;
        execution.timestamp = clock.unix_timestamp;
        execution.bump = ctx.bumps.execution_record;

        msg!(
            "Decision executed: action={:?}, delta={}, pnl={}",
            decision.action,
            position_delta,
            pnl_delta
        );
        Ok(())
    }

    pub fn record_outcome(
        ctx: Context<RecordOutcome>,
        current_oracle_price: u64,
    ) -> Result<()> {
        let position = &mut ctx.accounts.agent_position;

        // Update unrealized PnL (mark-to-market) based on current oracle price.
        // ExecutionRecord.pnl_delta is NOT overwritten — it stores realized execution PnL only.
        if position.current_size > 0 && position.average_entry_price > 0 {
            let entry = position.average_entry_price as i64;
            let current = current_oracle_price as i64;
            let diff = current - entry;
            position.unrealized_pnl = (diff as i128 * position.current_size as i128 / 1_000_000) as i64;
        } else {
            position.unrealized_pnl = 0;
        }

        msg!(
            "Outcome recorded: unrealized_pnl={}",
            position.unrealized_pnl
        );
        Ok(())
    }
}

// ============================================================================
// Gate evaluation logic
// ============================================================================

fn evaluate_gate(
    action: &DecisionAction,
    amount: u64,
    confidence: u8,
    gate: &ConfidenceGate,
    agent: &AgentProfile,
    position: &AgentPosition,
    _arena: &ArenaState,
    current_timestamp: i64,
) -> GateStatus {
    // Check 1: Agent must be active
    if agent.status != AgentStatus::Active {
        return GateStatus::BlockedInvalidAction;
    }

    // Check 2: Confidence threshold
    if confidence < gate.min_confidence {
        return GateStatus::BlockedLowConfidence;
    }

    // Check 3: Trade size limit
    if amount > gate.max_trade_size || amount > agent.max_trade_size {
        return GateStatus::BlockedRiskLimit;
    }

    // Check 4: Action must be allowed
    let action_bit = match action {
        DecisionAction::Buy => 0b001,
        DecisionAction::Sell => 0b010,
        DecisionAction::Hold => 0b100,
    };
    if gate.allowed_actions & action_bit == 0 {
        return GateStatus::BlockedInvalidAction;
    }

    // Check 5: Position limit (for buys)
    if let DecisionAction::Buy = action {
        let projected_size = position.current_size.saturating_add(amount);
        if projected_size > agent.max_position_size {
            return GateStatus::BlockedPositionLimit;
        }
    }

    // Check 6: Cooldown
    if position.last_executed_at > 0 && gate.cooldown_seconds > 0 {
        let elapsed = current_timestamp - position.last_executed_at;
        if elapsed < gate.cooldown_seconds {
            return GateStatus::BlockedCooldown;
        }
    }

    GateStatus::Approved
}

// ============================================================================
// Accounts (Contexts)
// ============================================================================

#[derive(Accounts)]
pub struct InitializeArena<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + ArenaState::INIT_SPACE,
        seeds = [b"arena", authority.key().as_ref()],
        bump
    )]
    pub arena_state: Account<'info, ArenaState>,

    #[account(
        init,
        payer = authority,
        space = 8 + ConfidenceGate::INIT_SPACE,
        seeds = [b"gate", arena_state.key().as_ref()],
        bump
    )]
    pub confidence_gate: Account<'info, ConfidenceGate>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetOperator<'info> {
    #[account(
        mut,
        has_one = authority,
    )]
    pub arena_state: Account<'info, ArenaState>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(agent_id: u64)]
pub struct RegisterAgent<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        has_one = authority,
    )]
    pub arena_state: Account<'info, ArenaState>,

    #[account(
        init,
        payer = authority,
        space = 8 + AgentProfile::INIT_SPACE,
        seeds = [b"agent", arena_state.key().as_ref(), &agent_id.to_le_bytes()],
        bump
    )]
    pub agent_profile: Account<'info, AgentProfile>,

    #[account(
        init,
        payer = authority,
        space = 8 + AgentPosition::INIT_SPACE,
        seeds = [b"position", arena_state.key().as_ref(), &agent_id.to_le_bytes()],
        bump
    )]
    pub agent_position: Account<'info, AgentPosition>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(cycle_id: u64)]
pub struct SubmitDecision<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,

    #[account(
        has_one = operator,
    )]
    pub arena_state: Account<'info, ArenaState>,

    #[account(
        mut,
        constraint = agent_profile.arena == arena_state.key() @ ArenaError::InvalidArena,
    )]
    pub agent_profile: Account<'info, AgentProfile>,

    #[account(
        constraint = agent_position.agent == agent_profile.key() @ ArenaError::InvalidAgent,
    )]
    pub agent_position: Account<'info, AgentPosition>,

    #[account(
        constraint = confidence_gate.arena == arena_state.key() @ ArenaError::InvalidArena,
    )]
    pub confidence_gate: Account<'info, ConfidenceGate>,

    #[account(
        init,
        payer = operator,
        space = 8 + DecisionRecord::INIT_SPACE,
        seeds = [
            b"decision",
            arena_state.key().as_ref(),
            agent_profile.key().as_ref(),
            &cycle_id.to_le_bytes()
        ],
        bump
    )]
    pub decision_record: Account<'info, DecisionRecord>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteDecision<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,

    #[account(
        has_one = operator,
    )]
    pub arena_state: Account<'info, ArenaState>,

    #[account(
        constraint = decision_record.arena == arena_state.key() @ ArenaError::InvalidArena,
    )]
    pub decision_record: Account<'info, DecisionRecord>,

    #[account(
        mut,
        constraint = agent_position.arena == arena_state.key() @ ArenaError::InvalidArena,
    )]
    pub agent_position: Account<'info, AgentPosition>,

    #[account(
        init,
        payer = operator,
        space = 8 + ExecutionRecord::INIT_SPACE,
        seeds = [b"execution", decision_record.key().as_ref()],
        bump
    )]
    pub execution_record: Account<'info, ExecutionRecord>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordOutcome<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,

    #[account(
        has_one = operator,
    )]
    pub arena_state: Account<'info, ArenaState>,

    #[account(mut)]
    pub agent_position: Account<'info, AgentPosition>,
}

// ============================================================================
// State accounts
// ============================================================================

#[account]
#[derive(InitSpace)]
pub struct ArenaState {
    pub authority: Pubkey,          // 32
    pub operator: Pubkey,           // 32
    #[max_len(MAX_PAIR_LEN)]
    pub active_pair: String,        // 4 + 12
    pub cycle_counter: u64,         // 8
    pub agents_count: u8,           // 1
    pub bump: u8,                   // 1
}

#[account]
#[derive(InitSpace)]
pub struct AgentProfile {
    pub arena: Pubkey,              // 32
    pub agent_id: u64,              // 8
    #[max_len(MAX_STRATEGY_NAME_LEN)]
    pub strategy_name: String,      // 4 + 32
    #[max_len(MAX_MODEL_ID_LEN)]
    pub model_id: String,           // 4 + 32
    pub status: AgentStatus,        // 1
    pub max_trade_size: u64,        // 8
    pub max_position_size: u64,     // 8
    pub last_decision_ts: i64,      // 8
    pub bump: u8,                   // 1
}

#[account]
#[derive(InitSpace)]
pub struct AgentPosition {
    pub arena: Pubkey,              // 32
    pub agent: Pubkey,              // 32
    pub current_side: PositionSide, // 1
    pub current_size: u64,          // 8
    pub average_entry_price: u64,   // 8
    pub realized_pnl: i64,          // 8
    pub unrealized_pnl: i64,        // 8
    pub total_executed: u64,        // 8
    pub last_executed_cycle: u64,   // 8
    pub last_executed_at: i64,      // 8
    pub bump: u8,                   // 1
}

#[account]
#[derive(InitSpace)]
pub struct DecisionRecord {
    pub arena: Pubkey,              // 32
    pub agent: Pubkey,              // 32
    pub cycle_id: u64,              // 8
    pub input_hash: [u8; 32],       // 32
    pub action: DecisionAction,     // 1
    pub side: TradeSide,            // 1
    pub amount: u64,                // 8
    pub confidence: u8,             // 1
    pub reasoning_hash: [u8; 32],   // 32
    pub gate_status: GateStatus,    // 1
    pub oracle_price: u64,          // 8
    pub oracle_timestamp: i64,      // 8
    pub oracle_confidence: u64,     // 8
    pub created_at: i64,            // 8
    pub bump: u8,                   // 1
}

#[account]
#[derive(InitSpace)]
pub struct ConfidenceGate {
    pub arena: Pubkey,              // 32
    pub min_confidence: u8,         // 1
    pub max_trade_size: u64,        // 8
    pub allowed_actions: u8,        // 1 (bitmask)
    pub cooldown_seconds: i64,      // 8
    pub bump: u8,                   // 1
}

#[account]
#[derive(InitSpace)]
pub struct ExecutionRecord {
    pub decision: Pubkey,           // 32
    pub executed: bool,             // 1
    pub blocked: bool,              // 1
    pub execution_price: u64,       // 8
    pub position_delta: i64,        // 8
    pub pnl_delta: i64,            // 8
    pub timestamp: i64,             // 8
    pub bump: u8,                   // 1
}

// ============================================================================
// Enums
// ============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug, InitSpace)]
pub enum DecisionAction {
    Buy,
    Sell,
    Hold,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug, InitSpace)]
pub enum TradeSide {
    Base,   // SOL
    Quote,  // USDC
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug, InitSpace)]
pub enum AgentStatus {
    Active,
    Paused,
    Stopped,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug, InitSpace)]
pub enum PositionSide {
    Flat,
    Long,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug, InitSpace)]
pub enum GateStatus {
    Approved,
    BlockedLowConfidence,
    BlockedRiskLimit,
    BlockedInvalidAction,
    BlockedPositionLimit,
    BlockedCooldown,
}

// ============================================================================
// Errors
// ============================================================================

#[error_code]
pub enum ArenaError {
    #[msg("String exceeds maximum length")]
    StringTooLong,
    #[msg("Confidence must be 0-100")]
    InvalidConfidence,
    #[msg("Amount must be greater than 0")]
    InvalidAmount,
    #[msg("Decision not approved by gate")]
    DecisionNotApproved,
    #[msg("Arena mismatch")]
    InvalidArena,
    #[msg("Agent mismatch")]
    InvalidAgent,
    #[msg("Decision mismatch")]
    InvalidDecision,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Oracle price feed error")]
    OracleError,
    #[msg("Oracle price is stale")]
    OraclePriceStale,
    #[msg("Invalid oracle account — expected Pyth SOL/USD feed")]
    OracleInvalidAccount,
}
