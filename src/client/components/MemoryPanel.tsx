import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  CalendarDays,
  Check,
  ChevronDown,
  Circle,
  Database,
  HelpCircle,
  Loader2,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type { DbStatus, Memory, MemoryKind, Task } from '../../shared/types';
import { MEMORY_KINDS } from '../../shared/types';
import { searchMemories } from '../api';
import { cx, formatDue, KIND_META, relativeTime } from '../utils';

type Filter = 'all' | MemoryKind;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'preference', label: 'Preferences' },
  { key: 'person', label: 'People' },
  { key: 'goal', label: 'Goals' },
  { key: 'project', label: 'Projects' },
  { key: 'health', label: 'Health' },
  { key: 'note', label: 'Notes' },
];

interface MemoryPanelProps {
  memories: Memory[];
  tasks: Task[];
  db: DbStatus;
  open: boolean;
  onClose: () => void;
  onAddMemory: (input: {
    content: string;
    kind: MemoryKind;
    importance?: number;
  }) => Promise<{ memory: Memory; deduped: boolean }>;
  onArchiveMemory: (id: string) => Promise<void>;
  onAddTask: (input: { title: string; dueAt: string | null }) => Promise<Task>;
  onToggleTask: (task: Task) => Promise<void>;
  onHowItWorks: () => void;
}

