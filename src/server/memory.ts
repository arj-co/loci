import { query, one, toVector } from './db';
import { embedText, embedTexts, cosineSimilarity } from './embeddings';
import { env } from './env';
import type {
  Memory,
  MemoryKind,
  MemoryStats,
  RecalledMemory,
  Task,
} from '../shared/types';

interface MemoryRow {
  id: string;
  kind: MemoryKind;
  content: string;
  importance: number;
  source: string | null;
  source_session_id: string | null;
  created_at: Date | string;
  last_recalled_at: Date | string | null;
  recall_count: string | number;
  similarity?: number;
  score?: number;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function mapMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    kind: row.kind,
    content: row.content,
    importance: Number(row.importance),
    source: row.source,
    sourceSessionId: row.source_session_id,
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
    lastRecalledAt: iso(row.last_recalled_at),
    recallCount: Number(row.recall_count ?? 0),
  };
}

function ageInDays(isoDate: string): number {
  return Math.max(0, (Date.now() - new Date(isoDate).getTime()) / 86_400_000);
}

function combinedScore(similarity: number, importance: number, createdAt: string): number {
  const recency = Math.exp(-ageInDays(createdAt) / 90);
  return 0.7 * Math.max(0, similarity) + 0.2 * importance + 0.1 * recency;
}

export interface RetrievalResult {
  query: string;
  latencyMs: number;
  candidates: number;
  memories: RecalledMemory[];
  tasks: Task[];
}

export async function retrieveMemories(
  userId: string,
  queryText: string,
  options: { limit?: number; candidateLimit?: number; recordAccess?: boolean } = {},
): Promise<{
  query: string;
  latencyMs: number;
  candidates: number;
  memories: RecalledMemory[];
}> {
  const started = performance.now();
  const limit = options.limit ?? env.MEMORY_TOP_K;
  const candidateLimit = options.candidateLimit ?? env.MEMORY_CANDIDATES;
  const vector = await embedText(queryText);
  const embeddingMs = performance.now() - started;

  // The vector index is used because user_id and archived are prefix columns,
  // and the query orders by the indexed cosine distance operator (<=>).
  const rows = await query<MemoryRow>(
    `SELECT id, kind, content, importance, source, source_session_id,
            created_at, last_recalled_at, recall_count,
            1 - (embedding <=> $1::vector) AS similarity
       FROM memories
      WHERE user_id = $2 AND archived = false
      ORDER BY embedding <=> $1::vector
      LIMIT $3`,
    [toVector(vector), userId, candidateLimit],
  );

  const now = Date.now();
  const scored = rows.map((row) => {
    const similarity = Number(row.similarity ?? 0);
    const createdAt = iso(row.created_at) ?? new Date(now).toISOString();
    return {
      ...mapMemory(row),
      similarity,
      ageDays: Math.round(ageInDays(createdAt) * 10) / 10,
      score: combinedScore(similarity, Number(row.importance), createdAt),
    } as RecalledMemory;
  });

  scored.sort((a, b) => b.score - a.score);
  const memories = scored
    .filter((memory) => memory.similarity > 0.05 || memory.importance >= 0.8)
    .slice(0, limit);

  if (options.recordAccess !== false && memories.length > 0) {
    const placeholders = memories.map((_, index) => `$${index + 1}::UUID`).join(', ');
    await query(
      `UPDATE memories
          SET last_recalled_at = now(), recall_count = recall_count + 1
        WHERE id IN (${placeholders})`,
      memories.map((memory) => memory.id),
    );
  }

  return {
    query: queryText,
    latencyMs: Math.round((performance.now() - started) * 10) / 10,
    candidates: rows.length,
    memories: memories.map((memory) => ({
      ...memory,
      similarity: Math.round(memory.similarity * 10_000) / 10_000,
      score: Math.round(memory.score * 10_000) / 10_000,
    })),
  };
}

export async function listMemories(
  userId: string,
  options: { q?: string; kind?: MemoryKind; limit?: number } = {},
): Promise<Memory[]> {
  const limit = options.limit ?? 100;
  if (options.q?.trim()) {
    const result = await retrieveMemories(userId, options.q.trim(), {
      limit,
      candidateLimit: 100,
      recordAccess: false,
    });
    const filtered = options.kind
      ? result.memories.filter((memory) => memory.kind === options.kind)
      : result.memories;
    return filtered.map((memory) => ({
      ...memory,
      similarity: memory.similarity,
      score: memory.score,
    }));
  }

  const rows = options.kind
    ? await query<MemoryRow>(
        `SELECT id, kind, content, importance, source, source_session_id,
                created_at, last_recalled_at, recall_count
           FROM memories
          WHERE user_id = $1 AND archived = false AND kind = $2
          ORDER BY created_at DESC
          LIMIT $3`,
        [userId, options.kind, limit],
      )
    : await query<MemoryRow>(
        `SELECT id, kind, content, importance, source, source_session_id,
                created_at, last_recalled_at, recall_count
           FROM memories
          WHERE user_id = $1 AND archived = false
          ORDER BY created_at DESC
          LIMIT $2`,
        [userId, limit],
      );
  return rows.map(mapMemory);
}

export interface SaveMemoryInput {
  userId: string;
  kind: MemoryKind;
  content: string;
  importance?: number;
  source?: string;
  sourceSessionId?: string | null;
}

