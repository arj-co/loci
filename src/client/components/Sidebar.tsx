import {
  ArrowUpRight,
  ChevronRight,
  Database,
  HelpCircle,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import type { DbStatus, Session, User } from '../../shared/types';
import { BrandMark } from './Brand';
import { cx, relativeTime } from '../utils';

interface SidebarProps {
  user: User;
  sessions: Session[];
  activeSessionId: string | null;
  db: DbStatus;
  open: boolean;
  busy?: boolean;
  resetting?: boolean;
  onClose: () => void;
  onNew: () => void;
  onSelect: (sessionId: string) => void;
  onHowItWorks: () => void;
  onReset: () => void;
}

export function Sidebar({
  user,
  sessions,
  activeSessionId,
  db,
  open,
  busy,
  resetting,
  onClose,
  onNew,
  onSelect,
  onHowItWorks,
  onReset,
}: SidebarProps) {
  const initials = user.displayName
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <aside className={cx('sidebar', open && 'is-open')}>
      <div className="sidebar-top">
        <div className="brand">
          <BrandMark size={34} />
          <div>
            <div className="brand-word">Loci</div>
            <div className="brand-tag">Memory agent</div>
          </div>
        </div>
        <button className="icon-button sidebar-close" onClick={onClose} aria-label="Close menu">
          <X size={18} />
        </button>
      </div>

      <div className="user-chip">
        <span className="user-avatar">{initials}</span>
        <span className="user-copy">
          <span className="user-name">{user.displayName}</span>
          <span className="user-sub">Personal memory</span>
        </span>
        <span className="user-live" title="Memory connected" />
      </div>

      <button className="new-session" onClick={onNew} disabled={busy}>
        <Plus size={16} />
        <span>New session</span>
        <span className="new-session-key">N</span>
      </button>

      <div className="sessions-block">
        <div className="section-label">
          <span>Sessions</span>
          <span className="section-count">{sessions.length}</span>
        </div>
        <div className="session-list">
          {sessions.length === 0 && (
            <div className="sidebar-empty">
              No sessions yet.
              <br />
              Ask something to begin.
            </div>
          )}
          {sessions.map((session) => (
            <button
              key={session.id}
              className={cx('session-item', session.id === activeSessionId && 'is-active')}
              onClick={() => onSelect(session.id)}
              disabled={busy}
            >
              <span className="session-title">{session.title}</span>
              <span className="session-meta">
                {relativeTime(session.updatedAt)}
                <ChevronRight size={12} />
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="sidebar-footer">
        <div className="db-card">
          <div className="db-card-head">
            <span className={cx('status-dot', !db.connected && 'is-offline')} />
            <Database size={13} />
            <span>CockroachDB</span>
            <span className="db-version">{db.version.replace(/^v/, 'v')}</span>
          </div>
          <div className="db-card-row">
            <span>vector index</span>
            <span className={db.vectorIndex ? 'db-ok' : 'db-warn'}>
              {db.vectorIndex ? 'live' : 'missing'}
            </span>
          </div>
          <div className="db-card-row">
            <span>{db.vectorDimension}-dim · cosine</span>
            <span>{db.latencyMs}ms</span>
          </div>
        </div>

        <button className="sidebar-action" onClick={onHowItWorks}>
          <HelpCircle size={15} />
          <span>How Loci remembers</span>
          <ArrowUpRight size={13} />
        </button>
        <button
          className="sidebar-action subtle"
          onClick={onReset}
          disabled={resetting}
        >
          {resetting ? <RefreshCw size={14} className="spin" /> : <Trash2 size={14} />}
          <span>{resetting ? 'Reseeding demo…' : 'Reset demo data'}</span>
        </button>
        <div className="sidebar-signature">
          <span>Built on CockroachDB</span>
          <span className="sig-line" />
          <span>MIT</span>
        </div>
      </div>
    </aside>
  );
}
