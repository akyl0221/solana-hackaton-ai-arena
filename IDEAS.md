# Solana Hackathon Direction — AI Arena + PoI Gate

> Deadline: April 7, 2026, 23:59 (GMT+5)
> Submit: Google Forms + Colosseum

Этот документ фиксирует итоговый выбор направления после ревью и конкурентной проверки.

---

## Final Choice

Берем **AI Arena** как основной продукт и **PoI Gate** как внутренний execution/audit layer.

Это не два отдельных проекта.

Это один продукт:

- сверху: зрелищный AI Arena demo
- снизу: PoI Gate как слой доверия, логирования и guarded execution

---

## Product Thesis

### One-line pitch

**AI Arena is a Solana-based arena where pre-built AI agents compete on the same market, while every decision passes through a confidence-gated execution and audit layer on-chain.**

### Что происходит

- есть 2-3 заранее созданных AI-агента
- все они работают на одном и том же рынке
- каждый агент получает одинаковые входные данные
- каждый принимает решение
- решение записывается on-chain
- PoI Gate решает, можно ли его исполнять
- разрешенные решения исполняются в рамках guardrails
- результаты решений попадают в off-chain leaderboard

---

## Почему именно этот вариант

### Почему не NeuralEstate

- слишком много compliance и operational fiction для MVP
- "AI управляет недвижимостью" плохо конвертируется в честный демо-сценарий
- слишком высокий риск красивого, но слабого prototype

### Почему не исходный AI Arena

- слишком широкий scope
- investor vaults, share tokens, marketplace и on-chain leaderboard не помещаются в реалистичный хакатонный MVP
- модель аккаунтов была избыточной для Solana

### Почему не отдельный PoI Protocol

- как самостоятельный pitch он слишком инфраструктурный
- судьям проще оценить продукт, чем "новый стандарт"

### Почему AI Arena + PoI Gate работает

- сильный визуальный demo
- чистый fit под **Case 2: AI + Blockchain**
- хорошая техническая глубина
- Solana используется по делу
- можно показать прозрачность AI без перегруза scope

---

## MVP Boundaries

### Что включаем

- 1 торговый контур: `SOL/USDC`
- 2-3 pre-built AI agents
- 1 фиксированный execution engine
- AI decision log on-chain
- confidence gate on-chain
- guarded execution
- off-chain leaderboard
- result tracking

### Что не включаем

- user-generated agents
- investor vaults
- share tokens
- marketplace
- copy trading
- multi-asset support
- on-chain leaderboard
- arbitrary DeFi integrations

---

## Core Architecture

### Product Layer: AI Arena

То, что видит пользователь:

- список агентов
- текущие позиции и решения
- история execution
- leaderboard
- сравнение стратегий

Агенты заранее заданы:

- `Momentum Agent`
- `Mean Reversion Agent`
- `Risk-Off Agent`

### Trust Layer: PoI Gate

То, что делает систему убедительной:

- запись решения AI на Solana
- hash reasoning
- confidence score
- gate evaluation
- execution permission / rejection
- outcome record

PoI Gate не продается как отдельный стандарт.

Он нужен, чтобы показать:

- AI не просто "что-то решил"
- система проверяет решение перед execution
- весь audit trail прозрачен

---

## Core User Flow

1. Пользователь открывает арену
2. Видит 2-3 AI-агента и их стратегии
3. Агент получает market snapshot
4. AI принимает структурированное решение
5. Решение записывается on-chain через `DecisionRecord`
6. `ConfidenceGate` проверяет confidence и risk limits
7. Если решение прошло gate, система исполняет действие
8. Результат попадает в журнал
9. Leaderboard пересчитывается off-chain

---

## Why This Is Strong for Judges

- легко понять за 30 секунд
- есть реальный AI -> on-chain action loop
- есть честный guardrail layer
- есть live demo energy
- архитектура выглядит глубже, чем обычный AI bot

---

## Honest Positioning

Что не надо говорить:

- "у нас нет аналогов"
- "это новый мировой стандарт"
- "полностью автономный трейдинг для инвесторов"

Что надо говорить:

- мы сделали **реалистичный, bounded AI execution system on Solana**
- мы показали **transparent decision logging + confidence-gated execution**
- мы специально урезали scope, чтобы собрать работающий MVP

---

## Final Recommendation

Основной продукт хакатона:

**AI Arena**

Внутренний технический слой:

**PoI Gate**

Итоговая подача:

**не "мы построили все и сразу", а "мы построили честный, компактный, работающий AI execution arena on Solana".**
