import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Database, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import type {
  Bootstrap,
  Memory,
  MemoryKind,
  Message,
  Task,
} from '../shared/types';
import type { PendingTurn, UiToast } from './types';
import {
  addMemory,
  addTask,
  archiveMemory,
  createSession,
  getBootstrap,
  getSessionMessages,
  patchTask,
  resetDemo,
  streamChat,
} from './api';
import { Sidebar } from './components/Sidebar';
import { ChatView } from './components/Chat';
import { MemoryPanel } from './components/MemoryPanel';
import { HowItWorks } from './components/HowItWorks';
import { BrandMark } from './components/Brand';
import { titleFromMessage } from './utils';

const SESSION_KEY = 'loci:session';

function recomputeStats(data: Bootstrap): Bootstrap {
  const byKind: Record<string, number> = {};
  for (const memory of data.memories) {
    byKind[memory.kind] = (byKind[memory.kind] ?? 0) + 1;
  }
  return {
    ...data,
    stats: {
      ...data.stats,
      totalMemories: data.memories.length,
      byKind,
      openTasks: data.tasks.filter((task) => task.status === 'open').length,
      completedTasks: data.tasks.filter((task) => task.status === 'done').length,
    },
  };
}

function upsertMemory(memories: Memory[], memory: Memory): Memory[] {
  const existing = memories.findIndex((item) => item.id === memory.id);
  if (existing === -1) return [memory, ...memories];
  const next = [...memories];
  next[existing] = { ...next[existing], ...memory };
  return next;
}

function upsertTask(tasks: Task[], task: Task): Task[] {
  const existing = tasks.findIndex((item) => item.id === task.id);
  if (existing === -1) return [task, ...tasks];
  const next = [...tasks];
  next[existing] = { ...next[existing], ...task };
  return next;
}

