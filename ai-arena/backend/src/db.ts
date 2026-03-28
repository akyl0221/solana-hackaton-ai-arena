import Database from "better-sqlite3";
import { config } from "./config";

const db: any = new Database(config.dbPath);

// Check if old schema exists and migrate
const tableInfo = db.prepare(`PRAGMA table_info(reasoning)`).all();
const hasIdColumn = tableInfo.some((col: any) => col.name === "id");

if (tableInfo.length > 0 && !hasIdColumn) {
  // Old schema detected — drop and recreate (hackathon assumption: local data is disposable)
  console.log("Incompatible reasoning schema detected, resetting table...");
  db.exec(`DROP TABLE reasoning`);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS reasoning_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    decision_pda TEXT NOT NULL,
    reasoning_hash TEXT NOT NULL,
    full_text TEXT NOT NULL,
    tx_signature TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    confirmed_at INTEGER
  )
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_reasoning_pda ON reasoning_attempts(decision_pda);
  CREATE INDEX IF NOT EXISTS idx_reasoning_status ON reasoning_attempts(status);
`);

// ============================================================================
// Attempt-based persistence API
// ============================================================================

export function createPendingAttempt(
  decisionPda: string,
  reasoningHash: string,
  fullText: string
): number {
  const now = Date.now();
  const result = db.prepare(
    `INSERT INTO reasoning_attempts (decision_pda, reasoning_hash, full_text, status, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', ?, ?)`
  ).run(decisionPda, reasoningHash, fullText, now, now);
  return result.lastInsertRowid as number;
}

export function markConfirmed(attemptId: number, txSignature: string): void {
  const now = Date.now();
  db.prepare(
    `UPDATE reasoning_attempts SET status = 'confirmed', tx_signature = ?, confirmed_at = ?, updated_at = ? WHERE id = ?`
  ).run(txSignature, now, now, attemptId);
}

export function markFailed(attemptId: number, errorMessage: string): void {
  db.prepare(
    `UPDATE reasoning_attempts SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?`
  ).run(errorMessage, Date.now(), attemptId);
}

export function orphanOlderAttempts(decisionPda: string, keepAttemptId: number): void {
  db.prepare(
    `UPDATE reasoning_attempts SET status = 'orphaned', updated_at = ? WHERE decision_pda = ? AND id != ? AND status = 'pending'`
  ).run(Date.now(), decisionPda, keepAttemptId);
}

export function getConfirmedReasoning(
  decisionPda: string
): { full_text: string; tx_signature: string; confirmed_at: number } | null {
  return db
    .prepare(
      `SELECT full_text, tx_signature, confirmed_at FROM reasoning_attempts WHERE decision_pda = ? AND status = 'confirmed' ORDER BY confirmed_at DESC LIMIT 1`
    )
    .get(decisionPda) as any;
}

export function getReasoningAttempts(decisionPda: string): any[] {
  return db
    .prepare(
      `SELECT id, reasoning_hash, status, tx_signature, error_message, created_at, updated_at, confirmed_at FROM reasoning_attempts WHERE decision_pda = ? ORDER BY created_at DESC`
    )
    .all(decisionPda);
}

// ============================================================================
// Backward-compatible exports (used by api.ts)
// ============================================================================

export function getReasoning(
  decisionPda: string
): { full_text: string; status: string; tx_signature: string | null } | null {
  return getConfirmedReasoning(decisionPda) as any;
}

export function getAllReasoning(): any[] {
  return db
    .prepare(
      `SELECT decision_pda, reasoning_hash, full_text, tx_signature, status, created_at, confirmed_at FROM reasoning_attempts WHERE status = 'confirmed' ORDER BY confirmed_at DESC LIMIT 100`
    )
    .all();
}

export default db;
