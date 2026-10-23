import { z } from 'zod';
import type {
  ChatEvent,
  Memory,
  MemoryKind,
  Message,
  RecalledMemory,
  RetrievalTrace,
  Session,
  Task,
  ToolEvent,
  TurnTrace,
  User,
} from '../shared/types';
import { MEMORY_KINDS } from '../shared/types';
import { env } from './env';
import { chatCompletion, chatJson, type ChatMessage, type ChatTool } from './llm';
import { retrieveMemories, saveMemory, saveMemories } from './memory';
import {
  completeTask,
  createTask,
  findOpenTaskByTitle,
  listTasks,
  tasksAsContext,
} from './tasks';
import { addMessage } from './sessions';

const tools: ChatTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_memory',
      description:
        'Search the user’s long-term memories with CockroachDB vector search. Use only when an older detail is missing from the retrieved context.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'A focused semantic search query.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_memory',
      description:
        'Store a durable fact, preference, person, goal, project, health detail, or note about the user. Most memories are captured automatically, so use this only when the user explicitly asks you to remember something.',
      parameters: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'A concise third-person statement, e.g. “Arjun is vegetarian.”',
          },
          kind: { type: 'string', enum: [...MEMORY_KINDS] },
          importance: {
            type: 'number',
            description: '0 to 1; higher means more important to remember.',
          },
        },
        required: ['content', 'kind'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_task',
      description:
        'Create a persistent action item for the user. Use when the user asks to track, plan, add, or remember a concrete todo.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short, specific action item.' },
          notes: { type: 'string', description: 'Only details that belong to this task.' },
          due_at: {
            type: 'string',
            description:
              'Due date in YYYY-MM-DD format. Resolve “tomorrow”, “Friday”, etc. to a real date.',
          },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_tasks',
      description:
        'List the user’s persistent tasks. Use when the user asks what is open, or before completing a task.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['open', 'done', 'all'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_task',
      description: 'Mark an existing task done by its id.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'The task UUID from the context.' },
        },
        required: ['task_id'],
      },
    },
  },
];

interface ToolOutcome {
  result: unknown;
  memory?: Memory;
  memoryDeduped?: boolean;
  task?: Task;
  taskExisting?: boolean;
}

function localDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localDate(date);
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Best-effort natural-language due date resolver, used when the model omits a date. */
export function inferDueDate(text: string): string | null {
  const value = text.toLowerCase();
  const iso = value.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  if (/\btoday\b/.test(value)) return addDays(0);
  if (/\btomorrow\b/.test(value)) return addDays(1);
  if (/\bnext week\b/.test(value)) return addDays(7);
  if (/\bthis weekend\b/.test(value)) {
    const day = new Date().getDay();
    return addDays(day === 6 || day === 0 ? 0 : 6 - day);
  }
  const weekday = WEEKDAYS.find((name) => new RegExp(`\\b${name}\\b`).test(value));
  if (weekday) {
    const today = new Date().getDay();
    const target = WEEKDAYS.indexOf(weekday);
    let offset = (target - today + 7) % 7;
    if (offset === 0) offset = 7;
    return addDays(offset);
  }
  const inDays = value.match(/\bin (\d{1,2}) days?\b/);
  if (inDays) return addDays(Number(inDays[1]));
  return null;
}

function formatMemory(memory: RecalledMemory | Memory): string {
  const similarity =
    'similarity' in memory && typeof memory.similarity === 'number'
      ? `, ${(memory.similarity * 100).toFixed(0)}% match`
      : '';
  return `- [${memory.id}] (${memory.kind}, importance ${memory.importance.toFixed(2)}${similarity}) ${memory.content}`;
}

function formatTask(task: Task): string {
  const due = task.dueAt ? ` — due ${task.dueAt}` : '';
  return `- [${task.id}] ${task.title} (${task.status}${due})`;
}

