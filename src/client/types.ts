import type {
  Memory,
  Message,
  RetrievalTrace,
  Task,
  ToolEvent,
  User,
} from '../shared/types';

export interface PendingTurn {
  user: Message;
  stage: string;
  retrieval?: RetrievalTrace;
  tools: ToolEvent[];
  reply: string;
  memoriesWritten: Memory[];
  tasksChanged: Task[];
  error?: string;
}

export interface UiToast {
  id: number;
  message: string;
  tone: 'ok' | 'error' | 'info';
}

export type { User };