export async function saveMemory(
  input: SaveMemoryInput,
): Promise<{ memory: Memory; deduped: boolean }> {
  const content = input.content.trim().slice(0, 2_000);
  if (!content) throw new Error('Memory content is empty.');
  const embedding = await embedText(content);

  // Avoid re-storing the same idea in slightly different words.
  const nearest = await one<MemoryRow>(
    `SELECT id, kind, content, importance, source, source_session_id,
            created_at, last_recalled_at, recall_count,
            1 - (embedding <=> $1::vector) AS similarity
       FROM memories
      WHERE user_id = $2 AND archived = false
      ORDER BY embedding <=> $1::vector
      LIMIT 1`,
    [toVector(embedding), input.userId],
  );

  if (nearest && Number(nearest.similarity) >= env.MEMORY_DEDUPE_THRESHOLD) {
    if ((input.importance ?? 0.5) > Number(nearest.importance)) {
      await query('UPDATE memories SET importance = $1 WHERE id = $2', [
        input.importance,
        nearest.id,
      ]);
    }
    return { memory: mapMemory(nearest), deduped: true };
  }

  const row = await one<MemoryRow>(
    `INSERT INTO memories
       (user_id, kind, content, embedding, importance, source, source_session_id)
     VALUES ($1, $2, $3, $4::vector, $5, $6, $7)
     RETURNING id, kind, content, importance, source, source_session_id,
               created_at, last_recalled_at, recall_count`,
    [
      input.userId,
      input.kind,
      content,
      toVector(embedding),
      Math.min(1, Math.max(0, input.importance ?? 0.5)),
      input.source ?? 'conversation',
      input.sourceSessionId ?? null,
    ],
  );
  if (!row) throw new Error('Failed to save memory.');
  return { memory: mapMemory(row), deduped: false };
}

export async function saveMemories(
  inputs: SaveMemoryInput[],
): Promise<{ memory: Memory; deduped: boolean }[]> {
  if (inputs.length === 0) return [];

  const vectors = await embedTexts(inputs.map((input) => input.content));
  const results: { memory: Memory; deduped: boolean }[] = [];

  // Keep writes sequential: CockroachDB docs recommend avoiding large vector
  // batch inserts, and dedupe checks need to see earlier writes.
  for (let i = 0; i < inputs.length; i += 1) {
    const input = inputs[i];
    const embedding = vectors[i];
    const nearest = await one<MemoryRow>(
      `SELECT id, kind, content, importance, source, source_session_id,
              created_at, last_recalled_at, recall_count,
              1 - (embedding <=> $1::vector) AS similarity
         FROM memories
        WHERE user_id = $2 AND archived = false
        ORDER BY embedding <=> $1::vector
        LIMIT 1`,
      [toVector(embedding), input.userId],
    );

    if (nearest && Number(nearest.similarity) >= env.MEMORY_DEDUPE_THRESHOLD) {
      results.push({ memory: mapMemory(nearest), deduped: true });
      continue;
    }

    const row = await one<MemoryRow>(
      `INSERT INTO memories
         (user_id, kind, content, embedding, importance, source, source_session_id)
       VALUES ($1, $2, $3, $4::vector, $5, $6, $7)
       RETURNING id, kind, content, importance, source, source_session_id,
                 created_at, last_recalled_at, recall_count`,
      [
        input.userId,
        input.kind,
        input.content.trim().slice(0, 2_000),
        toVector(embedding),
        Math.min(1, Math.max(0, input.importance ?? 0.5)),
        input.source ?? 'conversation',
        input.sourceSessionId ?? null,
      ],
    );
    if (row) results.push({ memory: mapMemory(row), deduped: false });
  }

  return results;
}

export async function archiveMemory(userId: string, memoryId: string): Promise<boolean> {
  const row = await one<{ id: string }>(
    `UPDATE memories SET archived = true
      WHERE id = $1 AND user_id = $2
      RETURNING id`,
    [memoryId, userId],
  );
  return Boolean(row);
}

export async function memoryStats(userId: string): Promise<MemoryStats> {
  const kinds = await query<{ kind: string; count: string | number }>(
    `SELECT kind, count(*) AS count
       FROM memories
      WHERE user_id = $1 AND archived = false
      GROUP BY kind`,
    [userId],
  );
  const totals = await one<{
    total: string | number;
    avg_importance: number | null;
  }>(
    `SELECT count(*) AS total, avg(importance) AS avg_importance
       FROM memories
      WHERE user_id = $1 AND archived = false`,
    [userId],
  );
  const tasks = await query<{ status: string; count: string | number }>(
    `SELECT status, count(*) AS count FROM tasks WHERE user_id = $1 GROUP BY status`,
    [userId],
  );
  const sessions = await one<{ total: string | number }>(
    'SELECT count(*) AS total FROM sessions WHERE user_id = $1',
    [userId],
  );
  const messages = await one<{ total: string | number }>(
    'SELECT count(*) AS total FROM messages WHERE user_id = $1',
    [userId],
  );

  const byKind: Record<string, number> = {};
  for (const row of kinds) byKind[row.kind] = Number(row.count);

  return {
    totalMemories: Number(totals?.total ?? 0),
    byKind,
    openTasks: Number(tasks.find((row) => row.status === 'open')?.count ?? 0),
    completedTasks: Number(tasks.find((row) => row.status === 'done')?.count ?? 0),
    totalSessions: Number(sessions?.total ?? 0),
    totalMessages: Number(messages?.total ?? 0),
    avgImportance: Math.round(Number(totals?.avg_importance ?? 0) * 100) / 100,
  };
}

export function taskFromRow(row: {
  id: string;
  title: string;
  notes: string | null;
  status: 'open' | 'done';
  due_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}): Task {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    status: row.status,
    dueAt: row.due_at ? String(row.due_at).slice(0, 10) : null,
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
    updatedAt: iso(row.updated_at) ?? new Date().toISOString(),
  };
}
