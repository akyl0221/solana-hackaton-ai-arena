# Architecture Comments

Комментарии по текущим версиям:

- [`ARCHITECTURE.md`](/Users/akyldjumaliev/work_projects/study/hackaton/solana-hackaton-ideas/ARCHITECTURE.md)
- [`ARCHITECTURE_VISUAL.md`](/Users/akyldjumaliev/work_projects/study/hackaton/solana-hackaton-ideas/ARCHITECTURE_VISUAL.md)

---

## 1. Missing `max_position_size` in the data model

**Severity:** Important

В документах уже зафиксировано, что gate должен проверять ограничение на итоговый размер позиции после исполнения сделки. Но в текущей модели данных нет явного поля, откуда этот лимит брать.

Где это видно:

- [`ARCHITECTURE.md:209`](/Users/akyldjumaliev/work_projects/study/hackaton/solana-hackaton-ideas/ARCHITECTURE.md#L209)
- [`ARCHITECTURE.md:372`](/Users/akyldjumaliev/work_projects/study/hackaton/solana-hackaton-ideas/ARCHITECTURE.md#L372)
- [`ARCHITECTURE_VISUAL.md:253`](/Users/akyldjumaliev/work_projects/study/hackaton/solana-hackaton-ideas/ARCHITECTURE_VISUAL.md#L253)

Проблема:

- правило описано
- `AgentPosition` хранит текущее состояние
- но лимит не хранится ни в `ArenaState`, ни в `AgentProfile`, ни в `ConfidenceGate`

В результате `BlockedPositionLimit` существует концептуально, но не опирается на конкретное поле конфигурации.

### Recommendation

Добавить `max_position_size: u64` в одну из двух сущностей:

- `AgentProfile`, если лимит индивидуальный для агента
- `ArenaState`, если лимит глобальный по умолчанию

Наиболее логичный вариант для текущего дизайна:

- глобальный default в `ArenaState`
- optional override в `AgentProfile`

---

## 2. Frontend read path is inconsistent

**Severity:** Important

В visual architecture есть две разные модели чтения данных фронтендом.

В system overview:

- frontend идет в `API`
- `API` уже читает indexer и SQLite

См.:

- [`ARCHITECTURE_VISUAL.md:52`](/Users/akyldjumaliev/work_projects/study/hackaton/solana-hackaton-ideas/ARCHITECTURE_VISUAL.md#L52)
- [`ARCHITECTURE_VISUAL.md:63`](/Users/akyldjumaliev/work_projects/study/hackaton/solana-hackaton-ideas/ARCHITECTURE_VISUAL.md#L63)

Но в decision cycle flow:

- `UI -> IDX: fetch updated state`

См.:

- [`ARCHITECTURE_VISUAL.md:142`](/Users/akyldjumaliev/work_projects/study/hackaton/solana-hackaton-ideas/ARCHITECTURE_VISUAL.md#L142)

Проблема:

- неясно, indexer это внутренний модуль backend или отдельный query service
- для MVP лучше не оставлять две интерпретации

### Recommendation

Зафиксировать один путь:

`Frontend -> Backend API -> Indexer/SQLite/Solana RPC`

Если indexer живет внутри backend-процесса, то UI не должен быть показан как отдельный клиент indexer.

---

## 3. SQLite write should be per-agent in the decision loop

**Severity:** Minor

В sequence diagram запись reasoning в SQLite стоит до `loop For each agent`, из-за чего это визуально читается как одна запись на весь цикл.

См.:

- [`ARCHITECTURE_VISUAL.md:117`](/Users/akyldjumaliev/work_projects/study/hackaton/solana-hackaton-ideas/ARCHITECTURE_VISUAL.md#L117)
- [`ARCHITECTURE_VISUAL.md:120`](/Users/akyldjumaliev/work_projects/study/hackaton/solana-hackaton-ideas/ARCHITECTURE_VISUAL.md#L120)

Фактически reasoning storage должен происходить отдельно для каждого агента:

- agent A reasoning -> pending row
- submit tx
- confirm or fail
- agent B reasoning -> pending row
- ...

### Recommendation

Перенести шаг:

`RT ->> DB: INSERT reasoning (status: pending)`

внутрь `loop For each agent`, либо явно подписать:

`For each agent: insert pending reasoning row`

Так sequence diagram будет соответствовать реальному lifecycle reasoning rows.

---

## Summary

В целом архитектура стала заметно лучше:

- есть consolidated spec
- есть `AgentPosition`
- есть SQLite lifecycle
- есть pricing model с Pyth
- есть сильный visual layer для review и demo

Но перед следующим раундом я бы обязательно добил:

1. `max_position_size` как явное поле в модели данных
2. единый frontend read path через API
3. per-agent SQLite write в sequence diagram
