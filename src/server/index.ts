import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { env } from './env';
import { dbHealth, pool } from './db';
import { runMigrations } from './migrate';
import { ensureDemoUser } from './users';
import {
  archiveMemory,
  listMemories,
  memoryStats,
  saveMemory,
} from './memory';
import { createTask, listTasks, updateTask } from './tasks';
import {
  addMessage,
  createSession,
  deleteSession,
  getMessages,
  getRecentMessages,
  getSession,
  listSessions,
  titleFromMessage,
  touchSession,
  updateSessionTitle,
} from './sessions';
import { runAgentTurn } from './agent';
import { seedDemo } from './seed';
import { describeModel } from './llm';
import { MEMORY_KINDS } from '../shared/types';
import type { ChatEvent, User } from '../shared/types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));

let demoUser: User | null = null;
let startupError: string | null = null;

const ready = (async () => {
  try {
    await runMigrations({ log: false });
    demoUser = await ensureDemoUser();
    console.log(`[loci] database ready; demo user @${demoUser.handle}`);
  } catch (error) {
    startupError = error instanceof Error ? error.message : String(error);
    console.error('[loci] startup failed:', startupError);
  }
})();

async function requireUser(): Promise<User> {
  await ready;
  if (startupError) throw new HttpError(503, `Database unavailable: ${startupError}`);
  if (!demoUser) demoUser = await ensureDemoUser();
  return demoUser;
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const memoryInput = z.object({
  content: z.string().trim().min(3).max(2_000),
  kind: z.enum(MEMORY_KINDS).default('fact'),
  importance: z.coerce.number().min(0).max(1).default(0.65),
});

const taskInput = z.object({
  title: z.string().trim().min(3).max(240),
  notes: z.string().max(1_000).nullish(),
  dueAt: z.string().max(30).nullish(),
  status: z.enum(['open', 'done']).optional(),
});

app.get('/api/health', async (_req, res) => {
  const model = describeModel();
  try {
    await ready;
    if (startupError) throw new Error(startupError);
    const health = await dbHealth();
    res.json({
      ...health,
      provider: model.provider,
      model: model.model,
      embedding: {
        mode: env.EMBEDDING_PROVIDER,
        model: env.EMBEDDING_MODEL,
        dimension: env.EMBEDDING_DIM,
      },
    });
  } catch (error) {
    res.status(503).json({
      connected: false,
      error: error instanceof Error ? error.message : String(error),
      provider: model.provider,
      model: model.model,
    });
  }
});

app.get('/api/bootstrap', async (_req, res, next) => {
  try {
    const user = await requireUser();
    const model = describeModel();
    const [sessions, memories, tasks, stats, health] = await Promise.all([
      listSessions(user.id),
      listMemories(user.id, { limit: 100 }),
      listTasks(user.id, { status: 'all', limit: 100 }),
      memoryStats(user.id),
      dbHealth(),
    ]);
    res.json({
      user,
      sessions,
      memories,
      tasks,
      stats,
      db: {
        ...health,
        provider: model.provider,
        model: model.model,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/sessions', async (req, res, next) => {
  try {
    const user = await requireUser();
    const title = z.string().max(120).optional().parse(req.body?.title);
    const session = await createSession(user.id, title ?? 'New session');
    res.status(201).json({ session });
  } catch (error) {
    next(error);
  }
});

app.get('/api/sessions/:id', async (req, res, next) => {
  try {
    const user = await requireUser();
    const session = await getSession(user.id, req.params.id);
    if (!session) throw new HttpError(404, 'Session not found.');
    const messages = await getMessages(session.id);
    res.json({ session, messages });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/sessions/:id', async (req, res, next) => {
  try {
    const user = await requireUser();
    const deleted = await deleteSession(user.id, req.params.id);
    if (!deleted) throw new HttpError(404, 'Session not found.');
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/sessions/:id/chat', async (req, res, next) => {
  let heartbeat: NodeJS.Timeout | undefined;
  try {
    const user = await requireUser();
    const message = z.string().trim().min(1).max(8_000).parse(req.body?.message);
    const session = await getSession(user.id, req.params.id);
    if (!session) throw new HttpError(404, 'Session not found.');

    const userMessage = await addMessage({
      sessionId: session.id,
      userId: user.id,
      role: 'user',
      content: message,
    });

    const shouldTitle = session.title === 'New session' || !session.messageCount;
    if (shouldTitle) {
      await updateSessionTitle(user.id, session.id, titleFromMessage(message));
    }
    const priorMessages = await getRecentMessages(session.id, 14);
    await touchSession(session.id);

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = (event: ChatEvent) => {
      if (res.writableEnded) return;
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': keepalive\n\n');
    }, 15_000);

    const controller = new AbortController();
    res.on('close', () => controller.abort());

    try {
      for await (const event of runAgentTurn({
        user,
        session,
        userMessage,
        priorMessages,
        signal: controller.signal,
      })) {
        send(event);
      }
    } catch (error) {
      console.error('[loci] agent turn failed:', error);
      send({
        type: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'The agent turn failed. Check that your model server is running.',
      });
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    }
  } catch (error) {
    if (heartbeat) clearInterval(heartbeat);
    next(error);
  }
});

app.get('/api/memories', async (req, res, next) => {
  try {
    const user = await requireUser();
    const q = z.string().max(500).optional().parse(req.query.q);
    const kind = z.enum(MEMORY_KINDS).optional().parse(req.query.kind);
    const memories = await listMemories(user.id, { q, kind, limit: 100 });
    res.json({ memories });
  } catch (error) {
    next(error);
  }
});

app.post('/api/memories', async (req, res, next) => {
  try {
    const user = await requireUser();
    const input = memoryInput.parse(req.body);
    const saved = await saveMemory({
      userId: user.id,
      kind: input.kind,
      content: input.content,
      importance: input.importance,
      source: 'manual',
    });
    res.status(201).json(saved);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/memories/:id', async (req, res, next) => {
  try {
    const user = await requireUser();
    const archived = await archiveMemory(user.id, req.params.id);
    if (!archived) throw new HttpError(404, 'Memory not found.');
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/tasks', async (req, res, next) => {
  try {
    const user = await requireUser();
    const status = ['open', 'done', 'all'].includes(String(req.query.status))
      ? (String(req.query.status) as 'open' | 'done' | 'all')
      : 'all';
    const tasks = await listTasks(user.id, { status });
    res.json({ tasks });
  } catch (error) {
    next(error);
  }
});

app.post('/api/tasks', async (req, res, next) => {
  try {
    const user = await requireUser();
    const input = taskInput.parse(req.body);
    const task = await createTask({
      userId: user.id,
      title: input.title,
      notes: input.notes ?? null,
      dueAt: input.dueAt ?? null,
    });
    res.status(201).json({ task });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/tasks/:id', async (req, res, next) => {
  try {
    const user = await requireUser();
    const patch = taskInput.partial().parse(req.body);
    const task = await updateTask(user.id, req.params.id, patch);
    if (!task) throw new HttpError(404, 'Task not found.');
    res.json({ task });
  } catch (error) {
    next(error);
  }
});

app.post('/api/demo/reset', async (_req, res, next) => {
  try {
    const user = await requireUser();
    await seedDemo({ reset: true });
    const [sessions, memories, tasks, stats, health] = await Promise.all([
      listSessions(user.id),
      listMemories(user.id, { limit: 100 }),
      listTasks(user.id, { status: 'all', limit: 100 }),
      memoryStats(user.id),
      dbHealth(),
    ]);
    const model = describeModel();
    res.json({
      user,
      sessions,
      memories,
      tasks,
      stats,
      db: { ...health, provider: model.provider, model: model.model },
    });
  } catch (error) {
    next(error);
  }
});

// Production: serve the Vite build. In development, Vite proxies /api here.
const clientDir = path.resolve(__dirname, '../../dist/client');
if (existsSync(clientDir)) {
  app.use(express.static(clientDir, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDir, 'index.html'));
  });
}

app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
});

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.issues[0]?.message ?? 'Invalid request.' });
      return;
    }
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error('[loci] request failed:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error.',
    });
  },
);

const server = app.listen(env.PORT, () => {
  console.log(`[loci] API listening on http://localhost:${env.PORT}`);
  console.log(
    `[loci] chat: ${describeModel().provider} / ${describeModel().model}; embeddings: ${env.EMBEDDING_MODEL} (${env.EMBEDDING_DIM}d)`,
  );
});

async function shutdown() {
  console.log('\n[loci] shutting down…');
  server.close();
  await pool.end().catch(() => undefined);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