function systemPrompt(user: User, retrieval: RetrievalTrace, today: string): string {
  const memories = retrieval.memories.length
    ? retrieval.memories.map(formatMemory).join('\n')
    : '(no relevant memories found)';
  const tasks = retrieval.tasks.length
    ? retrieval.tasks.map(formatTask).join('\n')
    : '(no open tasks)';

  return `You are Loci, ${user.displayName}'s warm, sharp personal assistant with persistent memory. Today is ${today}.

Your memory lives in CockroachDB. The memories below were just retrieved with vector search for this turn. Treat them as things you genuinely remember about the user.

RETRIEVED MEMORIES:
${memories}

OPEN TASKS:
${tasks}

HOW TO RESPOND:
- Speak directly TO ${user.displayName} using “you”. The memories are stored in the third person, but your reply must translate them into the second person.
  - Memory: “Maya is ${user.displayName}'s cofounder.” → Reply: “Maya is your cofounder.”
  - Memory: “${user.displayName} avoids mushrooms.” → Reply: “you avoid mushrooms.”
  - Never write “${user.displayName} is…”, “his”, or “he” when referring to the user in your reply.
- If the user shares a durable fact about themselves or someone they know, reply in this shape: “Noted — <one short second-person restatement>.” Example: “Noted — Nisha is your sister and a pediatrician in Boston.” Never print JSON, tool arguments, UUIDs, or metadata, and never narrate saving a memory.
- Be concise: 1–3 short sentences, or at most 3 short bullets. No preamble, headings, or filler.
- Ground the answer in the retrieved memories when they are relevant (diet, health, schedule, people, goals, preferences). Honor them without listing everything.
- Where it feels natural, explicitly connect the recommendation to 1–2 relevant memories (e.g. “Since you’re vegetarian and avoid mushrooms…”). This shows the memory in action.
- If the user asks what you remember, group the relevant memories clearly and briefly.
- Never include raw UUIDs, task fields, tool names, or database details in your reply. Do not restate a task's title, notes, and due date as a table.
- Finish with one concrete next step when the user is deciding or planning.

MEMORY + TASK RULES:
- Durable facts about the user are saved automatically. If the user explicitly says “remember this”, you may call save_memory, written as a concise third-person sentence.
- If the user asks you to plan, add, or track a concrete action, call create_task. Copy the action from the user's own words; do not add project names, people, or context from memories. Resolve relative dates like “tomorrow” or “this weekend” into real YYYY-MM-DD dates before calling, and always include due_at when the user gives a time reference.
- When creating a task, confirm it in one short sentence, e.g. “Added — email Nisha by Saturday.” Never invent notes, due dates, or details the user did not provide.
- Use complete_task with a task id when the user says something is done.
- Use search_memory only when an older detail is missing from the context above.
- Never invent a memory or claim to remember something not in the context.
- If you are unsure, say so briefly and ask at most one focused question.`;
}

function retrievalQuery(current: string, messages: Message[]): string {
  if (current.trim().length >= 40) return current;
  const previousUser = [...messages]
    .reverse()
    .find((message) => message.role === 'user' && message.content !== current);
  return previousUser ? `${previousUser.content}\n${current}` : current;
}

