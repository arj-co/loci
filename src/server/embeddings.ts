import OpenAI from 'openai';
import { env } from './env';

const embeddingClient = new OpenAI({
  apiKey: env.EMBEDDING_API_KEY,
  baseURL: env.EMBEDDING_BASE_URL,
  timeout: 60_000,
  maxRetries: 2,
});

function normalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) return vector;
  return vector.map((value) => value / magnitude);
}

/**
 * Deterministic offline embeddings. This is not semantic like a transformer,
 * but it keeps the full DB + retrieval flow runnable without a model server.
 */
export function hashEmbedding(text: string, dims = env.EMBEDDING_DIM): number[] {
  const vector = new Array<number>(dims).fill(0);
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const add = (token: string, weight: number) => {
    let hash = 2166136261;
    for (let i = 0; i < token.length; i += 1) {
      hash ^= token.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const index = Math.abs(hash) % dims;
    vector[index] += weight;
  };

  for (const word of words) {
    add(word, 1);
    for (let i = 0; i < word.length - 2; i += 1) add(`~${word.slice(i, i + 3)}`, 0.25);
  }
  for (let i = 0; i < words.length - 1; i += 1) add(`${words[i]}_${words[i + 1]}`, 0.6);

  return normalize(vector);
}

async function requestEmbeddings(texts: string[]): Promise<number[][]> {
  const params: OpenAI.Embeddings.EmbeddingCreateParams = {
    model: env.EMBEDDING_MODEL,
    input: texts,
  };

  // OpenAI's v3 embedding models support native dimension reduction.
  if (env.EMBEDDING_MODEL.includes('text-embedding-3')) {
    params.dimensions = env.EMBEDDING_DIM;
  }

  const response = await embeddingClient.embeddings.create(params);
  return response.data
    .sort((a, b) => a.index - b.index)
    .map((item) => normalize(item.embedding));
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (env.EMBEDDING_PROVIDER === 'hash') {
    return texts.map((text) => hashEmbedding(text));
  }

  const batches: string[][] = [];
  for (let i = 0; i < texts.length; i += 64) batches.push(texts.slice(i, i + 64));

  const vectors: number[][] = [];
  for (const batch of batches) {
    const result = await requestEmbeddings(batch);
    vectors.push(...result);
  }

  for (const vector of vectors) {
    if (vector.length !== env.EMBEDDING_DIM) {
      throw new Error(
        `Embedding model returned ${vector.length} dimensions, expected ${env.EMBEDDING_DIM}. ` +
          'Set EMBEDDING_DIM to match your model, then reset the database.',
      );
    }
  }
  return vectors;
}

export async function embedText(text: string): Promise<number[]> {
  const [vector] = await embedTexts([text]);
  if (!vector) throw new Error('Embedding provider returned no vector.');
  return vector;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) dot += a[i] * b[i];
  return dot;
}
