import Database from "better-sqlite3";
import { config } from "./config";

const db: any = new Database(config.dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS reasoning (
    decision_pda TEXT PRIMARY KEY,
    reasoning_hash TEXT NOT NULL,
    full_text TEXT NOT NULL,
    tx_signature TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    confirmed_at INTEGER
  )
`);

export function saveReasoning(
  decisionPda: string,
  reasoningHash: string,
  fullText: string
): void {
  db.prepare(
    `INSERT OR REPLACE INTO reasoning (decision_pda, reasoning_hash, full_text, status, created_at)
     VALUES (?, ?, ?, 'pending', ?)`
  ).run(decisionPda, reasoningHash, fullText, Date.now());
}

export function confirmReasoning(
  decisionPda: string,
  txSignature: string
): void {
  db.prepare(
    `UPDATE reasoning SET status = 'confirmed', tx_signature = ?, confirmed_at = ? WHERE decision_pda = ?`
  ).run(txSignature, Date.now(), decisionPda);
}

export function failReasoning(decisionPda: string): void {
  db.prepare(
    `UPDATE reasoning SET status = 'failed' WHERE decision_pda = ?`
  ).run(decisionPda);
}

export function getReasoning(
  decisionPda: string
): { full_text: string; status: string; tx_signature: string | null } | null {
  return db
    .prepare(`SELECT full_text, status, tx_signature FROM reasoning WHERE decision_pda = ?`)
    .get(decisionPda) as any;
}

export function getAllReasoning(): any[] {
  return db
    .prepare(`SELECT * FROM reasoning ORDER BY created_at DESC LIMIT 100`)
    .all();
}

export default db;
