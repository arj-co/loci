import type { MemoryKind } from '../shared/types';

export interface DemoMemory {
  kind: MemoryKind;
  content: string;
  importance: number;
  sourceSession?: string;
  daysAgo: number;
}

export interface DemoSession {
  title: string;
  daysAgo: number;
  messages: { role: 'user' | 'assistant'; content: string; minutesAfter: number }[];
}

export const demoMemories: DemoMemory[] = [
  {
    kind: 'person',
    content:
      'Maya is Arjun’s cofounder and leads product design at Loomline. She owns the public beta launch.',
    importance: 0.95,
    sourceSession: 'Loomline beta + investor update',
    daysAgo: 3,
  },
  {
    kind: 'project',
    content:
      'Loomline is launching its public beta in January 2027. The investor update is due the last Friday of every month.',
    importance: 0.9,
    sourceSession: 'Loomline beta + investor update',
    daysAgo: 3,
  },
  {
    kind: 'preference',
    content: 'Arjun is vegetarian and strongly dislikes mushrooms.',
    importance: 0.9,
    sourceSession: 'Dinner, books, and a quieter week',
    daysAgo: 9,
  },
  {
    kind: 'goal',
    content:
      'Arjun is training for the Brooklyn Half Marathon on November 15, 2026, aiming for a sub-2:00 finish.',
    importance: 0.95,
    sourceSession: 'Brooklyn Half training plan',
    daysAgo: 18,
  },
  {
    kind: 'health',
    content:
      'Arjun gets occasional left-knee pain after long runs. He was advised to strengthen his glutes and avoid back-to-back run days.',
    importance: 0.85,
    sourceSession: 'Brooklyn Half training plan',
    daysAgo: 18,
  },
  {
    kind: 'person',
    content:
      'Priya is Arjun’s running coach. She sends the next week’s training plan every Sunday evening.',
    importance: 0.75,
    sourceSession: 'Brooklyn Half training plan',
    daysAgo: 18,
  },
  {
    kind: 'preference',
    content:
      'Arjun does deep work in the morning and dislikes meetings before 10am.',
    importance: 0.8,
    sourceSession: 'Loomline beta + investor update',
    daysAgo: 3,
  },
  {
    kind: 'preference',
    content:
      'Arjun prefers concise answers with concrete next steps rather than long explanations.',
    importance: 0.7,
    sourceSession: 'Dinner, books, and a quieter week',
    daysAgo: 9,
  },
  {
    kind: 'fact',
    content: 'Arjun lives in Brooklyn, New York.',
    importance: 0.65,
    daysAgo: 30,
  },
  {
    kind: 'goal',
    content:
      'Arjun wants to cook more at home and is learning South Indian recipes. He likes paneer, chickpeas, and dal.',
    importance: 0.6,
    sourceSession: 'Dinner, books, and a quieter week',
    daysAgo: 9,
  },
  {
    kind: 'note',
    content:
      'Arjun loved “Tomorrow, and Tomorrow, and Tomorrow” and is currently reading “The Creative Act” by Rick Rubin.',
    importance: 0.45,
    sourceSession: 'Dinner, books, and a quieter week',
    daysAgo: 9,
  },
  {
    kind: 'person',
    content:
      'Dev is Arjun’s younger brother. He lives in Austin and is getting married next March.',
    importance: 0.55,
    daysAgo: 45,
  },
];

export const demoSessions: DemoSession[] = [
  {
    title: 'Brooklyn Half training plan',
    daysAgo: 18,
    messages: [
      {
        role: 'user',
        content:
          'I signed up for the Brooklyn Half on November 15. I want to go sub-2. My left knee has been cranky after long runs.',
        minutesAfter: 0,
      },
      {
        role: 'assistant',
        content:
          'Sub-2 is a solid target. Given the knee, I’d keep it to three runs a week with one long run and two easy efforts, plus glute and calf strength work twice a week. Which days actually work for you?',
        minutesAfter: 1,
      },
      {
        role: 'user',
        content:
          'Tuesday, Thursday, Saturday. I refuse to run before 8am. Priya is my coach and sends plans on Sundays.',
        minutesAfter: 2,
      },
      {
        role: 'assistant',
        content:
          'Perfect: Tuesday and Thursday easy, Saturday long run. I’ll keep Sunday as a full rest day since Priya sends the plan then. Want me to track the long-run distances as tasks?',
        minutesAfter: 3,
      },
    ],
  },
  {
    title: 'Dinner, books, and a quieter week',
    daysAgo: 9,
    messages: [
      {
        role: 'user',
        content:
          'I’m vegetarian and I hate mushrooms. Give me three easy high-protein dinners I can make after work.',
        minutesAfter: 0,
      },
      {
        role: 'assistant',
        content:
          'Three quick ones: paneer bhurji with roti, chickpea and spinach curry, and a dal-heavy khichdi with yogurt. All are mushroom-free and reheat well. Want a grocery list?',
        minutesAfter: 1,
      },
      {
        role: 'user',
        content:
          'Yes. Also I loved Tomorrow, and Tomorrow, and Tomorrow — what should I read next? And please keep answers short with next steps.',
        minutesAfter: 2,
      },
      {
        role: 'assistant',
        content:
          'Next step: add paneer, chickpeas, spinach, dal, and yogurt to your list. For reading, try “The Creative Act” by Rick Rubin — short chapters, easy to pick up after work. I’ll remember the concise-answers preference.',
        minutesAfter: 3,
      },
    ],
  },
  {
    title: 'Loomline beta + investor update',
    daysAgo: 3,
    messages: [
      {
        role: 'user',
        content:
          'Maya wants the updated beta onboarding flow by Friday. The investor update is also due soon and I’m swamped.',
        minutesAfter: 0,
      },
      {
        role: 'assistant',
        content:
          'Two next steps: block 90 minutes tomorrow morning for the onboarding flow, and draft the investor update in outline form first. Maya owns design, so send her the flow for review before Friday. Want me to add both as tasks?',
        minutesAfter: 1,
      },
      {
        role: 'user',
        content:
          'Yes. Also I do my best deep work before 10am, so no meetings then.',
        minutesAfter: 2,
      },
      {
        role: 'assistant',
        content:
          'Done — onboarding flow and investor update are on your list. I’ll protect mornings before 10am for deep work and flag any conflicts.',
        minutesAfter: 3,
      },
    ],
  },
];

export const demoTasks = [
  {
    title: 'Send Maya the updated beta onboarding flow',
    notes: 'Maya reviews design before Friday.',
    dueInDays: 2,
    status: 'open' as const,
  },
  {
    title: 'Draft October investor update',
    notes: 'Outline first, then metrics and the beta timeline.',
    dueInDays: 7,
    status: 'open' as const,
  },
  {
    title: 'Book a 20-mile long run for Saturday',
    notes: 'Keep the pace easy; knee check afterwards.',
    dueInDays: 1,
    status: 'open' as const,
  },
  {
    title: 'Schedule knee physio check-in',
    notes: 'Ask about glute strengthening and back-to-back run days.',
    dueInDays: 5,
    status: 'open' as const,
  },
  {
    title: 'Order tart cherry juice',
    notes: 'Recovery',
    dueInDays: -2,
    status: 'done' as const,
  },
];
