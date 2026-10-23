-- Loci — persistent memory schema for CockroachDB
-- Vector dimension is fixed at 768 (nomic-embed-text / text-embedding-3-small).

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handle STRING UNIQUE NOT NULL,
  display_name STRING NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title STRING NOT NULL DEFAULT 'New session',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  INDEX sessions_user_updated_idx (user_id, updated_at DESC)
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role STRING NOT NULL CHECK (role IN ('user', 'assistant')),
  content STRING NOT NULL,
  trace JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  INDEX messages_session_created_idx (session_id, created_at)
);

CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind STRING NOT NULL CHECK (
    kind IN ('fact', 'preference', 'person', 'goal', 'project', 'health', 'note')
  ),
  content STRING NOT NULL,
  embedding VECTOR(768) NOT NULL,
  importance FLOAT8 NOT NULL DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),
  source STRING,
  source_session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_recalled_at TIMESTAMPTZ,
  recall_count INT8 NOT NULL DEFAULT 0,
  archived BOOL NOT NULL DEFAULT false,
  INDEX memories_user_created_idx (user_id, created_at DESC)
);

-- The heart of the demo: a distributed vector index on the embedding column.
-- user_id and archived are prefix columns, so the ANN search only scans the
-- current user's live memories. Queries use cosine distance (<=>) + LIMIT.
CREATE VECTOR INDEX IF NOT EXISTS memories_embedding_idx
  ON memories (user_id, archived, embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title STRING NOT NULL,
  notes STRING,
  status STRING NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  due_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  INDEX tasks_user_status_idx (user_id, status, due_at)
);
