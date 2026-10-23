import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Brain,
  Check,
  Copy,
  Database,
  GitBranch,
  Layers,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { BrandMark } from './Brand';

const SQL = `-- One index, scoped to each user's live memories
CREATE VECTOR INDEX memories_embedding_idx
  ON memories (user_id, archived, embedding vector_cosine_ops);

-- Cosine ANN recall, then rerank by similarity + importance + recency
SELECT id, kind, content,
       1 - (embedding <=> $1::vector) AS similarity
  FROM memories
 WHERE user_id = $2 AND archived = false
 ORDER BY embedding <=> $1::vector
 LIMIT 24;`;

interface HowItWorksProps {
  open: boolean;
  onClose: () => void;
}

export function HowItWorks({ open, onClose }: HowItWorksProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(SQL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be denied; the SQL is still visible.
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal how-modal"
        role="dialog"
        aria-modal="true"
        aria-label="How Loci remembers"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="modal-close icon-button" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>

        <div className="how-eyebrow">
          <BrandMark size={22} />
          <span>Under the hood</span>
        </div>
        <h2 className="how-title">
          A memory palace,
          <br />
          with a SQL engine.
        </h2>
        <p className="how-lede">
          Loci treats memory as infrastructure, not prompt stuffing. Every turn runs a
          retrieve → answer → consolidate loop against CockroachDB.
        </p>

        <div className="how-steps">
          <div className="how-step">
            <span className="how-step-number">01</span>
            <Sparkles size={16} />
            <h3>Recall</h3>
            <p>
              The user message is embedded, then CockroachDB's distributed vector index
              returns the nearest memories with cosine distance.
            </p>
          </div>
          <div className="how-step">
            <span className="how-step-number">02</span>
            <Brain size={16} />
            <h3>Reason</h3>
            <p>
              Top memories, open tasks, and the last few turns are assembled into context.
              The agent can search, write, or complete tasks with tools.
            </p>
          </div>
          <div className="how-step">
            <span className="how-step-number">03</span>
            <Layers size={16} />
            <h3>Consolidate</h3>
            <p>
              In parallel, a memory writer extracts durable facts from the user's message.
              Near-duplicates are rejected with a similarity check.
            </p>
          </div>
          <div className="how-step">
            <span className="how-step-number">04</span>
            <Database size={16} />
            <h3>Persist</h3>
            <p>
              Messages, memories, and tasks land in CockroachDB in one durable store. Reload,
              restart, or open a new session — it all comes back.
            </p>
          </div>
        </div>

        <div className="how-split">
          <div className="how-code-card">
            <div className="how-code-head">
              <span>db/schema.sql · recall</span>
              <button className="copy-button" onClick={copy}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre>
              <code>{SQL}</code>
            </pre>
          </div>

          <div className="how-notes">
            <h3>
              <Database size={15} /> Why CockroachDB
            </h3>
            <ul>
              <li>
                <ShieldCheck size={14} />
                <span>
                  <strong>One durable store.</strong> Chat history, semantic memory, and task
                  state survive process restarts and scale together.
                </span>
              </li>
              <li>
                <GitBranch size={14} />
                <span>
                  <strong>Prefixed vector index.</strong> ANN search is scoped to the current
                  user's non-archived memories before the top-k scan.
                </span>
              </li>
              <li>
                <ArrowRight size={14} />
                <span>
                  <strong>Cloud-ready.</strong> The same schema works locally and on
                  CockroachDB Cloud; point DATABASE_URL at a cluster.
                </span>
              </li>
            </ul>
          </div>
        </div>

        <div className="how-footer">
          <span>Vector index · 768 dimensions · cosine distance</span>
          <span className="how-footer-divider" />
          <span>Memory types: fact, preference, person, goal, project, health, note</span>
        </div>
      </div>
    </div>
  );
}
