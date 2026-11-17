"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  Brain,
  HeartPulse,
  Menu,
  PanelLeft,
  ScanLine,
  ServerOff,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import {
  ApiError,
  clearImageCache,
  deleteConversation as apiDeleteConversation,
  deleteSession,
  getHealth,
  streamChat,
  type ChatPayload,
} from "@/lib/api";
import {
  LanguageContext,
  setCurrentLanguage,
  translate,
  type MessageKey,
  type Translate,
} from "@/lib/i18n";
import {
  DEFAULT_LANGUAGE,
  DEFAULT_THEME,
  PREFERENCE_KEYS,
  applyTheme,
  loadPreference,
  savePreference,
} from "@/lib/preferences";
import {
  clearHistory,
  getSessionId,
  loadActiveId,
  loadConsent,
  loadConversations,
  loadSettings,
  resetSessionId,
  saveActiveId,
  saveConsent,
  saveConversations,
  saveSettings,
} from "@/lib/storage";
import type {
  Attachment,
  ChatEvent,
  ChatMessage as Message,
  Conversation,
  Health,
  Settings,
} from "@/lib/types";
import { cn, newId } from "@/lib/utils";
import ChatInput from "@/components/ChatInput";
import ChatMessage from "@/components/ChatMessage";
import ConsentDialog from "@/components/ConsentDialog";
import { SessionContext } from "@/components/ImageAttachment";
import { LogoMark } from "@/components/Logo";
import SettingsDialog from "@/components/SettingsDialog";
import Sidebar, { SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN } from "@/components/Sidebar";
import { Button } from "@/components/ui/button";

const SUGGESTIONS: { icon: LucideIcon; key: MessageKey }[] = [
  { icon: Activity, key: "suggestion_1" },
  { icon: Brain, key: "suggestion_2" },
  { icon: HeartPulse, key: "suggestion_3" },
  { icon: ScanLine, key: "suggestion_4" },
];

function titleFrom(text: string, attachments: Attachment[], t: Translate): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return attachments.length ? t("attached_file") : t("new_conversation");
  return clean.length > 42 ? `${clean.slice(0, 42).trimEnd()}…` : clean;
}

function toHistory(messages: Message[]): ChatPayload["history"] {
  return messages
    .filter((m) => !m.pending)
    .map((m) => {
      if (m.role === "user") {
        return {
          role: "user" as const,
          text: m.text ?? "",
          attachment_ids: (m.attachments ?? []).map((a) => a.imageId),
          tool_result_ids: [],
        };
      }
      const parts = m.parts ?? [];
      return {
        role: "assistant" as const,
        text: parts
          .flatMap((p) => (p.type === "text" && p.text.trim() ? [p.text.trim()] : []))
          .join("\n\n"),
        attachment_ids: [],
        tool_result_ids: parts.flatMap((p) => (p.type === "tool" && p.resultId ? [p.resultId] : [])),
      };
    });
}

/** Apply one streamed event to the assistant message being built. */
function applyEvent(message: Message, event: ChatEvent): Message {
  const parts = [...(message.parts ?? [])];
  switch (event.type) {
    case "emergency":
      return { ...message, emergency: true };
    case "text_delta": {
      const last = parts[parts.length - 1];
      if (last?.type === "text") {
        parts[parts.length - 1] = { ...last, text: last.text + event.text };
      } else {
        parts.push({ type: "text", text: event.text });
      }
      return { ...message, parts };
    }
    case "tool_start":
      parts.push({
        type: "tool",
        toolUseId: event.tool_use_id,
        toolName: event.tool_name,
        label: event.label,
        runningText: event.running_text,
        state: "running",
      });
      return { ...message, parts };
    case "tool_end":
      return {
        ...message,
        parts: parts.map((p) =>
          p.type === "tool" && p.toolUseId === event.tool_use_id
            ? {
                ...p,
                state: "done" as const,
                isError: event.is_error,
                resultId: event.result_id,
                result: event.result,
              }
            : p,
        ),
      };
    case "notice":
      return { ...message, notice: event.message };
    case "error":
      return { ...message, error: event.message, pending: false };
    case "done":
      return { ...message, pending: false };
    default:
      return message;
  }
}

