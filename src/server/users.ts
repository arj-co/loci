import { one, query } from './db';
import { env } from './env';
import type { User } from '../shared/types';

interface UserRow {
  id: string;
  handle: string;
  display_name: string;
  created_at: Date | string;
}

function mapUser(row: UserRow): User {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

function titleCase(handle: string): string {
  return handle
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export async function ensureDemoUser(): Promise<User> {
  const row = await one<UserRow>(
    `INSERT INTO users (handle, display_name)
     VALUES ($1, $2)
     ON CONFLICT (handle) DO UPDATE SET display_name = excluded.display_name
     RETURNING id, handle, display_name, created_at`,
    [env.DEMO_USER_HANDLE, titleCase(env.DEMO_USER_HANDLE)],
  );
  if (!row) throw new Error('Unable to create the demo user.');
  return mapUser(row);
}

export async function getUser(userId: string): Promise<User | null> {
  const row = await one<UserRow>(
    'SELECT id, handle, display_name, created_at FROM users WHERE id = $1',
    [userId],
  );
  return row ? mapUser(row) : null;
}

export async function resetUserData(userId: string): Promise<void> {
  await query('DELETE FROM messages WHERE user_id = $1', [userId]);
  await query('DELETE FROM tasks WHERE user_id = $1', [userId]);
  await query('DELETE FROM memories WHERE user_id = $1', [userId]);
  await query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}
