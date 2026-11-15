import type { Conversation, Settings } from "./types";
import { newId } from "./utils";

/**
 * Everything is kept in sessionStorage: it disappears when the tab is closed
 * and is never written to the server.
 */
const KEYS = {
  session: "medai.session",
  conversations: "medai.conversations",
  active: "medai.active",
  consent: "medai.consent",
  settings: "medai.settings",
} as const;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the app keeps working in memory */
  }
}

export function getSessionId(): string {
  let id = read<string | null>(KEYS.session, null);
  if (!id) {
    id = newId();
    write(KEYS.session, id);
  }
  return id;
}

export function resetSessionId(): string {
  const id = newId();
  write(KEYS.session, id);
  return id;
}

export function loadConversations(): Conversation[] {
  const list = read<Conversation[]>(KEYS.conversations, []);
  // A reload interrupts any stream that was in flight.
  return list.map((c) => ({
    ...c,
    messages: c.messages.map((m) =>
      m.pending
        ? {
            ...m,
            pending: false,
            stopped: true,
            parts: m.parts?.filter((p) => p.type !== "tool" || p.state === "done"),
          }
        : m,
    ),
  }));
}

export function saveConversations(list: Conversation[]) {
  write(KEYS.conversations, list);
}

export function loadActiveId(): string | null {
  return read<string | null>(KEYS.active, null);
}

export function saveActiveId(id: string) {
  write(KEYS.active, id);
}

export function loadConsent(): boolean {
  return read<boolean>(KEYS.consent, false);
}

export function saveConsent(value: boolean) {
  write(KEYS.consent, value);
}

export function loadSettings(): Settings {
  return { demoMode: false, showToolActivity: false, ...read<Partial<Settings>>(KEYS.settings, {}) };
}

export function saveSettings(settings: Settings) {
  write(KEYS.settings, settings);
}

export function clearHistory() {
  try {
    window.sessionStorage.removeItem(KEYS.conversations);
    window.sessionStorage.removeItem(KEYS.active);
  } catch {
    /* ignore */
  }
}
