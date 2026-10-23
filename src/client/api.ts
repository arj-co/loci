import type {
  Bootstrap,
  ChatEvent,
  Memory,
  MemoryKind,
  Message,
  Session,
  Task,
} from '../shared/types';

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Keep the status text.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export async function getBootstrap(): Promise<Bootstrap> {
  return json<Bootstrap>('/api/bootstrap');
}

export async function createSession(): Promise<Session> {
  const result = await json<{ session: Session }>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  return result.session;
}

export async function getSessionMessages(
  sessionId: string,
): Promise<{ session: Session; messages: Message[] }> {
  return json(`/api/sessions/${sessionId}`);
}

export async function deleteSession(sessionId: string): Promise<void> {
  await json(`/api/sessions/${sessionId}`, { method: 'DELETE' });
}

export async function searchMemories(query: string): Promise<Memory[]> {
  const response = await json<{ memories: Memory[] }>(
    `/api/memories?q=${encodeURIComponent(query)}`,
  );
  return response.memories;
}

export async function addMemory(input: {
  content: string;
  kind: MemoryKind;
  importance?: number;
}): Promise<{ memory: Memory; deduped: boolean }> {
  const result = await json<{ memory: Memory; deduped: boolean }>('/api/memories', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return { memory: result.memory, deduped: Boolean(result.deduped) };
}

export async function archiveMemory(memoryId: string): Promise<void> {
  await json(`/api/memories/${memoryId}`, { method: 'DELETE' });
}

export async function addTask(input: {
  title: string;
  notes?: string | null;
  dueAt?: string | null;
}): Promise<Task> {
  const result = await json<{ task: Task }>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return result.task;
}

export async function patchTask(
  taskId: string,
  patch: { status?: 'open' | 'done'; title?: string; notes?: string | null; dueAt?: string | null },
): Promise<Task> {
  const result = await json<{ task: Task }>(`/api/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return result.task;
}

export async function resetDemo(): Promise<Bootstrap> {
  return json<Bootstrap>('/api/demo/reset', { method: 'POST' });
}

export async function streamChat(
  sessionId: string,
  message: string,
  onEvent: (event: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`/api/sessions/${sessionId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
    signal,
  });

  if (!response.ok || !response.body) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      // Keep the status text.
    }
    throw new Error(detail);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
      if (!block.trim() || block.startsWith(':')) continue;

      let eventName = 'message';
      const dataLines: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      }
      if (dataLines.length === 0) continue;

      try {
        const parsed = JSON.parse(dataLines.join('\n')) as { type?: string };
        onEvent({ ...parsed, type: parsed.type ?? eventName } as ChatEvent);
      } catch {
        console.warn('[loci] could not parse SSE block', block.slice(0, 200));
      }
    }
  }

  if (buffer.trim()) {
    const dataLines = buffer
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());
    if (dataLines.length) {
      try {
        onEvent(JSON.parse(dataLines.join('\n')) as ChatEvent);
      } catch {
        // Ignore malformed tail data.
      }
    }
  }
}
