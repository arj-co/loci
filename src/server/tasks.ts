import { one, query } from './db';
import { taskFromRow } from './memory';
import type { Task } from '../shared/types';

const TASK_COLUMNS =
  'id, title, notes, status, due_at::STRING AS due_at, created_at, updated_at';

interface TaskRow {
  id: string;
  title: string;
  notes: string | null;
  status: 'open' | 'done';
  due_at: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export async function listTasks(
  userId: string,
  options: { status?: 'open' | 'done' | 'all'; limit?: number } = {},
): Promise<Task[]> {
  const status = options.status ?? 'all';
  const limit = options.limit ?? 50;
  const rows =
    status === 'all'
      ? await query<TaskRow>(
          `SELECT ${TASK_COLUMNS} FROM tasks
            WHERE user_id = $1
            ORDER BY status = 'done', due_at ASC NULLS LAST, created_at DESC
            LIMIT $2`,
          [userId, limit],
        )
      : await query<TaskRow>(
          `SELECT ${TASK_COLUMNS} FROM tasks
            WHERE user_id = $1 AND status = $2
            ORDER BY due_at ASC NULLS LAST, created_at DESC
            LIMIT $3`,
          [userId, status, limit],
        );
  return rows.map(taskFromRow);
}

export async function getTask(userId: string, taskId: string): Promise<Task | null> {
  const row = await one<TaskRow>(
    `SELECT ${TASK_COLUMNS} FROM tasks WHERE id = $1 AND user_id = $2`,
    [taskId, userId],
  );
  return row ? taskFromRow(row) : null;
}

export interface CreateTaskInput {
  userId: string;
  title: string;
  notes?: string | null;
  dueAt?: string | null;
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const title = input.title.trim().slice(0, 300);
  if (!title) throw new Error('Task title is empty.');
  const dueAt = normalizeDate(input.dueAt);
  const row = await one<TaskRow>(
    `INSERT INTO tasks (user_id, title, notes, due_at)
     VALUES ($1, $2, $3, $4::DATE)
     RETURNING ${TASK_COLUMNS}`,
    [input.userId, title, input.notes?.trim().slice(0, 1_000) || null, dueAt],
  );
  if (!row) throw new Error('Failed to create task.');
  return taskFromRow(row);
}

export async function updateTask(
  userId: string,
  taskId: string,
  patch: { title?: string; notes?: string | null; status?: 'open' | 'done'; dueAt?: string | null },
): Promise<Task | null> {
  const current = await getTask(userId, taskId);
  if (!current) return null;

  const row = await one<TaskRow>(
    `UPDATE tasks
        SET title = $1, notes = $2, status = $3, due_at = $4::DATE, updated_at = now()
      WHERE id = $5 AND user_id = $6
      RETURNING ${TASK_COLUMNS}`,
    [
      patch.title?.trim().slice(0, 300) || current.title,
      patch.notes === undefined ? current.notes : patch.notes,
      patch.status ?? current.status,
      patch.dueAt === undefined ? current.dueAt : normalizeDate(patch.dueAt),
      taskId,
      userId,
    ],
  );
  return row ? taskFromRow(row) : null;
}

export async function completeTask(userId: string, taskId: string): Promise<Task | null> {
  return updateTask(userId, taskId, { status: 'done' });
}

export async function findOpenTaskByTitle(userId: string, title: string): Promise<Task | null> {
  const row = await one<TaskRow>(
    `SELECT ${TASK_COLUMNS} FROM tasks
      WHERE user_id = $1 AND status = 'open' AND lower(title) = lower($2)
      LIMIT 1`,
    [userId, title.trim()],
  );
  return row ? taskFromRow(row) : null;
}

export async function tasksAsContext(userId: string): Promise<Task[]> {
  return listTasks(userId, { status: 'open', limit: 12 });
}

function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}
