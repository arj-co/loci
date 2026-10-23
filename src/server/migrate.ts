import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { env } from './env';
import { query, pool } from './db';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Client } = pg;

function databaseName(url: string): string {
  const parsed = new URL(url);
  return decodeURIComponent(parsed.pathname.replace(/^\//, '')) || 'defaultdb';
}

async function ensureDatabase(): Promise<void> {
  const name = databaseName(env.DATABASE_URL);
  if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error(`Unsafe database name: ${name}`);
  const adminUrl = new URL(env.DATABASE_URL);
  adminUrl.pathname = '/defaultdb';
  const client = new Client({ connectionString: adminUrl.toString() });
  try {
    await client.connect();
    await client.query(`CREATE DATABASE IF NOT EXISTS "${name}"`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('already exists')) {
      console.warn(`[loci] could not create database "${name}" (continuing): ${message}`);
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function enableVectorIndexes(): Promise<void> {
  try {
    await query('SET CLUSTER SETTING feature.vector_index.enabled = true');
  } catch (error) {
    // On CockroachDB Cloud, this setting is managed for you.
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[loci] vector index setting not changed: ${message}`);
  }
}

export async function runMigrations({ log = true } = {}): Promise<void> {
  await ensureDatabase();
  const schemaPath = path.resolve(__dirname, '../../db/schema.sql');
  const schema = await readFile(schemaPath, 'utf8');
  const statements = schema
    .replace(/^\s*--.*$/gm, '')
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);

  await enableVectorIndexes();

  for (const statement of statements) {
    await query(statement);
  }

  if (log) {
    const indexes = await query<{ index_name: string }>(
      `SELECT index_name FROM crdb_internal.table_indexes WHERE descriptor_name = 'memories'`,
    );
    console.log(`[loci] schema ready (${indexes.length} memory indexes)`);
  }
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain) {
  runMigrations()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (error) => {
      console.error('[loci] migration failed:', error);
      await pool.end().catch(() => undefined);
      process.exit(1);
    });
}
