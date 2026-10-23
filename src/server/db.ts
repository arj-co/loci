import pg from 'pg';
import type { QueryResultRow } from 'pg';
import { env } from './env';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('[loci] idle database client error', err.message);
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const started = performance.now();
  const result = await pool.query<T>(text, values);
  const elapsed = performance.now() - started;
  if (elapsed > 500) {
    console.warn(`[loci] slow query (${elapsed.toFixed(0)}ms): ${text.slice(0, 120)}`);
  }
  return result.rows;
}

export async function one<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

export function toVector(value: number[]): string {
  return `[${value.map((n) => (Number.isFinite(n) ? n.toFixed(6) : '0')).join(',')}]`;
}

export async function dbHealth() {
  const started = performance.now();
  const rows = await query<{ version: string }>('SELECT version() AS version');
  const latencyMs = performance.now() - started;
  const version = rows[0]?.version ?? 'unknown';
  const versionShort =
    version.match(/CockroachDB (?:CCL |C\.C\. )?(v[\d.]+)/)?.[1] ?? version.split(' (')[0];
  const indexes = await query<{ index_name: string }>(
    `SELECT index_name FROM crdb_internal.table_indexes WHERE descriptor_name = 'memories'`,
  );
  return {
    connected: true,
    version: versionShort,
    latencyMs: Math.round(latencyMs * 10) / 10,
    vectorIndex: indexes.some((row) => row.index_name === 'memories_embedding_idx'),
    vectorDimension: env.EMBEDDING_DIM,
  };
}
