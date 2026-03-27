# Review Response

Ответ на findings по [`REVIEW_FOLLOWUP.md`](/Users/akyldjumaliev/work_projects/study/hackaton/solana-hackaton-ideas/REVIEW_FOLLOWUP.md).

---

## Finding 1

### [P2] Persisting reasoning before tx confirmation can leave stale or mismatched rows

**Статус:** Accepted

Согласен. Формулировка в follow-up слишком оптимистична и не закрывает failure mode между локальной записью reasoning и подтверждением транзакции в сети.

Проблема реальная:

- reasoning может сохраниться в SQLite
- транзакция может не пройти
- транзакция может быть повторно собрана с другим `reasoning_hash`
- в результате локальная запись и on-chain состояние расходятся

### Что меняем

SQLite остается source of truth для полного текста reasoning, но запись должна учитывать жизненный цикл транзакции.

Минимально корректная схема:

- сначала создаем запись в SQLite со статусом `pending`
- сохраняем:
  - `decision_pda`
  - `reasoning_text`
  - `reasoning_hash`
  - `tx_signature`
  - `status`
  - `created_at`
- после подтверждения транзакции переводим запись в `confirmed`
- если транзакция не подтверждена или заменена, запись помечается как `failed` или `orphaned`

### Рекомендуемая таблица

```sql
CREATE TABLE reasoning (
  decision_pda TEXT PRIMARY KEY,
  reasoning_hash TEXT NOT NULL,
  full_text TEXT NOT NULL,
  tx_signature TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  confirmed_at INTEGER
);
```

### Итог

SQLite нужен, но не как "записали и забыли", а как маленький state machine вокруг on-chain commit.

---

## Finding 2

### [P1] AgentPosition introduces shorting despite no-shorts MVP boundary

**Статус:** Accepted

Согласен полностью. `Short` в `AgentPosition` конфликтует с уже зафиксированным MVP boundary.

Сейчас продукт сознательно ограничен:

- без leverage
- без shorting
- без сложной многослойной позиции

Если оставить `Short`, это автоматически расширяет:

- execution logic
- guardrails
- position accounting
- PnL semantics
- UI и объяснение судьям

### Что меняем

Для MVP состояние позиции должно быть:

```text
PositionSide = Flat | Long
```

или еще проще:

- вообще убрать enum
- хранить только `current_size`
- считать `0 = Flat`, `>0 = Long`

### Предпочтительный вариант

Для readability я бы оставил:

```text
PositionSide = Flat | Long
```

Это проще читать в коде и в документации, при этом не тащит short-support.

### Итог

`AgentPosition` нужен, но в урезанной форме под текущий MVP. Никакого `Short` в текущей версии архитектуры быть не должно.

---

## Finding 3

### [P1] Oracle price at submit time is not the price the AI actually saw

**Статус:** Accepted with refinement

Замечание верное. Если агент принимает решение на основе snapshot, а контракт в `submit_decision` читает "текущую" цену из Pyth уже позже, то audit trail ломается.

Появляются две разные сущности:

- цена, на которой AI реально принимал решение
- цена, которая попала в on-chain запись в момент submit

Это нельзя называть одной и той же "canonical decision price".

### Что меняем концептуально

Нужно разделить:

1. **input binding**
2. **execution / valuation price**

### Правильная модель для MVP

#### A. Что видел AI

AI должен быть привязан к конкретному snapshot:

- `snapshot_id`
- `cycle_id`
- `snapshot_hash`
- `oracle_publish_time`

Это и есть доказательство входа, на котором принималось решение.

#### B. Что хранится on-chain в DecisionRecord

DecisionRecord должен хранить:

- `input_hash`
- `cycle_id`
- `oracle_publish_time`
- при необходимости `oracle_price_at_snapshot`

Но это должна быть цена именно из того oracle update, который соответствует snapshot, а не произвольная цена на момент отправки транзакции.

#### C. Что используется для PnL

PnL считается отдельно:

- `entry_price_reference`
- `exit_price_reference`

И обе цены должны быть привязаны к конкретным oracle updates или строго определенным cycle boundaries.

### Практический вариант для hackathon MVP

Самый реалистичный подход:

- backend строит snapshot из Pyth update с конкретным `publish_time`
- AI принимает решение на этом snapshot
- в `submit_decision` передается:
  - `snapshot_hash`
  - `cycle_id`
  - `oracle_publish_time`
  - `oracle_price_at_snapshot`
- контракт проверяет, что переданный oracle account соответствует ожидаемому update window
- later outcome uses another oracle reference for the next cycle

Если такая валидация окажется слишком тяжелой для MVP, тогда нужно честно упростить формулировку:

- on-chain oracle price используется как **execution-time reference**
- а не как доказательство точного AI input price

### Итог

Здесь главное не пытаться склеить две разные цены в одну.  
Нужна явная модель:

- **snapshot price for decision context**
- **oracle/reference price for execution and PnL**

---

## Consolidated Position

Из трех findings:

- Finding 1: принять полностью
- Finding 2: принять полностью
- Finding 3: принять полностью, но оформить как разделение `input snapshot` и `execution/PnL price`

---

## Recommended Next Step

Следующее разумное действие:

1. обновить [`ARCHITECTURE.md`](/Users/akyldjumaliev/work_projects/study/hackaton/solana-hackaton-ideas/ARCHITECTURE.md)
2. обновить [`REVIEW_FOLLOWUP.md`](/Users/akyldjumaliev/work_projects/study/hackaton/solana-hackaton-ideas/REVIEW_FOLLOWUP.md)
3. синхронизировать формулировки между ними, чтобы:
   - не было `Short`
   - reasoning storage был stateful
   - pricing model была однозначной