export function MemoryPanel({
  memories,
  tasks,
  db,
  open,
  onClose,
  onAddMemory,
  onArchiveMemory,
  onAddTask,
  onToggleTask,
  onHowItWorks,
}: MemoryPanelProps) {
  const [tab, setTab] = useState<'memories' | 'tasks'>('memories');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Memory[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftKind, setDraftKind] = useState<MemoryKind>('note');
  const [saving, setSaving] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const [taskDraft, setTaskDraft] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [savingTask, setSavingTask] = useState(false);
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const searchSeq = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const found = await searchMemories(trimmed);
        if (searchSeq.current === seq) setResults(found);
      } catch {
        if (searchSeq.current === seq) setResults([]);
      } finally {
        if (searchSeq.current === seq) setSearching(false);
      }
    }, 280);
    return () => clearTimeout(timer);
  }, [query]);

  const source = query.trim() ? results : memories;
  const visible = filter === 'all' ? source : source.filter((memory) => memory.kind === filter);
  const openTasks = tasks.filter((task) => task.status === 'open');
  const doneTasks = tasks.filter((task) => task.status === 'done');

  const submitMemory = async () => {
    if (!draft.trim() || saving) return;
    setSaving(true);
    try {
      await onAddMemory({ content: draft.trim(), kind: draftKind });
      setDraft('');
      setAdding(false);
    } finally {
      setSaving(false);
    }
  };

  const submitTask = async () => {
    if (!taskDraft.trim() || savingTask) return;
    setSavingTask(true);
    try {
      await onAddTask({ title: taskDraft.trim(), dueAt: taskDue || null });
      setTaskDraft('');
      setTaskDue('');
      setAddingTask(false);
    } finally {
      setSavingTask(false);
    }
  };

  const toggleTask = async (task: Task) => {
    setBusyTask(task.id);
    try {
      await onToggleTask(task);
    } finally {
      setBusyTask(null);
    }
  };

  return (
    <>
      <div
        className={cx('panel-backdrop', open && 'is-open')}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className={cx('memory-panel', open && 'is-open')} aria-label="Memory panel">
        <div className="memory-head">
          <div>
            <div className="memory-eyebrow">
              <Sparkles size={12} />
              Persistent memory
            </div>
            <h2>Memory palace</h2>
          </div>
          <div className="memory-head-actions">
            <button
              className="icon-button panel-close"
              onClick={onClose}
              aria-label="Close memory panel"
            >
              <X size={18} />
            </button>
            <button
              className="icon-button bordered"
              onClick={() => {
                setTab('memories');
                setAdding(true);
              }}
              aria-label="Add a memory"
              title="Add a memory"
            >
              <Plus size={17} />
            </button>
          </div>
        </div>

        <div className="memory-stats">
          <span>
            <strong>{memories.length}</strong> memories
          </span>
          <span className="stat-divider" />
          <span>
            <strong>{openTasks.length}</strong> open loops
          </span>
          <span className="stat-divider" />
          <span>{db.vectorDimension}-d vectors</span>
        </div>

        <div className="memory-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'memories'}
            className={cx(tab === 'memories' && 'is-active')}
            onClick={() => setTab('memories')}
          >
            Memories <span>{memories.length}</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === 'tasks'}
            className={cx(tab === 'tasks' && 'is-active')}
            onClick={() => setTab('tasks')}
          >
            Open loops <span>{openTasks.length}</span>
          </button>
        </div>

        {tab === 'memories' ? (
          <>
            <div className="memory-search">
              <Search size={15} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Semantic search your memory…"
                spellCheck={false}
                aria-label="Search memories by meaning"
              />
              {searching && <Loader2 size={14} className="spin" />}
              {query && !searching && (
                <button
                  className="search-clear"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                >
                  <X size={13} />
                </button>
              )}
            </div>

            <div className="filter-row">
              {FILTERS.map((item) => (
                <button
                  key={item.key}
                  className={cx('filter-chip', filter === item.key && 'is-active')}
                  onClick={() => setFilter(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {adding && (
              <div className="inline-form memory-form">
                <div className="inline-form-head">
                  <span>Store a memory</span>
                  <select
                    value={draftKind}
                    onChange={(event) => setDraftKind(event.target.value as MemoryKind)}
                    aria-label="Memory kind"
                  >
                    {MEMORY_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {KIND_META[kind].label}
                      </option>
                    ))}
                  </select>
                </div>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="e.g. Arjun prefers window seats on long flights."
                  rows={3}
                  autoFocus
                />
                <div className="inline-form-actions">
                  <button className="text-button" onClick={() => setAdding(false)}>
                    Cancel
                  </button>
                  <button
                    className="primary-small"
                    onClick={submitMemory}
                    disabled={!draft.trim() || saving}
                  >
                    {saving ? <Loader2 size={13} className="spin" /> : <Plus size={13} />}
                    Save memory
                  </button>
                </div>
              </div>
            )}

            <div className="memory-list">
              {visible.length === 0 && (
                <div className="panel-empty">
                  <Sparkles size={18} />
                  <p>
                    {query.trim()
                      ? 'No memories match that meaning yet.'
                      : 'No memories in this category yet.'}
                  </p>
                  {!query.trim() && <span>They’ll appear here as you talk.</span>}
                </div>
              )}
              {visible.map((memory) => (
                <article key={memory.id} className="memory-card">
                  <div className="memory-card-top">
                    <span className={cx('kind-badge', `kind-${memory.kind}`)}>
                      {KIND_META[memory.kind].label}
                    </span>
                    {typeof memory.similarity === 'number' && (
                      <span className="match-score">
                        {Math.round(memory.similarity * 100)}% match
                      </span>
                    )}
                    <button
                      className="memory-archive"
                      onClick={() => onArchiveMemory(memory.id)}
                      title="Archive memory"
                      aria-label="Archive memory"
                    >
                      <Archive size={13} />
                    </button>
                  </div>
                  <p className="memory-content">{memory.content}</p>
                  <div className="memory-meta">
                    <span>
                      recalled {memory.recallCount}
                      {memory.recallCount === 1 ? '×' : '×'}
                    </span>
                    <span>·</span>
                    <span>{relativeTime(memory.createdAt)}</span>
                    {typeof memory.similarity === 'number' && (
                      <>
                        <span className="similarity-bar">
                          <span style={{ width: `${Math.max(4, memory.similarity * 100)}%` }} />
                        </span>
                      </>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="tasks-pane">
            <div className="task-add-row">
              <button
                className="add-task-button"
                onClick={() => setAddingTask((value) => !value)}
              >
                <Plus size={15} />
                Add an open loop
              </button>
            </div>

            {addingTask && (
              <div className="inline-form task-form">
                <input
                  value={taskDraft}
                  onChange={(event) => setTaskDraft(event.target.value)}
                  placeholder="What needs doing?"
                  autoFocus
                />
                <div className="inline-form-actions">
                  <input
                    type="date"
                    value={taskDue}
                    onChange={(event) => setTaskDue(event.target.value)}
                    aria-label="Due date"
                  />
                  <button className="text-button" onClick={() => setAddingTask(false)}>
                    Cancel
                  </button>
                  <button
                    className="primary-small"
                    onClick={submitTask}
                    disabled={!taskDraft.trim() || savingTask}
                  >
                    {savingTask ? <Loader2 size={13} className="spin" /> : <Plus size={13} />}
                    Add
                  </button>
                </div>
              </div>
            )}

            <div className="task-list">
              {openTasks.length === 0 && (
                <div className="panel-empty">
                  <Check size={18} />
                  <p>No open loops. Nicely done.</p>
                </div>
              )}
              {openTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  busy={busyTask === task.id}
                  onToggle={() => toggleTask(task)}
                />
              ))}
            </div>

            {doneTasks.length > 0 && (
              <>
                <div className="done-label">
                  <ChevronDown size={13} />
                  Recently done
                </div>
                <div className="task-list done-list">
                  {doneTasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      busy={busyTask === task.id}
                      onToggle={() => toggleTask(task)}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <div className="memory-footer">
          <div className="memory-footer-db">
            <span className={cx('status-dot', !db.connected && 'is-offline')} />
            <Database size={12} />
            <span>{db.version}</span>
            <span className="footer-sep">/</span>
            <span>{db.latencyMs}ms</span>
          </div>
          <button className="footer-how" onClick={onHowItWorks}>
            <HelpCircle size={12} />
            How it works
          </button>
        </div>
      </aside>
    </>
  );
}

function TaskRow({
  task,
  busy,
  onToggle,
}: {
  task: Task;
  busy: boolean;
  onToggle: () => void;
}) {
  const due = formatDue(task.dueAt);
  const done = task.status === 'done';

  return (
    <div className={cx('task-row', done && 'is-done')}>
      <button
        className={cx('task-check', done && 'is-checked')}
        onClick={onToggle}
        disabled={busy}
        aria-label={done ? 'Mark task open' : 'Mark task done'}
      >
        {busy ? (
          <Loader2 size={12} className="spin" />
        ) : done ? (
          <Check size={12} />
        ) : (
          <Circle size={11} />
        )}
      </button>
      <div className="task-copy">
        <span className="task-title">{task.title}</span>
        <span className={cx('task-meta', !done && `due-${due.tone}`)}>
          {task.dueAt && <CalendarDays size={11} />}
          {done ? 'Done' : due.label}
          {task.notes && <span className="task-note">· {task.notes}</span>}
        </span>
      </div>
    </div>
  );
}
