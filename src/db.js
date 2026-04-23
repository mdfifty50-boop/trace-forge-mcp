/**
 * SQLite database layer for trace-forge-mcp.
 * DB lives at ~/.trace-forge-mcp/traces.db
 */

import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DB_DIR = join(homedir(), '.trace-forge-mcp');
const DB_PATH = join(DB_DIR, 'traces.db');

if (!existsSync(DB_DIR)) {
  mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ═══════════════════════════════════════════
// SCHEMA
// ═══════════════════════════════════════════

db.exec(`
  CREATE TABLE IF NOT EXISTS traces (
    trace_id       TEXT PRIMARY KEY,
    agent_id       TEXT NOT NULL,
    task_description TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'active',
    started_at     TEXT NOT NULL,
    ended_at       TEXT,
    metadata_json  TEXT NOT NULL DEFAULT '{}',
    outcome        TEXT,
    summary        TEXT,
    error          TEXT
  );

  CREATE TABLE IF NOT EXISTS spans (
    span_id        TEXT PRIMARY KEY,
    trace_id       TEXT NOT NULL,
    parent_span_id TEXT,
    span_name      TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'active',
    started_at     TEXT NOT NULL,
    ended_at       TEXT,
    metadata_json  TEXT NOT NULL DEFAULT '{}'
  );

  CREATE INDEX IF NOT EXISTS idx_spans_trace_id ON spans(trace_id);

  CREATE TABLE IF NOT EXISTS tool_calls (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    trace_id       TEXT NOT NULL,
    span_id        TEXT,
    tool_name      TEXT NOT NULL,
    args_json      TEXT NOT NULL DEFAULT '{}',
    result_preview TEXT,
    tokens_used    INTEGER,
    duration_ms    REAL,
    status         TEXT,
    timestamp      TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tool_calls_trace_id ON tool_calls(trace_id);

  CREATE TABLE IF NOT EXISTS decisions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    trace_id         TEXT NOT NULL,
    span_id          TEXT,
    decision         TEXT,
    rationale        TEXT,
    alternatives_json TEXT NOT NULL DEFAULT '[]',
    confidence       REAL,
    timestamp        TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_decisions_trace_id ON decisions(trace_id);
`);

export default db;
