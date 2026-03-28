# Plan: Fix stale and mismatched reasoning rows

## Summary

- Bring reasoning persistence to an explicit lifecycle around the on-chain commit so SQLite no longer diverges from confirmed transactions.
- Implement one source of truth for reasoning attempts: `pending`, `confirmed`, `failed`, `orphaned`.
- Change backend flow so each submit attempt has its own row, while the public API only serves confirmed reasoning.

## Key Changes

### Database model

In [`ai-arena/backend/src/db.ts`](/Users/akyldjumaliev/work_projects/study/hackaton/solana-hackaton-ideas/ai-arena/backend/src/db.ts), replace the current one-row-per-`decision_pda` model with an attempt-based table:

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `decision_pda TEXT NOT NULL`
- `reasoning_hash TEXT NOT NULL`
- `full_text TEXT NOT NULL`
- `tx_signature TEXT`
- `status TEXT NOT NULL` with values `pending | confirmed | failed | orphaned`
- `error_message TEXT`
- `created_at INTEGER NOT NULL`
- `updated_at INTEGER NOT NULL`
- `confirmed_at INTEGER`

### DB access layer

Add a strict persistence API in the same module:

- `createPendingReasoningAttempt(decisionPda, reasoningHash, fullText): attemptId`
- `markReasoningConfirmed(attemptId, txSignature)`
- `markReasoningFailed(attemptId, errorMessage)`
- `orphanOlderAttempts(decisionPda, keepAttemptId)`
- `getConfirmedReasoning(decisionPda)`
- `getReasoningAttempts(decisionPda)` for debugging

### Backend cycle flow

In [`ai-arena/backend/src/cycle.ts`](/Users/akyldjumaliev/work_projects/study/hackaton/solana-hackaton-ideas/ai-arena/backend/src/cycle.ts), rewrite the submit path:

1. compute `decision_pda` and `reasoning_hash`
2. create a `pending` reasoning attempt and keep `attemptId`
3. call `submitDecision`
4. on success:
   - call `orphanOlderAttempts(decisionPda, attemptId)`
   - call `markReasoningConfirmed(attemptId, txSignature)`
5. on submit failure:
   - call `markReasoningFailed(attemptId, err.message)`
   - do not leave `pending` rows behind
6. if `executeDecision` fails after submit succeeds, keep reasoning `confirmed`, because the decision is already on-chain

### API behavior

In [`ai-arena/backend/src/api.ts`](/Users/akyldjumaliev/work_projects/study/hackaton/solana-hackaton-ideas/ai-arena/backend/src/api.ts):

- `GET /api/reasoning/:decisionPda` must return only `confirmed` reasoning
- if no confirmed row exists, return `404`
- do not expose `pending` or `failed` rows to the main UI endpoint

### Migration policy

Do not implement a heavy migration for the old SQLite schema.

For this hackathon MVP, use a simple destructive reset of the `reasoning` table if an incompatible schema is detected on startup. Record this as an explicit hackathon assumption.

## Test Plan

### Database tests

- create a `pending` attempt
- move `pending -> confirmed`
- move `pending -> failed`
- orphan older attempts for the same `decision_pda`
- ensure `getConfirmedReasoning` returns only the confirmed row

### Integration tests

- successful submit creates a confirmed attempt with `tx_signature`
- failed submit leaves a `failed` row, not a `pending` row
- retry for the same `decision_pda` with a new `reasoning_hash` marks the old attempt `orphaned`
- execution failure after successful submit does not downgrade reasoning from `confirmed`

### API tests

- `GET /api/reasoning/:decisionPda` returns confirmed reasoning
- `GET /api/reasoning/:decisionPda` returns `404` for only-pending / failed / orphaned rows

### Smoke scenario

- run one successful submit
- run one intentionally broken submit
- retry the broken submit
- inspect SQLite rows and API responses to confirm status transitions

## Assumptions

- preserving existing local `reasoning.db` contents is not required
- retry is modeled as a new submit attempt, not as an in-place mutation of the old row
- `decision_pda` remains the business key for the decision, while attempt rows solve the stale/mismatched reasoning problem without changing on-chain state
