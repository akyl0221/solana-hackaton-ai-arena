# AI Arena: Next Actions Plan

## Summary

- Архитектура уже достаточно зрелая: account model, `submit_decision`, `AgentPosition`, reasoning lifecycle и базовый UI есть.
- Дальше нужно закрыть разрыв между **документом** и **реальной реализацией** в трех местах: oracle trust boundary, полный cycle loop с `record_outcome`, и устойчивый read model для UI.
- Цель следующего этапа: довести проект до demo-ready MVP, где путь `AI -> decision -> on-chain record -> gate -> execution -> outcome -> leaderboard` работает без архитектурных допущений.

## Implementation Changes

### 1. Contract and Oracle Boundary

- Перевести `submit_decision` на чтение Pyth price account внутри программы вместо передачи `oracle_price`, `oracle_timestamp`, `oracle_confidence` из backend.
- Обновить instruction interface, contexts и tests под remaining-account / oracle-account flow.
- Оставить simulated execution, но сделать on-chain price действительно canonical для entry/exit price.
- Синхронизировать [`ARCHITECTURE.md`](/Users/akyldjumaliev/work_projects/study/hackaton/solana-hackaton-ideas/ARCHITECTURE.md) с фактическими полями аккаунтов: `AgentProfile.max_position_size` уже есть в коде и должен быть отражен в документе.

### 2. Full Decision Cycle

- Добавить в backend реальный Phase 1 из архитектуры: в начале цикла вызывать `record_outcome` для решений предыдущего цикла, если для них есть `ExecutionRecord`.
- Зафиксировать одно правило outcome window: `cycle N` рассчитывает outcome для `cycle N-1` по текущей oracle reference price.
- Развести семантику PnL:
  - `ExecutionRecord.pnl_delta` хранит outcome PnL за окно `N-1 -> N`, либо
  - realized execution PnL переносится в `AgentPosition`, а `ExecutionRecord` хранит только cycle outcome.
- Устранить двойной смысл одного поля; документ и код должны использовать одну модель.
- Завершить reasoning lifecycle до production-like MVP: confirmed/failed/orphaned уже есть, теперь убрать оставшиеся места, где UI или runtime полагаются на временные данные.

### 3. Read Model and API

- Убрать зависимость основного UI от process-local `cycleHistory`.
- Построить decision feed и leaderboard из on-chain данных плюс confirmed reasoning из SQLite.
- Зафиксировать один read path: `Frontend -> API -> indexed chain data + SQLite`.
- Добавить API endpoints или расширить текущие так, чтобы frontend получал:
  - decisions с gate result и tx links
  - executions
  - positions
  - confirmed reasoning по `decision_pda`
- Если нужен быстрый MVP, indexer остается встроенным в backend-процесс, но данные для UI должны быть восстановимыми после рестарта.

### 4. Frontend and Demo Hardening

- Переделать feed под реальную архитектурную модель: decisions, blocked decisions, executions, outcome results.
- Показывать confirmed reasoning по `decision_pda`, а не только reasoning из in-memory cycle response.
- Добавить устойчивую визуализацию gate path и статусов outcome.
- Поддержать pre-seeded demo state: backend script или manual cycle pre-run до презентации.
- Сохранить один ручной demo trigger `Run Next Cycle`, но сделать так, чтобы он обновлял данные из read model, а не из временного массива.

### 5. Environment and Delivery

- Добавить reproducible runbook:
  - install deps
  - build Anchor
  - run backend
  - run frontend
  - initialize/register agents
  - pre-seed cycles
- Убедиться, что `.env.example`, `Anchor.toml`, program ID и operator flow согласованы.
- Подготовить smoke path для devnet demo без ручного вмешательства в SQLite или on-chain state.

## Test Plan

- Contract tests:
  - `submit_decision` читает oracle account on-chain и не принимает oracle values из backend args
  - gate checks still pass/fail correctly with max trade, max position, cooldown
  - `record_outcome` обновляет именно ту PnL-семантику, которая зафиксирована в архитектуре
- Backend integration:
  - successful cycle records decisions, executions, and outcomes across two consecutive cycles
  - restart backend -> feed/leaderboard/rationale still reconstruct from chain + SQLite
  - failed submit leaves failed/orphaned reasoning attempts correctly
- API tests:
  - `GET /api/agents`, `/api/leaderboard`, `/api/decisions`, `/api/reasoning/:pda` работают без `cycleHistory`
  - confirmed reasoning only
- Demo smoke:
  - init arena
  - register 3 agents
  - run 2-3 cycles
  - see blocked and approved decisions
  - see outcome update on next cycle
  - UI reflects restored state after backend restart

## Assumptions

- Scope не расширяем: без user-generated agents, без real swaps как обязательной части, без external capital.
- Simulated execution остается основным execution mode для hackathon demo.
- SQLite остается local persistence layer для reasoning only; отдельная БД для read model не нужна.
- Приоритет реализации:
  1. oracle trust boundary
  2. full cycle with `record_outcome`
  3. read model / API / UI consistency
  4. demo hardening and runbook
