import { one, query } from './db';
import type { Message, Session, TurnTrace } from '../shared/types';

interface SessionRow {
  id: string;
  title: string;
  created_at: Date | string;
  updated_at: Date | string;
  message_count?: string | number;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  trace: TurnTrace | null;
  created_at: Date | string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapSession(row: SessionRow): Session {
  return {
    id: row.id,
    title: row.title,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    messageCount: row.message_count === undefined ? undefined : Number(row.message_count),
  };
}

function mapMessage(row: MessageRow): Message {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    trace: row.trace,
    createdAt: iso(row.created_at),
  };
}

export async function listSessions(userId: string, limit = 40): Promise<Session[]> {
  const rows = await query<SessionRow>(
    `SELECT s.id, s.title, s.created_at, s.updated_at, count(m.id) AS message_count
       FROM sessions s
       LEFT JOIN messages m ON m.session_id = s.id
      WHERE s.user_id = $1
      GROUP BY s.id
      ORDER BY s.updated_at DESC
      LIMIT $2`,
    [userId, limit],
  );
  return rows.map(mapSession);
}

export async function createSession(userId: string, title = 'New session'): Promise<Session> {
  const row = await one<SessionRow>(
    `INSERT INTO sessions (user_id, title)
     VALUES ($1, $2)
     RETURNING id, title, created_at, updated_at, 0 AS message_count`,
    [userId, title.trim().slice(0, 120) || 'New session'],
  );
  if (!row) throw new Error('Failed to create session.');
  return mapSession(row);
}

export async function getSession(userId: string, sessionId: string): Promise<Session | null> {
  const row = await one<SessionRow>(
    `SELECT s.id, s.title, s.created_at, s.updated_at, count(m.id) AS message_count
       FROM sessions s
       LEFT JOIN messages m ON m.session_id = s.id
      WHERE s.id = $1 AND s.user_id = $2
      GROUP BY s.id`,
    [sessionId, userId],
  );
  return row ? mapSession(row) : null;
}

export async function getMessages(sessionId: string, limit = 200): Promise<Message[]> {
  const rows = await query<MessageRow>(
    `SELECT id, session_id, role, content, trace, created_at
       FROM messages
      WHERE session_id = $1
      ORDER BY created_at ASC
      LIMIT $2`,
    [sessionId, limit],
  );
  return rows.map(mapMessage);
}

export async function getRecentMessages(sessionId: string, limit = 12): Promise<Message[]> {
  const rows = await query<MessageRow>(
    `SELECT * FROM (
       SELECT id, session_id, role, content, trace, created_at
         FROM messages
        WHERE session_id = $1
        ORDER BY created_at DESC
        LIMIT $2
     ) ORDER BY created_at ASC`,
    [sessionId, limit],
  );
  return rows.map(mapMessage);
}

export async function addMessage(input: {
  sessionId: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  trace?: TurnTrace | null;
}): Promise<Message> {
  const row = await one<MessageRow>(
    `INSERT INTO messages (session_id, user_id, role, content, trace)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, session_id, role, content, trace, created_at`,
    [
      input.sessionId,
      input.userId,
      input.role,
      input.content,
      input.trace ? JSON.stringify(input.trace) : null,
    ],
  );
  if (!row) throw new Error('Failed to save message.');
  return mapMessage(row);
}

export async function updateSessionTitle(
  userId: string,
  sessionId: string,
  title: string,
): Promise<void> {
  await query(
    `UPDATE sessions
        SET title = $1, updated_at = now()
      WHERE id = $2 AND user_id = $3`,
    [title.trim().slice(0, 120), sessionId, userId],
  );
}

export async function touchSession(sessionId: string): Promise<void> {
  await query('UPDATE sessions SET updated_at = now() WHERE id = $1', [sessionId]);
}

export async function deleteSession(userId: string, sessionId: string): Promise<boolean> {
  const row = await one<{ id: string }>(
    'DELETE FROM sessions WHERE id = $1 AND user_id = $2 RETURNING id',
    [sessionId, userId],
  );
  return Boolean(row);
}

export function titleFromMessage(message: string): string {
  const clean = message.replace(/\s+/g, ' ').trim();
  const words = clean.split(' ').slice(0, 7).join(' ');
  const title = words.length < clean.length ? `${words}…` : words;
  return title.charAt(0).toUpperCase() + title.slice(1);
}
