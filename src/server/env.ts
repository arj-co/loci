import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z
    .string()
    .default('postgresql://root@localhost:26257/loci?sslmode=disable'),
  DEMO_USER_HANDLE: z.string().default('arjun'),

  LLM_BASE_URL: z.string().default('http://localhost:11434/v1'),
  LLM_API_KEY: z.string().default('ollama'),
  LLM_MODEL: z.string().default('qwen2.5:3b'),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.4),

  EMBEDDING_BASE_URL: z.string().default('http://localhost:11434/v1'),
  EMBEDDING_API_KEY: z.string().default('ollama'),
  EMBEDDING_MODEL: z.string().default('nomic-embed-text'),
  EMBEDDING_DIM: z.coerce.number().int().positive().default(768),
  // 'openai' = any OpenAI-compatible /v1/embeddings endpoint; 'hash' = offline.
  EMBEDDING_PROVIDER: z.enum(['openai', 'hash']).default('openai'),

  MEMORY_TOP_K: z.coerce.number().int().min(1).max(50).default(8),
  MEMORY_CANDIDATES: z.coerce.number().int().min(1).max(200).default(24),
  MEMORY_DEDUPE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.88),
  AGENT_MAX_STEPS: z.coerce.number().int().min(1).max(10).default(4),
});

export const env = schema.parse(process.env);

if (env.EMBEDDING_DIM !== 768) {
  console.warn(
    `[loci] EMBEDDING_DIM is ${env.EMBEDDING_DIM}, but the schema uses VECTOR(768). ` +
      'Reset the database after changing dimensions.',
  );
}
