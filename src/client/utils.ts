import type { MemoryKind } from '../shared/types';

export function cx(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return 'just now';
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatDue(iso: string | null | undefined): {
  label: string;
  tone: 'normal' | 'soon' | 'overdue' | 'done';
} {
  if (!iso) return { label: 'No date', tone: 'normal' };
  const due = new Date(`${iso}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((due.getTime() - today.getTime()) / 86_400_000);

  if (diff < 0) return { label: diff === -1 ? 'Yesterday' : `${Math.abs(diff)}d overdue`, tone: 'overdue' };
  if (diff === 0) return { label: 'Today', tone: 'soon' };
  if (diff === 1) return { label: 'Tomorrow', tone: 'soon' };
  if (diff < 7) {
    return {
      label: due.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      tone: 'soon',
    };
  }
  return {
    label: due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    tone: 'normal',
  };
}

export const KIND_META: Record<MemoryKind, { label: string; short: string }> = {
  fact: { label: 'Fact', short: 'Fact' },
  preference: { label: 'Preference', short: 'Pref' },
  person: { label: 'Person', short: 'Person' },
  goal: { label: 'Goal', short: 'Goal' },
  project: { label: 'Project', short: 'Project' },
  health: { label: 'Health', short: 'Health' },
  note: { label: 'Note', short: 'Note' },
};

export function titleFromMessage(message: string): string {
  const clean = message.replace(/\s+/g, ' ').trim();
  const words = clean.split(' ').slice(0, 7).join(' ');
  const title = words.length < clean.length ? `${words}…` : words;
  return title.charAt(0).toUpperCase() + title.slice(1);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