function normalizeDueDate(value: unknown): string | null {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/** Remove a trailing time phrase once it is captured as a real due date. */
function cleanTaskTitle(title: string): string {
  const cleaned = title
    .replace(
      /\s+(?:(?:on|by|for)\s+)?(?:today|tomorrow|tonight|this weekend|next week|next month|this (?:mon|tues|wednes|thurs|fri|satur|sun)day|(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b[.!]*$/i,
      '',
    )
    .trim();
  return cleaned || title;
}

function shortDueDate(dueAt: string | null): string {
  if (!dueAt) return '';
  const date = new Date(`${dueAt}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { weekday: 'long' });
}

async function executeTool(
  user: User,
  session: Session,
  name: string,
  args: Record<string, unknown>,
  turnText = '',
): Promise<ToolOutcome> {
  switch (name) {
    case 'search_memory': {
      const query = String(args.query ?? '').trim();
      if (!query) return { result: { error: 'A query is required.' } };
      const result = await retrieveMemories(user.id, query, { limit: env.MEMORY_TOP_K });
      return {
        result: result.memories.map((memory) => ({
          id: memory.id,
          kind: memory.kind,
          content: memory.content,
          similarity: memory.similarity,
          createdAt: memory.createdAt,
        })),
      };
    }
    case 'save_memory': {
      const content = toThirdPerson(String(args.content ?? '').trim(), user);
      const kind = String(args.kind ?? 'fact') as MemoryKind;
      if (!content) return { result: { error: 'Content is required.' } };
      if (!MEMORY_KINDS.includes(kind)) return { result: { error: 'Invalid memory kind.' } };
      const saved = await saveMemory({
        userId: user.id,
        kind,
        content,
        importance: Number(args.importance ?? 0.65),
        source: 'agent',
        sourceSessionId: session.id,
      });
      return {
        result: {
          saved: !saved.deduped,
          id: saved.memory.id,
          content: saved.memory.content,
        },
        memory: saved.memory,
        memoryDeduped: saved.deduped,
      };
    }
    case 'create_task': {
      const rawTitle = String(args.title ?? '').trim();
      if (!rawTitle) return { result: { error: 'Title is required.' } };
      const title = cleanTaskTitle(rawTitle);
      const existing = await findOpenTaskByTitle(user.id, title);
      if (existing) {
        return {
          result: { task: existing, alreadyExists: true },
          task: existing,
          taskExisting: true,
        };
      }
      const notes = args.notes ? String(args.notes) : null;
      // Prefer dates inferred from the user's own words over model date math.
      const dueAt =
        inferDueDate(`${turnText}\n${rawTitle}\n${notes ?? ''}`) ??
        normalizeDueDate(args.due_at);
      const task = await createTask({
        userId: user.id,
        title,
        notes,
        dueAt,
      });
      return { result: { task }, task };
    }
    case 'list_tasks': {
      const status = ['open', 'done', 'all'].includes(String(args.status))
        ? (String(args.status) as 'open' | 'done' | 'all')
        : 'all';
      const tasks = await listTasks(user.id, { status });
      return { result: { tasks } };
    }
    case 'complete_task': {
      const taskId = String(args.task_id ?? '');
      const task = await completeTask(user.id, taskId);
      if (!task) return { result: { error: 'Task not found.' } };
      return { result: { task }, task };
    }
    default:
      return { result: { error: `Unknown tool: ${name}` } };
  }
}

const consolidationSchema = z.object({
  memories: z
    .array(
      z.object({
        kind: z.enum(MEMORY_KINDS),
        content: z.string().min(3).max(600),
        importance: z.number().min(0).max(1).default(0.6),
      }),
    )
    .max(3)
    .default([]),
});

type Consolidation = z.infer<typeof consolidationSchema>;

const BARE_PRONOUN = /^(she|he|they|it|his|her|their|him|them)\b/i;

/** Reject memories that only make sense next to the original message. */
function isStandaloneMemory(memory: Consolidation['memories'][number]): boolean {
  const content = memory.content.trim();
  if (BARE_PRONOUN.test(content)) return false;
  if (/\?\s*$/.test(content)) return false;
  return true;
}

const EXPLICIT_REMEMBER =
  /\b(?:please\s+)?remember\s+(?:that|this|these|the following)\b|\bnote\s+that\b|\bmy name is\b|\bcall me\b|\bfor the record\b/i;

const LOOKS_LIKE_QUESTION =
  /^\s*(what|who|when|where|why|how|do|does|did|can|could|would|will|should|is|are|am|have|has|tell me)\b/i;

function shouldConsolidate(message: string): boolean {
  const text = message.trim();
  if (text.length < 12) return false;
  if (/^(hi|hey|hello|thanks|thank you|ok|okay|cool|got it|sounds good|yes|no|sure)[.!\s]*$/i.test(text)) {
    return false;
  }

  const explicit = EXPLICIT_REMEMBER.test(text);
  // A question is not a durable fact. Only let it through when the user
  // explicitly asks us to remember something ("Remember that my flight is…").
  if (!explicit && (/\?\s*$/.test(text) || LOOKS_LIKE_QUESTION.test(text))) {
    return false;
  }
  // Require a first-person statement, an explicit remember directive, or a
  // named-person fact. "She owns the beta launch." is not enough on its own.
  if (!explicit && !/\b(i|i'm|i am|i've|i'd|my|me|mine|we|we're|our)\b/i.test(text)) {
    return false;
  }
  return true;
}

async function consolidateMemories(
  user: User,
  session: Session,
  userMessage: string,
  retrieval: RetrievalTrace,
): Promise<{ memories: Memory[]; deduped: number; ms: number }> {
  if (!shouldConsolidate(userMessage)) return { memories: [], deduped: 0, ms: 0 };
  const started = performance.now();

  const known = retrieval.memories.map((memory) => `- ${memory.content}`).join('\n');
  const prompt = `You are the memory writer for Loci, a persistent-memory assistant.

Read the user's message and extract durable information about ${user.displayName} or the people in their life: stable facts, preferences, relationships, goals, projects, health details, routines, or useful notes that will matter in a future session. Do not store transient requests, small talk, or the assistant's assumptions.

Already-known memories (do not duplicate):
${known || '(none)'}

User message:
${userMessage}

Return strict JSON:
{
  "memories": [
    { "kind": "fact|preference|person|goal|project|health|note", "content": "concise third-person statement", "importance": 0.0-1.0 }
  ]
}

Rules:
- Extract any stable fact the user reveals, even if they do not say “remember”. A message like “My sister Nisha is a pediatrician in Boston” contains a durable memory.
- Never turn a question, a hypothetical, or the assistant's answer into a memory. If the user is only asking, return {"memories":[]}.
- Maximum 3 memories. Return {"memories":[]} if nothing durable was shared.
- Write in the third person about ${user.displayName}.
- Each memory must be standalone and specific. Use names, never a bare pronoun like “she”, “he”, or “they”.
  - Good: “Nisha is ${user.displayName}'s sister and a pediatrician in Boston.”
  - Bad: “She owns the public beta launch.”
- Return JSON only.

Examples:
- “My sister Nisha is a pediatrician in Boston.” → {"memories":[{"kind":"person","content":"Nisha is ${user.displayName}'s sister and a pediatrician in Boston.","importance":0.7}]}
- “I'm vegetarian and I hate mushrooms.” → {"memories":[{"kind":"preference","content":"${user.displayName} is vegetarian and dislikes mushrooms.","importance":0.8}]}
- “What do you remember about Maya?” → {"memories":[]}
- “Can you plan my week?” → {"memories":[]}`;

  try {
    const parsed = await chatJson<Consolidation>({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    });
    if (!parsed) return { memories: [], deduped: 0, ms: Math.round(performance.now() - started) };
    const validation = consolidationSchema.safeParse(parsed);
    if (!validation.success) {
      console.warn(
        '[loci] consolidation shape rejected:',
        validation.error.issues[0]?.message,
      );
      return { memories: [], deduped: 0, ms: Math.round(performance.now() - started) };
    }
    console.log(
      `[loci] consolidation extracted ${validation.data.memories.length} candidate(s)`,
    );

    const saved = await saveMemories(
      validation.data.memories
        .filter(isStandaloneMemory)
        .map((memory) => ({
          userId: user.id,
          kind: memory.kind,
          content: memory.content,
          importance: memory.importance,
          source: 'auto-extraction',
          sourceSessionId: session.id,
        })),
    );

    const memories: Memory[] = [];
    let deduped = 0;
    for (const result of saved) {
      if (result.deduped) deduped += 1;
      else memories.push(result.memory);
    }
    return { memories, deduped, ms: Math.round(performance.now() - started) };
  } catch (error) {
    console.warn(
      '[loci] memory consolidation failed:',
      error instanceof Error ? error.message : error,
    );
    return { memories: [], deduped: 0, ms: Math.round(performance.now() - started) };
  }
}

export interface AgentTurnInput {
  user: User;
  session: Session;
  userMessage: Message;
  priorMessages: Message[];
  signal?: AbortSignal;
}

export async function* runAgentTurn(
  input: AgentTurnInput,
): AsyncGenerator<ChatEvent, void, unknown> {
  const { user, session, userMessage, priorMessages } = input;
  const turnStarted = performance.now();
  const query = retrievalQuery(userMessage.content, priorMessages);

  const [retrievalResult, openTasks] = await Promise.all([
    retrieveMemories(user.id, query),
    tasksAsContext(user.id),
  ]);

  const retrieval: RetrievalTrace = {
    ...retrievalResult,
    tasks: openTasks,
  };
  yield { type: 'retrieval', retrieval };

  if (input.signal?.aborted) return;

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const history: ChatMessage[] = priorMessages.slice(-12).map((message) => ({
    role: message.role,
    content: message.content,
  }));

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(user, retrieval, today) },
    ...history,
  ];

  const toolEvents: ToolEvent[] = [];
  const memoriesWritten: Memory[] = [];
  const tasksChanged: Task[] = [];
  const createdTasks: Task[] = [];
  const completedTasks: Task[] = [];
  let memoriesDeduped = 0;
  let answer = '';

  // Consolidation only needs the user's message, so run it alongside the
  // answer. The user sees their reply immediately while memories persist.
  const consolidationPromise = consolidateMemories(
    user,
    session,
    userMessage.content,
    retrieval,
  );

  yield { type: 'status', label: 'Thinking' };

  for (let step = 0; step < env.AGENT_MAX_STEPS; step += 1) {
    if (input.signal?.aborted) return;

    const response = await chatCompletion({ messages, tools });
    const choice = response.choices[0]?.message;
    if (!choice) break;

    const calls = choice.tool_calls ?? [];
    if (calls.length === 0) {
      answer = choice.content?.trim() ?? '';
      break;
    }

    messages.push(choice as ChatMessage);

    for (const call of calls) {
      if (call.type !== 'function') continue;
      const name = call.function.name;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
      } catch {
        args = {};
      }

      const event: ToolEvent = {
        id: call.id,
        name,
        label: toolLabel(name, args),
        args,
        status: 'running',
      };
      toolEvents.push(event);
      yield { type: 'tool', tool: { ...event } };
      yield { type: 'status', label: event.label };

      let outcome: ToolOutcome;
      try {
        outcome = await executeTool(user, session, name, args, userMessage.content);
        event.status = 'done';
        event.result = summarizeResult(name, outcome);
      } catch (error) {
        event.status = 'error';
        event.result = error instanceof Error ? error.message : 'Tool failed';
        outcome = { result: { error: event.result } };
      }

      if (outcome.memory) {
        if (outcome.memoryDeduped) memoriesDeduped += 1;
        else {
          memoriesWritten.push(outcome.memory);
          yield { type: 'memory_saved', memory: outcome.memory, deduped: false };
        }
      }
      if (outcome.task) {
        tasksChanged.push(outcome.task);
        if (name === 'create_task' && !outcome.taskExisting) createdTasks.push(outcome.task);
        if (name === 'complete_task') completedTasks.push(outcome.task);
        yield { type: 'task_changed', task: outcome.task };
      }

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(outcome.result),
      });
      yield { type: 'tool', tool: { ...event } };
    }
  }

  if (!answer) {
    const final = await chatCompletion({
      messages: [
        ...messages,
        {
          role: 'system',
          content:
            'Give the user your final answer now, in plain text. Address them as “you” in the second person, never in the third person. Do not include UUIDs, and keep it concise.',
        },
      ],
    });
    answer = final.choices[0]?.message?.content?.trim() ?? '';
  }

  if (!answer) {
    answer =
      'I saved that for you. Ask me to pull it back up whenever you need it — it persists across sessions.';
  }

  const taskReply = taskIntentConfirmation(
    userMessage.content,
    createdTasks,
    completedTasks,
  );
  if (taskReply) answer = taskReply;

  const listReply = taskListReply(userMessage.content, retrieval.tasks);
  if (listReply) answer = listReply;

  answer = speakToUser(sanitizeAnswer(answer), user);
  const answerMs = Math.round(performance.now() - turnStarted);
  yield { type: 'reply', content: answer };

  if (shouldConsolidate(userMessage.content)) {
    yield { type: 'status', label: 'Saving what matters' };
  }
  const consolidated = await consolidationPromise;
  for (const memory of consolidated.memories) {
    memoriesWritten.push(memory);
    yield { type: 'memory_saved', memory, deduped: false };
  }
  memoriesDeduped += consolidated.deduped;
  const consolidationMs = consolidated.ms;

  const trace: TurnTrace = {
    retrieval,
    toolCalls: toolEvents,
    memoriesWritten,
    memoriesDeduped,
    tasksChanged,
    timings: {
      retrievalMs: Math.round(retrieval.latencyMs),
      answerMs,
      consolidationMs,
    },
  };

  const message = await addMessage({
    sessionId: session.id,
    userId: user.id,
    role: 'assistant',
    content: answer,
    trace,
  });

  yield { type: 'done', message, trace };
}

/** Normalize a memory the model wrote in second person into third person. */
function toThirdPerson(text: string, user: User): string {
  const name = user.displayName.trim().split(/\s+/)[0] || 'the user';
  return text
    .replace(/\bI am\b/gi, `${name} is`)
    .replace(/\bI'm\b/gi, `${name} is`)
    .replace(/\bI've\b/gi, `${name} has`)
    .replace(/\bmy\b/gi, `${name}'s`)
    .replace(/\bme\b/gi, name)
    .replace(/\bI\b/g, name)
    .replace(/\byou are\b/gi, `${name} is`)
    .replace(/\byou were\b/gi, `${name} was`)
    .replace(/\byou have\b/gi, `${name} has`)
    .replace(/\byour\b/gi, `${name}'s`)
    .replace(/\byou\b/gi, name);
}

/** Crisp confirmations for simple task requests, where small models tend to ramble. */
function taskIntentConfirmation(
  message: string,
  created: Task[],
  completed: Task[],
): string | null {
  const text = message.trim();
  const createIntent =
    /^(?:please\s+|can you\s+|could you\s+|would you\s+)?(?:add|create|track|remind me to|remember to)\b/i.test(
      text,
    );
  const completeIntent =
    /^(?:please\s+|can you\s+)?(?:mark|complete|finish|check off|i\s+(?:sent|finished|did|completed|emailed))\b/i.test(
      text,
    );

  if (completeIntent && completed.length === 1) {
    const title = completed[0].title;
    return `Done — ${title.charAt(0).toLowerCase()}${title.slice(1)} is marked complete.`;
  }
  if (createIntent && created.length === 1) {
    const task = created[0];
    const title = `${task.title.charAt(0).toLowerCase()}${task.title.slice(1)}`;
    const due = shortDueDate(task.dueAt);
    return `Added — ${title}${due ? ` by ${due}` : ''}.`;
  }
  if (createIntent && created.length > 1) {
    return `Added ${created.length} tasks.`;
  }
  return null;
}

/** Answer "what's on my plate?" style questions from the task table, not from food memories. */
function taskListReply(message: string, tasks: Task[]): string | null {
  const asksAboutTasks =
    /\b(?:what'?s|what is|show(?: me)?|list|see)\b[\s\S]{0,40}\b(?:on my plate|open|tasks?|to-?dos?)\b/i.test(
      message,
    ) || /\bmy (?:open )?(?:tasks?|to-?dos?)\b/i.test(message);
  if (!asksAboutTasks) return null;

  const open = tasks.filter((task) => task.status === 'open');
  if (open.length === 0) return 'Your plate is clear — no open tasks.';

  const lines = open
    .slice(0, 5)
    .map((task) => `- ${task.title}${task.dueAt ? ` — ${shortDueDate(task.dueAt)}` : ''}`);
  const extra = open.length > 5 ? `\n…and ${open.length - 5} more.` : '';
  return `You have ${open.length} open task${open.length === 1 ? '' : 's'}:\n${lines.join('\n')}${extra}`;
}

/** Translate stored third-person memories into direct second-person replies. */
function speakToUser(text: string, user: User): string {
  const names = [user.displayName.trim(), user.displayName.trim().split(/\s+/)[0]].filter(
    (name, index, all) => name.length > 2 && all.indexOf(name) === index,
  );

  let result = text;
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result
      .replace(new RegExp(`\\b${escaped}['’]s\\b`, 'gi'), 'your')
      .replace(new RegExp(`\\b${escaped}\\s+is\\b`, 'gi'), 'you are')
      .replace(new RegExp(`\\b${escaped}\\s+was\\b`, 'gi'), 'you were')
      .replace(new RegExp(`\\b${escaped}\\s+has\\b`, 'gi'), 'you have')
      .replace(new RegExp(`\\b${escaped}\\b`, 'gi'), 'you');
  }

  return result.replace(
    /(^|[.!?]\s+)(you|your)\b/g,
    (_match, prefix: string, word: string) => `${prefix}${word[0].toUpperCase()}${word.slice(1)}`,
  );
}

function sanitizeAnswer(text: string): string {
  return text
    .replace(/You can track this task with its ID:?[^\n]*/gi, '')
    .replace(/^I(?:'ve| have) (?:saved|stored) (?:this|that) memory:?\s*/i, 'Noted — ')
    .replace(/,?\s*I(?:'ve| have) (?:saved|stored) (?:this|that) memory:?\s*/gi, '. ')
    .replace(/^(?:you have|you've|you now) remembered that\s+/i, 'Noted — ')
    .replace(/\{[^{}]*"(?:content|kind)"\s*:[^{}]*\}/gi, '')
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      '',
    )
    .replace(/^[.\s,;:]+/, '')
    .replace(/^Noted\s*—\s*$/, 'Noted.')
    .replace(/[ \t]+\./g, '.')
    .replace(/\.\s*\./g, '.')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function toolLabel(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'search_memory':
      return `Searching memory: “${String(args.query ?? '').slice(0, 48)}”`;
    case 'save_memory':
      return 'Saving a memory';
    case 'create_task':
      return `Creating task: ${String(args.title ?? '').slice(0, 48)}`;
    case 'list_tasks':
      return 'Checking tasks';
    case 'complete_task':
      return 'Completing a task';
    default:
      return name.replace(/_/g, ' ');
  }
}

function summarizeResult(name: string, outcome: ToolOutcome): string {
  if (name === 'search_memory') {
    const rows = Array.isArray(outcome.result) ? outcome.result : [];
    return `${rows.length} memories found`;
  }
  if (name === 'save_memory') return outcome.memoryDeduped ? 'Already remembered' : 'Memory saved';
  if (name === 'create_task') return 'Task saved';
  if (name === 'list_tasks') return 'Tasks loaded';
  if (name === 'complete_task') return 'Task completed';
  return 'Done';
}
