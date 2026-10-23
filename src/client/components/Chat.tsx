import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowUp,
  Brain,
  Check,
  ChevronDown,
  Clock3,
  Database,
  HelpCircle,
  Loader2,
  Menu,
  Search,
  Sparkles,
  WandSparkles,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  DbStatus,
  Memory,
  MemoryStats,
  Message,
  RetrievalTrace,
  Session,
  ToolEvent,
  TurnTrace,
  User,
} from '../../shared/types';
import type { PendingTurn } from '../types';
import { LociAvatar } from './Brand';
import { cx, KIND_META, relativeTime } from '../utils';

const SUGGESTIONS = [
  {
    tag: 'Training',
    text: 'Plan my week around half-marathon training.',
    note: 'uses goal + health + tasks',
  },
  {
    tag: 'Kitchen',
    text: 'High-protein dinner for tonight, no mushrooms.',
    note: 'uses diet preferences',
  },
  {
    tag: 'People',
    text: 'What do you remember about Maya?',
    note: 'uses vector recall',
  },
  {
    tag: 'New memory',
    text: 'I’m visiting Austin next month. What should I plan?',
    note: 'writes new context',
  },
];

interface ChatViewProps {
  user: User;
  activeSession: Session | null;
  messages: Message[];
  pending: PendingTurn | null;
  loadingSession: boolean;
  stats: MemoryStats;
  memoryCount: number;
  db: DbStatus;
  onSend: (text: string) => void;
  onOpenSidebar: () => void;
  onOpenMemory: () => void;
  onHowItWorks: () => void;
}

export function ChatView({
  user,
  activeSession,
  messages,
  pending,
  loadingSession,
  stats,
  memoryCount,
  db,
  onSend,
  onOpenSidebar,
  onOpenMemory,
  onHowItWorks,
}: ChatViewProps) {
  const threadRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const target = endRef.current;
    if (!target) return;
    const behavior = messages.length > 2 ? 'smooth' : 'auto';
    target.scrollIntoView({ behavior, block: 'end' });
  }, [messages.length, pending?.reply.length, pending?.stage, pending?.tools.length]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [draft]);

  const send = (value?: string) => {
    const text = (value ?? draft).trim();
    if (!text || pending) return;
    onSend(text);
    setDraft('');
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  const empty = !activeSession && messages.length === 0 && !pending;

  return (
    <main className="chat-column">
      <header className="chat-header">
        <div className="chat-header-left">
          <button
            className="icon-button menu-button"
            onClick={onOpenSidebar}
            aria-label="Open sessions"
          >
            <Menu size={19} />
          </button>
          <div>
            <div className="chat-title-row">
              <h1>{activeSession?.title ?? 'New session'}</h1>
              {activeSession && (
                <span className="live-pill">
                  <span className="status-dot" />
                  memory on
                </span>
              )}
            </div>
            <div className="chat-subtitle">
              {activeSession
                ? `${messages.length} messages · updated ${relativeTime(activeSession.updatedAt)}`
                : `${memoryCount} memories ready for recall`}
            </div>
          </div>
        </div>
        <div className="chat-header-actions">
          <button className="header-button ghost" onClick={onHowItWorks}>
            <HelpCircle size={15} />
            <span className="header-button-label">How it works</span>
          </button>
          <button className="header-button memory-toggle" onClick={onOpenMemory}>
            <Brain size={15} />
            <span className="header-button-label">Memory</span>
            <span className="header-count">{stats.totalMemories}</span>
          </button>
        </div>
      </header>

      <div className="thread" ref={threadRef}>
        {loadingSession ? (
          <div className="thread-loading">
            <LociAvatar size={38} />
            <span>Opening the memory palace…</span>
          </div>
        ) : empty ? (
          <Welcome
            user={user}
            stats={stats}
            memoryCount={memoryCount}
            onSuggestion={send}
          />
        ) : (
          <div className="thread-inner">
            {messages.map((message) => (
              <MessageRow key={message.id} message={message} user={user} />
            ))}
            {pending && <PendingRow pending={pending} user={user} />}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <div className="composer-wrap">
        {!empty && (
          <div className="composer-suggestions">
            {SUGGESTIONS.slice(0, 2).map((suggestion) => (
              <button
                key={suggestion.tag}
                className="mini-suggestion"
                onClick={() => !pending && send(suggestion.text)}
                disabled={Boolean(pending)}
              >
                <Sparkles size={11} />
                {suggestion.tag}
              </button>
            ))}
            <span className="composer-db">
              <Database size={11} />
              {db.connected ? 'CockroachDB connected' : 'Database offline'}
            </span>
          </div>
        )}
        <div className={cx('composer', pending && 'is-busy')}>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              pending ? 'Loci is thinking…' : 'Ask anything. Loci remembers what matters.'
            }
            rows={1}
            disabled={Boolean(pending) || loadingSession}
            aria-label="Message Loci"
          />
          <div className="composer-bottom">
            <span className="composer-hint">
              <span className="hint-spark">
                <Sparkles size={11} />
              </span>
              {memoryCount} memories in reach
              <span className="hint-dot">·</span>
              <span className="hint-mono">⌘↵ or ↵ to send</span>
            </span>
            <button
              className="send-button"
              onClick={() => send()}
              disabled={!draft.trim() || Boolean(pending) || loadingSession}
              aria-label="Send message"
            >
              {pending ? <Loader2 size={16} className="spin" /> : <ArrowUp size={17} />}
            </button>
          </div>
        </div>
        <div className="composer-disclaimer">
          Memory is stored in CockroachDB and survives restarts. Demo data is fictional.
        </div>
      </div>
    </main>
  );
}

function Welcome({
  user,
  stats,
  memoryCount,
  onSuggestion,
}: {
  user: User;
  stats: MemoryStats;
  memoryCount: number;
  onSuggestion: (text: string) => void;
}) {
  return (
    <div className="welcome">
      <div className="welcome-orbit" aria-hidden="true">
        <span className="orbit orbit-one" />
        <span className="orbit orbit-two" />
        <span className="orbit-dot dot-a" />
        <span className="orbit-dot dot-b" />
        <span className="orbit-dot dot-c" />
        <span className="orbit-core">
          <Sparkles size={18} />
        </span>
      </div>

      <div className="welcome-eyebrow">
        <span className="eyebrow-line" />
        A memory-native assistant
      </div>
      <h2 className="welcome-title">
        The agent that
        <br />
        <em>remembers you.</em>
      </h2>
      <p className="welcome-lede">
        Preferences, people, plans, loose ends — Loci keeps them in CockroachDB and recalls
        them with vector search, across every session.
      </p>

      <div className="welcome-stats">
        <span>
          <strong>{memoryCount}</strong> memories
        </span>
        <span className="welcome-stat-divider" />
        <span>
          <strong>{stats.openTasks}</strong> open loops
        </span>
        <span className="welcome-stat-divider" />
        <span>
          <strong>{stats.totalSessions}</strong> past sessions
        </span>
      </div>

      <div className="suggestion-grid">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion.tag}
            className="suggestion-card"
            onClick={() => onSuggestion(suggestion.text)}
          >
            <span className="suggestion-top">
              <span>{suggestion.tag}</span>
              <span className="suggestion-arrow">↗</span>
            </span>
            <span className="suggestion-text">{suggestion.text}</span>
            <span className="suggestion-note">{suggestion.note}</span>
          </button>
        ))}
      </div>

      <div className="welcome-foot">
        <span className="welcome-avatar">
          {user.displayName
            .split(' ')
            .map((part) => part[0])
            .join('')
            .slice(0, 2)}
        </span>
        <span>
          This demo starts with 12 seeded memories and 3 past sessions. Try a new session —
          context carries over.
        </span>
      </div>
    </div>
  );
}

