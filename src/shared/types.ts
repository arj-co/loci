export const MEMORY_KINDS = [
  'fact',
  'preference',
  'person',
  'goal',
  'project',
  'health',
  'note',
] as const;

export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_KIND_LABELS: Record<MemoryKind, string> = {
  fact: 'Fact',
  preference: 'Preference',
  person: 'Person',
  goal: 'Goal',
  project: 'Project',
  health: 'Health',
  note: 'Note',
};

export interface User {
  id: string;
  handle: string;
  displayName: string;
  createdAt: string;
}

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
}

export interface Memory {
  id: string;
  kind: MemoryKind;
  content: string;
  importance: number;
  source: string | null;
  sourceSessionId: string | null;
  createdAt: string;
  lastRecalledAt: string | null;
  recallCount: number;
  similarity?: number;
  score?: number;
}

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  status: 'open' | 'done';
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  trace?: TurnTrace | null;
  createdAt: string;
}

export interface RecalledMemory extends Memory {
  similarity: number;
  score: number;
  ageDays: number;
}

export interface RetrievalTrace {
  query: string;
  latencyMs: number;
  candidates: number;
  memories: RecalledMemory[];
  tasks: Task[];
}

export interface ToolEvent {
  id: string;
  name: string;
  label: string;
  args: Record<string, unknown>;
  result?: string;
  status: 'running' | 'done' | 'error';
}

export interface TurnTrace {
  retrieval: RetrievalTrace;
  toolCalls: ToolEvent[];
  memoriesWritten: Memory[];
  memoriesDeduped: number;
  tasksChanged: Task[];
  timings: {
    retrievalMs: number;
    answerMs: number;
    consolidationMs: number;
  };
}

export interface MemoryStats {
  totalMemories: number;
  byKind: Record<string, number>;
  openTasks: number;
  completedTasks: number;
  totalSessions: number;
  totalMessages: number;
  avgImportance: number;
}

export interface DbStatus {
  connected: boolean;
  version: string;
  latencyMs: number;
  vectorIndex: boolean;
  vectorDimension: number;
  provider: string;
  model: string;
}

export interface Bootstrap {
  user: User;
  sessions: Session[];
  memories: Memory[];
  tasks: Task[];
  stats: MemoryStats;
  db: DbStatus;
}

export type ChatEvent =
  | { type: 'retrieval'; retrieval: RetrievalTrace }
  | { type: 'status'; label: string }
  | { type: 'tool'; tool: ToolEvent }
  | { type: 'reply'; content: string }
  | { type: 'memory_saved'; memory: Memory; deduped: boolean }
  | { type: 'task_changed'; task: Task }
  | { type: 'done'; message: Message; trace: TurnTrace }
  | { type: 'error'; message: string };