export default function ChatInterface() {
  const [ready, setReady] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState("");
  const [consent, setConsent] = useState(false);
  const [settings, setSettings] = useState<Settings>({
    showToolActivity: false,
    language: DEFAULT_LANGUAGE,
    theme: DEFAULT_THEME,
  });
  const [health, setHealth] = useState<Health | null>(null);
  const [backendDown, setBackendDown] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null); // conversation id
  const [atBottom, setAtBottom] = useState(true);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingSendRef = useRef<{ text: string; attachments: Attachment[] } | null>(null);
  const conversationsRef = useRef<Conversation[]>([]);
  conversationsRef.current = conversations;

  // This component provides the language to everything below it, so it
  // translates from its own state instead of through the context hook.
  const t = useCallback<Translate>(
    (key, params) => translate(settings.language, key, params),
    [settings.language],
  );

  // --- load browser state after mount (avoids hydration mismatches) --------
  useEffect(() => {
    const stored = loadConversations();
    const storedActive = loadActiveId();
    setSessionId(getSessionId());
    setConversations(stored);
    setActiveId(
      storedActive && stored.some((c) => c.id === storedActive) ? storedActive : newId(),
    );
    const consented = loadConsent();
    setConsent(consented);
    setConsentOpen(!consented); // ask before anything can be sent
    const loadedSettings = loadSettings();
    setSettings(loadedSettings);
    setCurrentLanguage(loadedSettings.language); // before the first API call
    const width = Number(loadPreference(PREFERENCE_KEYS.sidebarWidth));
    if (width >= SIDEBAR_MIN && width <= SIDEBAR_MAX) setSidebarWidth(width);
    setSidebarCollapsed(loadPreference(PREFERENCE_KEYS.sidebarCollapsed) === "1");
    setReady(true);
  }, []);

  // --- language and theme on the document -----------------------------------
  // Until the stored settings are loaded, the values the boot script in
  // layout.tsx applied before the first paint stay in place.
  useEffect(() => {
    if (!ready) return;
    setCurrentLanguage(settings.language);
    document.documentElement.lang = settings.language;
  }, [ready, settings.language]);

  useEffect(() => {
    if (ready) applyTheme(settings.theme);
  }, [ready, settings.theme]);

  // --- persist ------------------------------------------------------------
  useEffect(() => {
    if (ready && !streamingId) saveConversations(conversations);
  }, [conversations, ready, streamingId]);

  useEffect(() => {
    if (ready && activeId) saveActiveId(activeId);
  }, [activeId, ready]);

  // --- backend status -----------------------------------------------------
  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await getHealth());
      setBackendDown(false);
    } catch {
      setBackendDown(true);
    }
  }, []);

  useEffect(() => {
    refreshHealth();
    const timer = window.setInterval(refreshHealth, 30_000);
    return () => window.clearInterval(timer);
  }, [refreshHealth]);

  useEffect(() => {
    if (settingsOpen) refreshHealth();
  }, [settingsOpen, refreshHealth]);

  // --- derived ------------------------------------------------------------
  const active = useMemo(
    () => conversations.find((c) => c.id === activeId),
    [conversations, activeId],
  );
  const messages = active?.messages ?? [];
  const busy = streamingId !== null;

  // --- scrolling ----------------------------------------------------------
  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  useEffect(() => {
    // The welcome screen (no messages) always starts at the top.
    if (messages.length === 0) scrollRef.current?.scrollTo({ top: 0 });
    else if (atBottom) scrollToBottom();
  }, [messages, atBottom, scrollToBottom]);

  useEffect(() => {
    setAtBottom(true);
  }, [activeId]);

  // --- conversation helpers ----------------------------------------------
  const patchMessage = useCallback(
    (conversationId: string, messageId: string, fn: (m: Message) => Message) => {
      setConversations((list) =>
        list.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                updatedAt: Date.now(),
                messages: c.messages.map((m) => (m.id === messageId ? fn(m) : m)),
              }
            : c,
        ),
      );
    },
    [],
  );

  const runTurn = useCallback(
    async (conversationId: string, text: string, attachments: Attachment[], prior: Message[]) => {
      const now = Date.now();
      const userMessage: Message = {
        id: newId(),
        role: "user",
        createdAt: now,
        text,
        attachments,
      };
      const assistantMessage: Message = {
        id: newId(),
        role: "assistant",
        createdAt: now + 1,
        parts: [],
        pending: true,
      };

      setConversations((list) => {
        const existing = list.find((c) => c.id === conversationId);
        if (existing) {
          return list.map((c) =>
            c.id === conversationId
              ? { ...c, updatedAt: now, messages: [...prior, userMessage, assistantMessage] }
              : c,
          );
        }
        return [
          ...list,
          {
            id: conversationId,
            title: titleFrom(text, attachments, t),
            createdAt: now,
            updatedAt: now,
            messages: [userMessage, assistantMessage],
          },
        ];
      });
      setAtBottom(true);
      setStreamingId(conversationId);

      const controller = new AbortController();
      abortRef.current = controller;

      const payload: ChatPayload = {
        conversation_id: conversationId,
        consent: true,
        history: toHistory(prior),
        message: { text, attachment_ids: attachments.map((a) => a.imageId) },
      };

      try {
        await streamChat(
          payload,
          sessionId,
          (event) => patchMessage(conversationId, assistantMessage.id, (m) => applyEvent(m, event)),
          controller.signal,
        );
        patchMessage(conversationId, assistantMessage.id, (m) => ({ ...m, pending: false }));
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === "AbortError";
        patchMessage(conversationId, assistantMessage.id, (m) => ({
          ...m,
          pending: false,
          stopped: aborted || m.stopped,
          // A tool that was still running will never report back.
          parts: m.parts?.filter((p) => p.type !== "tool" || p.state === "done"),
          error: aborted
            ? undefined
            : err instanceof ApiError
              ? err.message
              : t("unexpected_error"),
        }));
        if (err instanceof ApiError && err.code === "unreachable") setBackendDown(true);
        if (err instanceof ApiError && err.code === "claude_not_configured") refreshHealth();
      } finally {
        abortRef.current = null;
        setStreamingId(null);
      }
    },
    [patchMessage, refreshHealth, sessionId, t],
  );

  const send = useCallback(
    (text: string, attachments: Attachment[]) => {
      if (busy || !activeId) return;
      if (!consent) {
        pendingSendRef.current = { text, attachments };
        setConsentOpen(true);
        return;
      }
      const prior = conversationsRef.current.find((c) => c.id === activeId)?.messages ?? [];
      void runTurn(activeId, text, attachments, prior);
    },
    [activeId, busy, consent, runTurn],
  );

  const retry = useCallback(() => {
    if (busy) return;
    const all = conversationsRef.current.find((c) => c.id === activeId)?.messages ?? [];
    const failed = all[all.length - 1];
    const question = all[all.length - 2];
    if (!failed || failed.role !== "assistant" || !question || question.role !== "user") return;
    void runTurn(activeId, question.text ?? "", question.attachments ?? [], all.slice(0, -2));
  }, [activeId, busy, runTurn]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const newConversation = useCallback(() => {
    setActiveId(newId());
    setSidebarOpen(false);
  }, []);

  const removeConversation = useCallback(
    (id: string) => {
      if (streamingId === id) abortRef.current?.abort();
      setConversations((list) => list.filter((c) => c.id !== id));
      if (id === activeId) setActiveId(newId());
      apiDeleteConversation(id, sessionId).catch(() => undefined);
    },
    [activeId, sessionId, streamingId],
  );

  const clearAll = useCallback(() => {
    abortRef.current?.abort();
    deleteSession(sessionId).catch(() => undefined);
    clearImageCache();
    clearHistory();
    setConversations([]);
    setSessionId(resetSessionId());
    setActiveId(newId());
  }, [sessionId]);

  const acceptConsent = useCallback(() => {
    saveConsent(true);
    setConsent(true);
    setConsentOpen(false);
    const queued = pendingSendRef.current;
    pendingSendRef.current = null;
    if (queued && activeId) {
      const prior = conversationsRef.current.find((c) => c.id === activeId)?.messages ?? [];
      void runTurn(activeId, queued.text, queued.attachments, prior);
    }
  }, [activeId, runTurn]);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((current) => {
      savePreference(PREFERENCE_KEYS.sidebarCollapsed, current ? "0" : "1");
      return !current;
    });
  }, []);

  const updateSettings = useCallback((next: Settings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  // --- render -------------------------------------------------------------
  const yoloStatus = health?.yolo.status;
  const lastMessage = messages[messages.length - 1];
  const showScrollButton = !atBottom && messages.length > 0;

  return (
    <LanguageContext.Provider value={settings.language}>
      {/* Hoisted into <head> by React; the tab title follows the language. */}
      <title>{t("app_title")}</title>
      <SessionContext.Provider value={sessionId}>
        <div className="flex h-dvh overflow-hidden bg-base">
          <Sidebar
            conversations={conversations}
            activeId={activeId}
            open={sidebarOpen}
            collapsed={sidebarCollapsed}
            width={sidebarWidth}
            onResize={setSidebarWidth}
            onResizeEnd={(width) => savePreference(PREFERENCE_KEYS.sidebarWidth, String(width))}
            onClose={() => setSidebarOpen(false)}
            onNew={newConversation}
            onSelect={(id) => {
              setActiveId(id);
              setSidebarOpen(false);
            }}
            onDelete={removeConversation}
            onOpenSettings={() => {
              setSettingsOpen(true);
              setSidebarOpen(false);
            }}
          />

          <main className="fx-aurora @container relative flex min-w-0 flex-1 flex-col">
            {/* Top bar */}
            <header className="flex h-14 shrink-0 items-center gap-1.5 border-b border-line bg-base/60 px-3 backdrop-blur-xl @2xl:px-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden"
                aria-label={t("menu_open")}
              >
                <Menu className="size-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleSidebar}
                className="hidden lg:inline-flex"
                aria-label={sidebarCollapsed ? t("sidebar_show") : t("sidebar_hide")}
                aria-pressed={!sidebarCollapsed}
                title={sidebarCollapsed ? t("sidebar_show_short") : t("sidebar_hide_short")}
              >
                <PanelLeft className="size-[18px]" />
              </Button>
              <h1
                key={activeId}
                className="min-w-0 flex-1 animate-fade truncate px-1.5 font-display text-[15px] font-bold tracking-tight text-ink-900"
              >
                {active?.title ?? t("new_conversation")}
              </h1>
            </header>

            {/* System warnings */}
            {(backendDown || (health && !health.claude_configured)) && (
              <div
                className="flex animate-fade items-start gap-2.5 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] leading-snug text-amber-900 @2xl:px-6"
                role="alert"
              >
                {backendDown ? (
                  <>
                    <ServerOff className="mt-0.5 size-4 shrink-0" />
                    <span>
                      {t("backend_down_1")}
                      <code className="font-mono text-[12px]">uvicorn main:app --port 8000</code>
                      {t("backend_down_2")}
                    </span>
                  </>
                ) : (
                  <>
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                    <span>
                      {t("claude_unconfigured_1")}{" "}
                      <code className="font-mono text-[12px]">ANTHROPIC_API_KEY</code>{" "}
                      {t("claude_unconfigured_2")} <code className="font-mono text-[12px]">.env</code>{" "}
                      {t("claude_unconfigured_3")}
                    </span>
                  </>
                )}
              </div>
            )}

            {/* Messages */}
            <div
              ref={scrollRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
              }}
              className="scroll-quiet min-h-0 flex-1 overflow-y-auto"
            >
              {!ready ? null : messages.length === 0 ? (
                <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col items-center justify-center px-5 py-12 text-center">
                  <LogoMark className="fx-halo size-16 animate-rise rounded-2xl" />
                  <h2 className="fx-title mt-7 animate-rise font-display text-[1.7rem] font-extrabold leading-tight tracking-tight text-ink-900 @xl:text-[2rem]">
                    {t("welcome_heading")}
                  </h2>
                  <p
                    className="mt-3 max-w-xl animate-rise text-pretty text-[15px] leading-relaxed text-ink-500"
                    style={{ animationDelay: "60ms" }}
                  >
                    {t("welcome_text")}
                  </p>

                  <div className="mt-9 grid w-full gap-3 @xl:grid-cols-2">
                    {SUGGESTIONS.map(({ icon: Icon, key }, i) => {
                      const text = t(key);
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => send(text, [])}
                          disabled={busy || backendDown}
                          style={{ animationDelay: `${120 + i * 50}ms` }}
                          className="fx-card focus-ring group flex animate-rise items-center gap-3.5 rounded-2xl border border-line bg-card p-3.5 text-left text-sm text-ink-700 hover:-translate-y-0.5 hover:border-line-strong hover:text-ink-900 active:translate-y-0 disabled:pointer-events-none disabled:opacity-50"
                        >
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-fill text-brand-300 ring-1 ring-line transition-[background-color,color,scale,box-shadow] duration-300 ease-out-quart group-hover:scale-105 group-hover:bg-primary group-hover:text-black group-hover:shadow-[0_6px_18px_-6px_rgb(var(--rgb-primary)/0.5)]">
                            <Icon className="size-[18px]" />
                          </span>
                          <span className="leading-snug">{text}</span>
                        </button>
                      );
                    })}
                  </div>

                  {health && yoloStatus !== "ready" && (
                    <p className="mt-7 flex max-w-xl animate-fade items-start gap-2.5 rounded-xl border border-line bg-fill px-4 py-3 text-left text-[13px] leading-relaxed text-ink-500">
                      <ScanLine className="mt-0.5 size-4 shrink-0 text-ink-400" />
                      <span>
                        {yoloStatus === "incompatible"
                          ? t("xray_unavailable_incompatible")
                          : t("xray_unavailable_missing")}
                      </span>
                    </p>
                  )}
                </div>
              ) : (
                <div
                  key={activeId}
                  className="mx-auto w-full max-w-3xl animate-fade space-y-8 px-4 pb-10 pt-8 @2xl:px-8"
                >
                  {messages.map((m) => (
                    <ChatMessage
                      key={m.id}
                      message={m}
                      showTools={settings.showToolActivity}
                      onRetry={m === lastMessage && m.error && !busy ? retry : undefined}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Composer */}
            <div className="relative shrink-0 px-3 pb-3 @2xl:px-6 @2xl:pb-4">
              {messages.length > 0 && (
                <div className="fx-fade-up pointer-events-none absolute inset-x-0 -top-10 h-10" aria-hidden />
              )}
              <button
                type="button"
                onClick={() => {
                  setAtBottom(true);
                  scrollToBottom(true);
                }}
                className={cn(
                  "focus-ring absolute -top-12 left-1/2 flex size-9 -translate-x-1/2 items-center justify-center rounded-full border border-line bg-card/90 text-ink-700 shadow-lift backdrop-blur-md transition-[opacity,translate,scale,background-color,color] duration-300 ease-out-quart hover:bg-fill-hover hover:text-ink-900 active:scale-95",
                  showScrollButton
                    ? "opacity-100"
                    : "pointer-events-none translate-y-2 scale-90 opacity-0",
                )}
                aria-label={t("scroll_to_latest")}
                tabIndex={showScrollButton ? 0 : -1}
              >
                <ArrowDown className="size-4" />
              </button>

              <div className="mx-auto w-full max-w-3xl">
                {ready && (
                  <ChatInput
                    conversationId={activeId}
                    sessionId={sessionId}
                    busy={busy}
                    disabled={backendDown}
                    onSend={send}
                    onStop={stop}
                  />
                )}
                <p className="mt-2.5 px-2 text-center text-[11.5px] leading-snug text-ink-400">
                  {t("footer_disclaimer")} {t("footer_emergency_1")}{" "}
                  <a
                    href="tel:112"
                    className="focus-ring rounded-sm font-semibold text-ink-500 underline-offset-2 transition-colors hover:text-ink-900 hover:underline"
                  >
                    112
                  </a>
                  {t("footer_emergency_2")}
                </p>
              </div>
            </div>
          </main>
        </div>

        <ConsentDialog
          open={consentOpen}
          onAccept={acceptConsent}
          onDecline={() => {
            pendingSendRef.current = null;
            setConsentOpen(false);
          }}
        />

        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          settings={settings}
          onSettingsChange={updateSettings}
          health={health}
          backendDown={backendDown}
          consent={consent}
          onRevokeConsent={() => {
            saveConsent(false);
            setConsent(false);
          }}
          onClearHistory={clearAll}
          conversationCount={conversations.length}
        />
      </SessionContext.Provider>
    </LanguageContext.Provider>
  );
}
