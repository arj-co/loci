import { pathToFileURL } from 'node:url';
import { pool, query, toVector } from './db';
import { embedTexts } from './embeddings';
import { ensureDemoUser, resetUserData } from './users';
import { runMigrations } from './migrate';
import { demoMemories, demoSessions, demoTasks } from './demo-data';

function dateOffset(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function seedDemo({ reset = false }: { reset?: boolean } = {}): Promise<{
  sessions: number;
  memories: number;
  tasks: number;
}> {
  await runMigrations({ log: false });
  const user = await ensureDemoUser();

  const existing = await query<{ count: string | number }>(
    'SELECT count(*) AS count FROM memories WHERE user_id = $1',
    [user.id],
  );
  if (Number(existing[0]?.count ?? 0) > 0 && !reset) {
    console.log(
      `[loci] ${user.handle} already has memories. Use \`npm run db:reset\` to replace the demo.`,
    );
    return { sessions: 0, memories: 0, tasks: 0 };
  }

  if (reset) {
    console.log('[loci] clearing existing demo data…');
    await resetUserData(user.id);
  }

  const sessionIds = new Map<string, string>();
  for (const session of demoSessions) {
    const createdAt = new Date(Date.now() - session.daysAgo * 86_400_000);
    const lastMessage = session.messages[session.messages.length - 1];
    const updatedAt = new Date(createdAt.getTime() + (lastMessage?.minutesAfter ?? 0) * 60_000);
    const rows = await query<{ id: string }>(
      `INSERT INTO sessions (user_id, title, created_at, updated_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [user.id, session.title, createdAt.toISOString(), updatedAt.toISOString()],
    );
    const sessionId = rows[0].id;
    sessionIds.set(session.title, sessionId);

    for (const message of session.messages) {
      const at = new Date(createdAt.getTime() + message.minutesAfter * 60_000);
      await query(
        `INSERT INTO messages (session_id, user_id, role, content, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [sessionId, user.id, message.role, message.content, at.toISOString()],
      );
    }
  }

  console.log(`[loci] embedding ${demoMemories.length} seed memories…`);
  const vectors = await embedTexts(demoMemories.map((memory) => memory.content));
  for (let i = 0; i < demoMemories.length; i += 1) {
    const memory = demoMemories[i];
    await query(
      `INSERT INTO memories
         (user_id, kind, content, embedding, importance, source, source_session_id, created_at)
       VALUES ($1, $2, $3, $4::vector, $5, 'seed', $6, now() - $7::INTERVAL)`,
      [
        user.id,
        memory.kind,
        memory.content,
        toVector(vectors[i]),
        memory.importance,
        memory.sourceSession ? (sessionIds.get(memory.sourceSession) ?? null) : null,
        `${memory.daysAgo} days`,
      ],
    );
  }

  for (const task of demoTasks) {
    await query(
      `INSERT INTO tasks (user_id, title, notes, status, due_at)
       VALUES ($1, $2, $3, $4, $5::DATE)`,
      [user.id, task.title, task.notes, task.status, dateOffset(task.dueInDays)],
    );
  }

  // Give the optimizer stats so it chooses the vector index for ANN queries.
  await query('ANALYZE memories');

  console.log(
    `[loci] seeded ${user.displayName}: ${demoSessions.length} sessions, ${demoMemories.length} memories, ${demoTasks.length} tasks.`,
  );
  return {
    sessions: demoSessions.length,
    memories: demoMemories.length,
    tasks: demoTasks.length,
  };
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain) {
  seedDemo({ reset: process.argv.includes('--reset') })
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (error) => {
      console.error('[loci] seed failed:', error);
      await pool.end().catch(() => undefined);
      process.exit(1);
    });
}
