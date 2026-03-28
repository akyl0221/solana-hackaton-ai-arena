# AI Arena: Architecture Alignment Plan

## Summary

- Базовый MVP уже существует: on-chain accounts, cycle runner, reasoning lifecycle, frontend dashboard и README есть.
- Основной разрыв теперь не в отсутствии функциональности, а в **несоответствии реализации заявленной архитектуре** в четырех местах:
  - oracle path еще не стал строго каноническим;
  - `record_outcome` работает не по одному settlement price на цикл;
  - основной frontend feed все еще зависит от in-memory `cycleHistory`;
  - `ExecutionRecord.pnl_delta` хранит не тот смысл, который зафиксирован в архитектуре.
- Цель этого этапа: довести код до состояния, где архитектурное утверждение `AI decision -> on-chain record -> confidence gate -> execution -> outcome -> read model` верно не только на слайдах, но и в рантайме.

## Implementation Changes

### 1. Harden the on-chain oracle boundary

- Сделать Pyth remaining account **обязательным** для `submit_decision` на devnet path; fallback-аргументы оставить только для локальных тестов через отдельный feature flag, test-only instruction или явно изолированный local mode.
- В контракте валидировать oracle account как ожидаемый Pyth price account, а не просто читать произвольные байты из `remaining_accounts.first()`.
- В контракте применять staleness check к oracle данным и реально использовать ошибку stale oracle вместо простого логирования `age`.
- В backend `submitDecision` перестать позиционировать `oraclePrice` как нормальный runtime input; оставить его только для local-test mode. В обычном cycle path backend должен передавать Pyth account и не рассчитывать на fallback.
- В README и архитектуре синхронизировать формулировку: либо “Pyth is mandatory in devnet/runtime”, либо явно описать, что fallback существует только для local test harness.

### 2. Make cycle settlement canonical and fix PnL semantics

- В начале `runCycle` получать **один** settlement price для cycle `N` и использовать его для всех `record_outcome` вызовов по cycle `N-1`.
- Не вызывать `fetchMarketSnapshot(cycleId)` внутри цикла по агентам для outcome settlement; snapshot для agent reasoning и settlement price для previous cycle должны быть разделены, но каждый из них должен быть единым в рамках цикла.
- Зафиксировать одну модель PnL:
  - `ExecutionRecord.pnl_delta` хранит только **realized execution PnL**, как указано в архитектуре; `record_outcome` его больше не перезаписывает.
  - `AgentPosition.unrealized_pnl` обновляется в `record_outcome` как mark-to-market состояние текущей позиции на начало нового цикла.
- Если нужен per-cycle outcome metric для UI, добавить отдельное поле в `ExecutionRecord` или вычислять его off-chain в read model. Не переиспользовать `pnl_delta` для двух разных смыслов.
- Обновить архитектурный текст там, где сейчас `record_outcome` трактуется двусмысленно, чтобы данные в коде и в документе совпадали.

### 3. Replace memory-only feed with the documented read model

- Убрать роль `/api/cycles` как главного источника decision feed.
- Встроенный backend/indexer должен восстанавливать feed из on-chain `DecisionRecord` и `ExecutionRecord`, а reasoning подтягивать из SQLite только для confirmed attempts.
- Зафиксировать один read path: `Frontend -> API -> indexed chain data + SQLite`.
- Добавить или расширить API так, чтобы frontend получал:
  - список последних decisions с `cycleId`, `agent`, `action`, `confidence`, `gateStatus`, `oraclePrice`, `txSignature`;
  - execution/outcome status для decision;
  - confirmed reasoning по `decisionPda`;
  - leaderboard, собранный из positions + indexed decisions.
- `cycleHistory` можно оставить только как временный demo artifact для optimistic UX после `POST /api/cycle`, но не как источник истины и не как единственный feed после рестарта процесса.
- После рестарта backend dashboard должен восстанавливаться из chain + SQLite без потери основной истории.

### 4. Align frontend, docs, and demo contract with the real runtime

- Переделать decision feed на frontend под новый read model endpoint вместо прямой зависимости от `/api/cycles`.
- Сохранить `Run Next Cycle` как demo trigger, но после его вызова UI должен обновляться из API read model, а не из process-local истории.
- В UI четко показывать различие между:
  - decision submitted;
  - gate approved/blocked;
  - execution happened / did not happen;
  - current position and unrealized PnL.
- Обновить README так, чтобы он не обещал больше, чем реально делает код: особенно по oracle guarantees, feed persistence и outcome semantics.
- Добавить в runbook один честный demo flow:
  - init/deploy;
  - register agents;
  - pre-run 3-5 cycles;
  - restart backend;
  - убедиться, что dashboard восстанавливается;
  - run one live cycle during demo.

## Public Interfaces / Data Model Changes

- Contract:
  - `submit_decision` runtime path требует валидный Pyth account.
  - `record_outcome` больше не перезаписывает `ExecutionRecord.pnl_delta`.
  - при необходимости добавляется отдельное поле outcome metric, либо outcome остается только в `AgentPosition.unrealized_pnl`.
- Backend API:
  - новый или обновленный endpoint для durable decision feed из indexed on-chain records.
  - `/api/reasoning/:decisionPda` продолжает возвращать только confirmed reasoning.
  - `/api/cycles` перестает быть основным UI feed и становится optional/debug-only endpoint.
- Frontend:
  - decision feed переключается на durable feed endpoint;
  - cycle cards больше не требуют memory-only snapshot history как единственный источник данных.

## Test Plan

- Contract tests:
  - `submit_decision` fails when the required Pyth account is missing or invalid in runtime mode.
  - stale oracle data is rejected.
  - gate evaluation still works with valid oracle input.
  - `execute_decision` writes realized execution PnL consistently.
  - `record_outcome` updates `unrealized_pnl` without overwriting realized execution PnL.
- Backend integration:
  - cycle `N` records outcomes for cycle `N-1` using one shared settlement price.
  - submit flow still preserves reasoning lifecycle: `pending -> confirmed/failed/orphaned`.
  - after backend restart, decisions/feed/leaderboard reconstruct from chain + SQLite.
- API/frontend:
  - dashboard renders from durable feed endpoint with no dependency on prior in-memory `cycleHistory`.
  - reasoning fetch still works by `decisionPda`.
  - live `POST /api/cycle` updates the same durable read model the UI later reloads.
- Demo smoke:
  - run several cycles, restart backend, verify history persists, then run one additional cycle live.

## Assumptions

- Scope остается прежним: `SOL/USDC`, 3 pre-built agents, simulated execution, no shorts, no external capital.
- SQLite остается only-for-reasoning store; отдельная persistent DB для full read model не добавляется.
- Indexer/read model остается внутри backend-процесса и восстанавливается из on-chain accounts on startup.
- Приоритет реализации:
  1. Oracle boundary hardening
  2. Outcome settlement + PnL semantics cleanup
  3. Durable read model for API/frontend
  4. README and demo/runbook alignment