function MessageRow({ message, user }: { message: Message; user: User }) {
  if (message.role === 'user') {
    return (
      <div className="message-row user-row">
        <div className="user-bubble">{message.content}</div>
        <div className="message-time">{relativeTime(message.createdAt)}</div>
      </div>
    );
  }

  return (
    <div className="message-row assistant-row">
      <div className="assistant-mark">
        <LociAvatar size={28} />
      </div>
      <div className="assistant-body">
        <div className="assistant-name">
          Loci <span>to {user.displayName.split(' ')[0]}</span>
        </div>
        <Markdown content={message.content} />
        {message.trace && <MemoryTrace trace={message.trace} />}
      </div>
    </div>
  );
}

function PendingRow({ pending, user }: { pending: PendingTurn; user: User }) {
  const typed = useTypewriter(pending.reply);
  return (
    <>
      <div className="message-row user-row is-pending">
        <div className="user-bubble">{pending.user.content}</div>
      </div>
      <div className="message-row assistant-row">
        <div className="assistant-mark">
          <LociAvatar size={28} />
        </div>
        <div className="assistant-body">
          <div className="assistant-name">
            Loci <span>to {user.displayName.split(' ')[0]}</span>
          </div>

          {pending.retrieval && (
            <div className="pending-recall">
              <Search size={12} />
              Recalled {pending.retrieval.memories.length} memories
              <span className="mono">{Math.round(pending.retrieval.latencyMs)}ms</span>
            </div>
          )}

          {pending.tools.map((tool) => (
            <div key={tool.id} className={cx('tool-line', tool.status)}>
              {tool.status === 'done' ? (
                <Check size={12} />
              ) : tool.status === 'error' ? (
                <AlertCircle size={12} />
              ) : (
                <Loader2 size={12} className="spin" />
              )}
              <span>{tool.label}</span>
              {tool.result && <span className="tool-result">{tool.result}</span>}
            </div>
          ))}

          {typed ? (
            <div className="pending-reply">
              <Markdown content={typed} />
              <span className="caret" />
            </div>
          ) : (
            <div className="thinking-line">
              <span className="thinking-dots">
                <span />
                <span />
                <span />
              </span>
              <span>{pending.stage}</span>
            </div>
          )}

          {pending.reply && !pending.reply.includes(' ') && (
            <div className="pending-stage">{pending.stage}</div>
          )}

          {pending.error && (
            <div className="inline-error">
              <AlertCircle size={14} />
              {pending.error}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function useTypewriter(text: string): string {
  const [shown, setShown] = useState('');
  const [previous, setPrevious] = useState('');

  useEffect(() => {
    if (!text) {
      setShown('');
      return;
    }
    if (text === previous) return;
    setPrevious(text);
    let index = 0;
    setShown('');
    const timer = setInterval(() => {
      index += 4;
      setShown(text.slice(0, index));
      if (index >= text.length) clearInterval(timer);
    }, 14);
    return () => clearInterval(timer);
  }, [text, previous]);

  return shown;
}

function Markdown({ content }: { content: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
          code: ({ className, children }) => {
            const block = Boolean(className);
            if (block) return <code className={className}>{children}</code>;
            return <code className="inline-code">{children}</code>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function MemoryTrace({ trace }: { trace: TurnTrace }) {
  const [open, setOpen] = useState(false);
  const written = trace.memoriesWritten.length;
  const tasks = trace.tasksChanged.length;

  return (
    <div className="trace">
      <div className="trace-summary">
        <button className="trace-toggle" onClick={() => setOpen((value) => !value)}>
          <span className="trace-icon">
            <WandSparkles size={12} />
          </span>
          <span>
            Recalled <strong>{trace.retrieval.memories.length}</strong> memories
          </span>
          <span className="trace-time">
            <Clock3 size={10} />
            {Math.round(trace.timings.retrievalMs)}ms vector search
          </span>
          <ChevronDown size={13} className={cx('trace-chevron', open && 'is-open')} />
        </button>
        <div className="trace-badges">
          {written > 0 && (
            <span className="trace-badge written">
              <Sparkles size={10} />+{written} remembered
            </span>
          )}
          {tasks > 0 && (
            <span className="trace-badge task">
              <Check size={10} />+{tasks} task{tasks > 1 ? 's' : ''}
            </span>
          )}
          {trace.memoriesDeduped > 0 && (
            <span className="trace-badge muted">{trace.memoriesDeduped} deduped</span>
          )}
        </div>
      </div>

      {open && (
        <div className="trace-detail">
          <div className="trace-section-label">
            <Search size={11} /> Vector recall
          </div>
          {trace.retrieval.memories.length === 0 ? (
            <div className="trace-empty">No relevant memories found for this turn.</div>
          ) : (
            <div className="recall-list">
              {trace.retrieval.memories.map((memory) => (
                <div key={memory.id} className="recall-item">
                  <span className={cx('kind-dot', `kind-${memory.kind}`)} />
                  <div className="recall-copy">
                    <span className="recall-text">{memory.content}</span>
                    <span className="recall-meta">
                      {KIND_META[memory.kind].label}
                      <span>·</span>
                      {Math.round(memory.similarity * 100)}% cosine match
                      <span>·</span>
                      {relativeTime(memory.createdAt)}
                    </span>
                  </div>
                  <span className="recall-bar">
                    <span style={{ width: `${Math.max(4, memory.similarity * 100)}%` }} />
                  </span>
                </div>
              ))}
            </div>
          )}

          {trace.toolCalls.length > 0 && (
            <>
              <div className="trace-section-label">
                <Brain size={11} /> Agent actions
              </div>
              <div className="action-list">
                {trace.toolCalls.map((tool) => (
                  <div key={`${tool.id}-${tool.status}`} className="action-row">
                    {tool.status === 'error' ? (
                      <AlertCircle size={11} />
                    ) : (
                      <Check size={11} />
                    )}
                    <span>{tool.label}</span>
                    {tool.result && <span className="action-result">{tool.result}</span>}
                  </div>
                ))}
              </div>
            </>
          )}

          {trace.memoriesWritten.length > 0 && (
            <>
              <div className="trace-section-label">
                <Sparkles size={11} /> New memories persisted
              </div>
              <div className="written-list">
                {trace.memoriesWritten.map((memory) => (
                  <div key={memory.id} className="written-item">
                    <span className={cx('kind-badge', `kind-${memory.kind}`)}>
                      {KIND_META[memory.kind].label}
                    </span>
                    <span>{memory.content}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {trace.tasksChanged.length > 0 && (
            <>
              <div className="trace-section-label">
                <Check size={11} /> Task state
              </div>
              <div className="action-list">
                {trace.tasksChanged.map((task) => (
                  <div key={`${task.id}-${task.status}`} className="action-row">
                    <Check size={11} />
                    <span>{task.title}</span>
                    <span className="action-result">{task.status}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="trace-footer">
            <span>retrieval {trace.timings.retrievalMs}ms</span>
            <span>answer {trace.timings.answerMs}ms</span>
            <span>memory writer {trace.timings.consolidationMs}ms</span>
            <span className="trace-footer-db">CockroachDB</span>
          </div>
        </div>
      )}
    </div>
  );
}
