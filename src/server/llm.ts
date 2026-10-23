import OpenAI from 'openai';
import { env } from './env';

export const chatClient = new OpenAI({
  apiKey: env.LLM_API_KEY,
  baseURL: env.LLM_BASE_URL,
  timeout: 120_000,
  maxRetries: 2,
});

export type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type ChatTool = OpenAI.Chat.Completions.ChatCompletionTool;

export interface ChatOptions {
  messages: ChatMessage[];
  tools?: ChatTool[];
  temperature?: number;
  json?: boolean;
}

export async function chatCompletion(options: ChatOptions) {
  const base = {
    model: env.LLM_MODEL,
    messages: options.messages,
    temperature: options.temperature ?? env.LLM_TEMPERATURE,
  };

  if (options.tools?.length) {
    return chatClient.chat.completions.create({
      ...base,
      tools: options.tools,
      tool_choice: 'auto',
    });
  }

  if (options.json) {
    try {
      return await chatClient.chat.completions.create({
        ...base,
        response_format: { type: 'json_object' },
      });
    } catch {
      // Some OpenAI-compatible servers (notably older Ollama builds) reject
      // response_format. Fall back to prompt-only JSON.
      return chatClient.chat.completions.create(base);
    }
  }

  return chatClient.chat.completions.create(base);
}

/** Extract the first JSON object from a model response, tolerating fences/preamble. */
export function extractJson<T = unknown>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i += 1) {
    const char = candidate[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export async function chatJson<T>(options: Omit<ChatOptions, 'json'>): Promise<T | null> {
  const response = await chatCompletion({ ...options, json: true });
  const content = response.choices[0]?.message?.content ?? '';
  return extractJson<T>(content);
}

export function describeModel(): { provider: string; model: string; baseUrl: string } {
  let provider = 'OpenAI-compatible';
  try {
    const host = new URL(env.LLM_BASE_URL).hostname;
    if (host === 'localhost' || host === '127.0.0.1') provider = 'Ollama';
    else if (host.includes('openrouter')) provider = 'OpenRouter';
    else if (host.includes('openai.com')) provider = 'OpenAI';
    else provider = host;
  } catch {
    // Keep the generic label.
  }
  return { provider, model: env.LLM_MODEL, baseUrl: env.LLM_BASE_URL };
}
