// Base de datos: Postgres (DATABASE_URL, en Railway) o, si no hay, Postgres embebido (PGlite) en ./.data
import { mkdirSync } from 'node:fs'

let impl

export async function initDb() {
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import('pg')
    const url = process.env.DATABASE_URL
    const internal = /localhost|\.internal\b|postgres\.railway\.internal/i.test(url)
    const forceSsl = /^1|true$/i.test(process.env.PGSSL || '')
    const publicRailway = /proxy\.rlwy\.net|sslmode=require/i.test(url)
    const ssl = !internal && (forceSsl || publicRailway) ? { rejectUnauthorized: false } : undefined
    const pool = new pg.Pool({ connectionString: url, ssl })
    impl = { query: (text, params) => pool.query(text, params), kind: 'postgres' }
  } else {
    const { PGlite } = await import('@electric-sql/pglite')
    const dir = process.env.PGLITE_DIR || './.data/pglite'
    if (dir !== 'memory') mkdirSync(dir, { recursive: true })
    const db = dir === 'memory' ? new PGlite() : new PGlite(dir)
    impl = { query: (text, params) => db.query(text, params), kind: 'pglite' }
  }
  await migrate()
  return impl.kind
}

export function q(text, params = []) { return impl.query(text, params) }

async function migrate() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS login_tokens (token TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, used BOOLEAN DEFAULT false)`,
    `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS closes (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL,
      meta JSONB NOT NULL DEFAULT '{}', analysis JSONB, decisions JSONB NOT NULL DEFAULT '{}', log JSONB NOT NULL DEFAULT '[]',
      approver_token TEXT, sent_at TIMESTAMPTZ, signed JSONB,
      created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now())`,
    `CREATE INDEX IF NOT EXISTS closes_owner ON closes(owner)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS closes_token ON closes(approver_token)`,
    `CREATE TABLE IF NOT EXISTS datasets (
      close_id TEXT NOT NULL REFERENCES closes(id) ON DELETE CASCADE, kind TEXT NOT NULL,
      filename TEXT, mapping JSONB, rows JSONB NOT NULL DEFAULT '[]', updated_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (close_id, kind))`,
  ]
  for (const s of stmts) await q(s)
}