export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingSession, setLoadingSession] = useState(false);
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const [toast, setToast] = useState<UiToast | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const loadSeq = useRef(0);
  const toastTimer = useRef<number | null>(null);

  const showToast = (message: string, tone: UiToast['tone'] = 'info') => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), message, tone });
    toastTimer.current = window.setTimeout(() => setToast(null), 3600);
  };

  const loadSession = async (sessionId: string, options: { quiet?: boolean } = {}) => {
    if (pending) return;
    const seq = ++loadSeq.current;
    if (!options.quiet) setLoadingSession(true);
    try {
      const result = await getSessionMessages(sessionId);
      if (loadSeq.current !== seq) return;
      setActiveSessionId(sessionId);
      setMessages(result.messages);
      localStorage.setItem(SESSION_KEY, sessionId);
      setData((current) =>
        current
          ? {
              ...current,
              sessions: current.sessions.map((session) =>
                session.id === result.session.id ? result.session : session,
              ),
            }
          : current,
      );
      setSidebarOpen(false);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not load that session.', 'error');
    } finally {
      if (loadSeq.current === seq) setLoadingSession(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const bootstrap = await getBootstrap();
        if (cancelled) return;
        setData(bootstrap);
        const saved = localStorage.getItem(SESSION_KEY);
        if (saved && bootstrap.sessions.some((session) => session.id === saved)) {
          await loadSession(saved);
        } else {
          localStorage.removeItem(SESSION_KEY);
        }
      } catch (error) {
        if (!cancelled) {
          setFatal(error instanceof Error ? error.message : 'Could not reach the Loci API.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
    // The bootstrap should only run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeSessionId) localStorage.setItem(SESSION_KEY, activeSessionId);
    else localStorage.removeItem(SESSION_KEY);
  }, [activeSessionId]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const activeSession =
    data?.sessions.find((session) => session.id === activeSessionId) ?? null;

  const sendMessage = async (text: string) => {
    if (!data || pending) return;

    let sessionId = activeSessionId;
    let sessionForTurn = activeSession;

    if (!sessionId) {
      try {
        const created = await createSession();
        sessionId = created.id;
        const optimistic = { ...created, title: titleFromMessage(text) };
        sessionForTurn = optimistic;
        setActiveSessionId(created.id);
        localStorage.setItem(SESSION_KEY, created.id);
        setData((current) =>
          current
            ? {
                ...current,
                sessions: [optimistic, ...current.sessions],
                stats: { ...current.stats, totalSessions: current.stats.totalSessions + 1 },
              }
            : current,
        );
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Could not start a session.', 'error');
        return;
      }
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      sessionId,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };

    setPending({
      user: userMessage,
      stage: 'Recalling memories',
      tools: [],
      reply: '',
      memoriesWritten: [],
      tasksChanged: [],
    });
    setSidebarOpen(false);
    setMemoryOpen(false);

    const controller = new AbortController();
    abortRef.current = controller;
    let finished = false;

    try {
      await streamChat(
        sessionId,
        text,
        (event) => {
          if (event.type === 'retrieval') {
            setPending((current) =>
              current ? { ...current, retrieval: event.retrieval } : current,
            );
            const recalled = new Set(event.retrieval.memories.map((memory) => memory.id));
            setData((current) =>
              current
                ? {
                    ...current,
                    memories: current.memories.map((memory) =>
                      recalled.has(memory.id)
                        ? {
                            ...memory,
                            recallCount: memory.recallCount + 1,
                            lastRecalledAt: new Date().toISOString(),
                          }
                        : memory,
                    ),
                  }
                : current,
            );
          } else if (event.type === 'status') {
            setPending((current) => (current ? { ...current, stage: event.label } : current));
          } else if (event.type === 'tool') {
            setPending((current) => {
              if (!current) return current;
              const tools = [...current.tools];
              const index = tools.findIndex((tool) => tool.id === event.tool.id);
              if (index === -1) tools.push(event.tool);
              else tools[index] = event.tool;
              return { ...current, tools };
            });
          } else if (event.type === 'reply') {
            setPending((current) =>
              current ? { ...current, reply: event.content, stage: 'Saving what matters' } : current,
            );
          } else if (event.type === 'memory_saved') {
            setPending((current) =>
              current
                ? { ...current, memoriesWritten: [...current.memoriesWritten, event.memory] }
                : current,
            );
            setData((current) => {
              if (!current) return current;
              if (current.memories.some((memory) => memory.id === event.memory.id)) return current;
              return recomputeStats({
                ...current,
                memories: [event.memory, ...current.memories],
              });
            });
          } else if (event.type === 'task_changed') {
            setPending((current) =>
              current
                ? { ...current, tasksChanged: upsertTask(current.tasksChanged, event.task) }
                : current,
            );
            setData((current) =>
              current
                ? recomputeStats({
                    ...current,
                    tasks: upsertTask(current.tasks, event.task),
                  })
                : current,
            );
          } else if (event.type === 'done') {
            finished = true;
            setMessages((current) => [...current, userMessage, event.message]);
            setPending(null);
            abortRef.current = null;
            setData((current) => {
              if (!current) return current;
              return {
                ...current,
                sessions: current.sessions.map((session) =>
                  session.id === sessionId
                    ? {
                        ...session,
                        title:
                          session.title === 'New session'
                            ? titleFromMessage(userMessage.content)
                            : session.title,
                        updatedAt: new Date().toISOString(),
                        messageCount: (session.messageCount ?? 0) + 2,
                      }
                    : session,
                ),
              };
            });
          } else if (event.type === 'error') {
            finished = true;
            setPending(null);
            abortRef.current = null;
            showToast(
              event.message ||
                'The model server did not respond. Is Ollama running? Check .env.',
              'error',
            );
            if (sessionId) void loadSession(sessionId, { quiet: true });
          }
        },
        controller.signal,
      );

      if (!finished) {
        setPending(null);
        showToast('The agent stream ended before the reply was saved.', 'error');
        if (sessionId) void loadSession(sessionId, { quiet: true });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setPending(null);
      showToast(
        error instanceof Error
          ? error.message
          : 'The turn failed. Check that CockroachDB and your model server are running.',
        'error',
      );
      if (sessionId) void loadSession(sessionId, { quiet: true });
    } finally {
      abortRef.current = null;
      void sessionForTurn;
    }
  };

  const handleAddMemory = async (input: {
    content: string;
    kind: MemoryKind;
    importance?: number;
  }) => {
    const result = await addMemory(input);
    setData((current) =>
      current
        ? recomputeStats({
            ...current,
            memories: upsertMemory(current.memories, result.memory),
          })
        : current,
    );
    showToast(
      result.deduped ? 'That memory already exists — deduped.' : 'Memory stored.',
      result.deduped ? 'info' : 'ok',
    );
    return result;
  };

  const handleArchiveMemory = async (id: string) => {
    try {
      await archiveMemory(id);
      setData((current) =>
        current
          ? recomputeStats({
              ...current,
              memories: current.memories.filter((memory) => memory.id !== id),
            })
          : current,
      );
      showToast('Memory archived.', 'ok');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not archive memory.', 'error');
    }
  };

  const handleAddTask = async (input: { title: string; dueAt: string | null }) => {
    const task = await addTask(input);
    setData((current) =>
      current
        ? recomputeStats({ ...current, tasks: upsertTask(current.tasks, task) })
        : current,
    );
    showToast('Open loop added.', 'ok');
    return task;
  };

  const handleToggleTask = async (task: Task) => {
    const nextStatus = task.status === 'open' ? 'done' : 'open';
    const updated = await patchTask(task.id, { status: nextStatus });
    setData((current) =>
      current
        ? recomputeStats({ ...current, tasks: upsertTask(current.tasks, updated) })
        : current,
    );
  };

  const handleNewSession = () => {
    if (pending) return;
    setActiveSessionId(null);
    setMessages([]);
    setMemoryOpen(false);
    setSidebarOpen(false);
  };

  const handleReset = async () => {
    if (resetting) return;
    const ok = window.confirm(
      'Reset the demo? This deletes the current conversations and reseeds 12 memories, 3 sessions, and 5 tasks.',
    );
    if (!ok) return;
    setResetting(true);
    try {
      const fresh = await resetDemo();
      setData(fresh);
      setActiveSessionId(null);
      setMessages([]);
      localStorage.removeItem(SESSION_KEY);
      showToast('Demo reset — 12 memories reseeded.', 'ok');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not reset the demo.', 'error');
    } finally {
      setResetting(false);
    }
  };

  if (loading) {
    return (
      <div className="boot-screen">
        <div className="boot-brand">
          <BrandMark size={46} />
          <span>Loci</span>
        </div>
        <div className="boot-status">
          <Loader2 size={15} className="spin" />
          Opening the memory palace…
        </div>
      </div>
    );
  }

  if (fatal || !data) {
    return <SetupScreen error={fatal ?? 'The API returned no data.'} />;
  }

  return (
    <div className="app-shell">
      <Sidebar
        user={data.user}
        sessions={data.sessions}
        activeSessionId={activeSessionId}
        db={data.db}
        open={sidebarOpen}
        busy={Boolean(pending)}
        resetting={resetting}
        onClose={() => setSidebarOpen(false)}
        onNew={handleNewSession}
        onSelect={(id) => void loadSession(id)}
        onHowItWorks={() => setHowOpen(true)}
        onReset={() => void handleReset()}
      />

      <div
        className={`app-backdrop ${sidebarOpen ? 'is-open' : ''}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />

      <ChatView
        user={data.user}
        activeSession={activeSession}
        messages={messages}
        pending={pending}
        loadingSession={loadingSession}
        stats={data.stats}
        memoryCount={data.memories.length}
        db={data.db}
        onSend={(text) => void sendMessage(text)}
        onOpenSidebar={() => setSidebarOpen(true)}
        onOpenMemory={() => setMemoryOpen(true)}
        onHowItWorks={() => setHowOpen(true)}
      />

      <MemoryPanel
        memories={data.memories}
        tasks={data.tasks}
        db={data.db}
        open={memoryOpen}
        onClose={() => setMemoryOpen(false)}
        onAddMemory={handleAddMemory}
        onArchiveMemory={handleArchiveMemory}
        onAddTask={handleAddTask}
        onToggleTask={handleToggleTask}
        onHowItWorks={() => setHowOpen(true)}
      />

      <HowItWorks open={howOpen} onClose={() => setHowOpen(false)} />

      {toast && (
        <div className={`toast toast-${toast.tone}`} key={toast.id} role="status">
          {toast.tone === 'error' ? (
            <AlertTriangle size={15} />
          ) : toast.tone === 'ok' ? (
            <Check size={15} />
          ) : (
            <Sparkles size={15} />
          )}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} aria-label="Dismiss">
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

function SetupScreen({ error }: { error: string }) {
  return (
    <div className="setup-screen">
      <div className="setup-card">
        <div className="setup-brand">
          <BrandMark size={40} />
          <span>Loci</span>
        </div>
        <div className="setup-eyebrow">
          <AlertTriangle size={13} /> Setup needed
        </div>
        <h1>The memory palace isn’t reachable.</h1>
        <p className="setup-error">{error}</p>
        <p>
          Start CockroachDB and the local models, then run the setup script. From the project
          root:
        </p>
        <pre className="setup-code">
          <code>{`docker compose up -d
cp .env.example .env
npm install
npm run setup
npm run dev`}</code>
        </pre>
        <p className="setup-note">
          <Database size={13} /> CockroachDB should be on <code>localhost:26257</code> and the
          app on <code>localhost:5173</code>. The default model profile uses Ollama.
        </p>
        <button className="setup-retry" onClick={() => window.location.reload()}>
          <RefreshCw size={15} /> Retry
        </button>
      </div>
    </div>
  );
}
