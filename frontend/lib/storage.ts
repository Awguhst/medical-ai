import {
  DEFAULT_LANGUAGE,
  DEFAULT_THEME,
  PREFERENCE_KEYS,
  isLanguage,
  isThemeName,
  loadPreference,
  savePreference,
} from "./preferences";
import type { Conversation, Settings } from "./types";
import { newId } from "./utils";

/**
 * Everything here is kept in sessionStorage: it disappears when the tab is
 * closed and is never written to the server. Language and theme are the
 * exception (no health data) and go to localStorage via preferences.ts.
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
  const session = read<Partial<Settings>>(KEYS.settings, {});
  const language = loadPreference(PREFERENCE_KEYS.language);
  const theme = loadPreference(PREFERENCE_KEYS.theme);
  return {
    showToolActivity: session.showToolActivity ?? false,
    language: isLanguage(language) ? language : DEFAULT_LANGUAGE,
    theme: isThemeName(theme) ? theme : DEFAULT_THEME,
  };
}

export function saveSettings({ language, theme, ...session }: Settings) {
  write(KEYS.settings, session);
  savePreference(PREFERENCE_KEYS.language, language);
  savePreference(PREFERENCE_KEYS.theme, theme);
}

export function clearHistory() {
  try {
    window.sessionStorage.removeItem(KEYS.conversations);
    window.sessionStorage.removeItem(KEYS.active);
  } catch {
    /* ignore */
  }
}
