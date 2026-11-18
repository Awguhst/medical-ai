"use client";

import { memo, useEffect, useRef, useState, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FileText,
  Info,
  Pencil,
  Phone,
  RefreshCw,
  RotateCcw,
} from "lucide-react";

import { useT } from "@/lib/i18n";
import { parentKey } from "@/lib/thread";
import type { ChatMessage as Message } from "@/lib/types";
import { cn, enterSends } from "@/lib/utils";
import { LogoMark } from "@/components/Logo";
import ImageAttachment from "@/components/ImageAttachment";
import ToolResult from "@/components/ToolResult";
import { Button } from "@/components/ui/button";

function TypingDots() {
  const t = useT();
  return (
    <div className="flex h-8 items-center gap-1.5" role="status" aria-label={t("typing")}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-2 animate-dot rounded-full bg-brand-400"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}

function EmergencyBanner() {
  const t = useT();
  return (
    <div className="flex animate-rise items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 shadow-[0_0_0_1px_rgb(var(--rgb-danger)/0.12),0_12px_32px_-16px_rgb(var(--rgb-danger)/0.55)]">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-red-600 text-white shadow-[0_0_18px_-2px_rgb(var(--rgb-danger)/0.7)]">
        <Phone className="size-4" />
      </span>
      <div className="text-sm leading-snug text-red-900">
        <p className="font-display font-bold">{t("emergency_title")}</p>
        <p className="mt-0.5 text-pretty">
          {t("emergency_1")}{" "}
          <a
            href="tel:112"
            className="focus-ring rounded-sm font-bold underline underline-offset-2 transition-colors hover:text-white"
          >
            112
          </a>
          {t("emergency_2")}
        </p>
      </div>
    </div>
  );
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="md prose prose-invert max-w-none prose-headings:font-display prose-headings:tracking-tight prose-h1:text-xl prose-h2:text-lg prose-h3:text-base prose-p:my-2.5 prose-a:text-brand-300 prose-a:transition-colors prose-a:hover:text-brand-400 prose-strong:text-ink-900 prose-ul:my-2.5 prose-ol:my-2.5 prose-li:my-0.5 prose-table:text-[13px] prose-hr:my-4">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="scroll-quiet overflow-x-auto rounded-xl border border-line">
              <table className="!my-0">{children}</table>
            </div>
          ),
          // Model output is text only; never render remote images from markdown.
          img: () => null,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

const SMALL_BUTTON =
  "focus-ring flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md text-ink-500 transition-[background-color,color,opacity] duration-200 hover:bg-fill-hover hover:text-ink-900 disabled:pointer-events-none disabled:opacity-35";

/** "2/3" with arrows: the alternatives at one point of the conversation. */
function BranchNav({
  message,
  siblings,
  onSelect,
}: {
  message: Message;
  siblings: string[];
  onSelect: (parent: string, childId: string) => void;
}) {
  const t = useT();
  const index = siblings.indexOf(message.id);
  const count = siblings.length;
  const go = (step: number) => {
    const target = siblings[index + step];
    if (target) onSelect(parentKey(message), target);
  };
  return (
    <div
      className="flex items-center text-[12px] font-medium tabular-nums text-ink-500"
      role="group"
      aria-label={t("branch_label", { index: index + 1, count })}
    >
      <button
        type="button"
        onClick={() => go(-1)}
        disabled={index <= 0}
        className={SMALL_BUTTON}
        aria-label={t("branch_previous")}
        title={t("branch_previous")}
      >
        <ChevronLeft className="size-3.5" />
      </button>
      <span className="px-0.5" aria-hidden>
        {index + 1}/{count}
      </span>
      <button
        type="button"
        onClick={() => go(1)}
        disabled={index >= count - 1}
        className={SMALL_BUTTON}
        aria-label={t("branch_next")}
        title={t("branch_next")}
      >
        <ChevronRight className="size-3.5" />
      </button>
    </div>
  );
}

/** A question being rewritten, in place of its bubble. */
function EditForm({
  initial,
  allowEmpty,
  canSend,
  onCancel,
  onSend,
}: {
  initial: string;
  allowEmpty: boolean;
  canSend: boolean;
  onCancel: () => void;
  onSend: (text: string) => void;
}) {
  const t = useT();
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [text]);

  const ready = canSend && (text.trim().length > 0 || allowEmpty);
  const submit = () => {
    if (ready) onSend(text.trim());
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (enterSends(e)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="fx-bubble w-full rounded-2xl rounded-br-md border border-line-strong p-2">
      <textarea
        ref={ref}
        value={text}
        rows={1}
        maxLength={6000}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label={t("edit_message")}
        className="scroll-quiet block w-full resize-none bg-transparent px-2 py-1.5 text-[15px] leading-relaxed text-ink-900 outline-none"
      />
      <div className="mt-1.5 flex items-center justify-end gap-x-2 px-1 pb-0.5">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button size="sm" onClick={submit} disabled={!ready} title={t("send_hint")}>
          {t("send")}
        </Button>
      </div>
    </div>
  );
}

type Props = {
  message: Message;
  /** Ids of this message and its alternatives at the same point, oldest first; absent when it has none */
  siblings?: string[];
  /** Rewrite a question (absent while a reply is streaming) */
  onEdit?: (messageId: string, text: string) => void;
  /** Ask the question before this reply again (offered on the last reply only) */
  onRegenerate?: (messageId: string) => void;
  onSelectBranch?: (parent: string, childId: string) => void;
  /** Render the tool cards; off by default so the chat reads like a plain reply */
  showTools?: boolean;
};

function ChatMessageView({
  message,
  siblings,
  onEdit,
  onRegenerate,
  onSelectBranch,
  showTools = false,
}: Props) {
  const t = useT();
  const [editing, setEditing] = useState(false);

  if (message.role === "user") {
    const attachments = message.attachments ?? [];
    return (
      <div className="group flex animate-rise flex-col items-end gap-2">
        {attachments.length > 0 && (
          <div className="flex max-w-[85%] flex-wrap justify-end gap-2">
            {attachments.map((a) =>
              a.mediaType === "pdf" ? (
                <div
                  key={a.imageId}
                  className="fx-bubble flex max-w-full items-center gap-3 rounded-xl px-3 py-2.5"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-fill-hover text-brand-300 ring-1 ring-line">
                    <FileText className="size-[18px]" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-ink-900">
                      {a.filename}
                    </span>
                    <span className="block text-[12px] text-ink-500">
                      {t("pdf_document")}
                      {a.pages
                        ? ` · ${a.pages === 1 ? t("pdf_page_one") : t("pdf_pages", { count: a.pages })}`
                        : ""}
                    </span>
                  </span>
                </div>
              ) : (
                <ImageAttachment
                  key={a.imageId}
                  imageId={a.imageId}
                  alt={t("attached_image_alt", { name: a.filename })}
                  caption={a.filename}
                  sizeClassName="max-h-56 max-w-full sm:max-w-xs"
                />
              ),
            )}
          </div>
        )}

        {editing ? (
          <EditForm
            initial={message.text ?? ""}
            allowEmpty={attachments.length > 0}
            canSend={Boolean(onEdit)}
            onCancel={() => setEditing(false)}
            onSend={(text) => {
              setEditing(false);
              onEdit?.(message.id, text);
            }}
          />
        ) : (
          <>
            {message.text && (
              <div className="fx-bubble max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md px-4 py-2.5 text-[15px] leading-relaxed text-ink-900">
                {message.text}
              </div>
            )}
            {(siblings || onEdit) && (
              <div className="-mt-0.5 flex items-center gap-1">
                {siblings && onSelectBranch && (
                  <BranchNav message={message} siblings={siblings} onSelect={onSelectBranch} />
                )}
                {onEdit && (
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className={cn(
                      SMALL_BUTTON,
                      // With a mouse the pencil shows on hover; on a touch screen it stays visible.
                      "pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100",
                    )}
                    aria-label={t("edit_message")}
                    title={t("edit_message")}
                  >
                    <Pencil className="size-3.5" />
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  const parts = message.parts ?? [];
  const hasContent = parts.length > 0;
  const lastPart = parts[parts.length - 1];
  // Typing dots while nothing visible is happening: before any content, after a
  // finished tool, and (with cards hidden) while a tool is still running.
  const waitingForText =
    message.pending &&
    (!hasContent || (lastPart?.type === "tool" && (lastPart.state === "done" || !showTools)));
  const canRegenerate = Boolean(onRegenerate) && !message.pending && !message.error;
  const footer = !message.pending && (siblings || canRegenerate);

  return (
    <div className="flex animate-rise gap-3 @2xl:gap-4">
      <LogoMark className="mt-0.5 size-8 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1 space-y-3.5">
        {message.emergency && <EmergencyBanner />}

        {parts.map((part, index) =>
          part.type === "text" ? (
            part.text.trim() ? (
              <div key={index} className="pt-1">
                <Markdown text={part.text} />
              </div>
            ) : null
          ) : showTools ? (
            <ToolResult key={part.toolUseId} part={part} />
          ) : null,
        )}

        {waitingForText && <TypingDots />}

        {message.notice && (
          <div className="flex animate-fade items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <Info className="mt-0.5 size-4 shrink-0" />
            <span className="text-pretty">{message.notice}</span>
          </div>
        )}

        {message.stopped && !message.error && (
          <p className="animate-fade text-[13px] text-ink-400">{t("reply_stopped")}</p>
        )}

        {message.error && (
          <div
            className="flex animate-rise flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            role="alert"
          >
            <CircleAlert className="size-4 shrink-0" />
            <span className="min-w-0 flex-1">{message.error}</span>
            {onRegenerate && (
              <Button variant="destructive" size="sm" onClick={() => onRegenerate(message.id)}>
                <RotateCcw className="size-3.5" />
                {t("retry")}
              </Button>
            )}
          </div>
        )}

        {footer && (
          <div className="flex items-center gap-1">
            {siblings && onSelectBranch && (
              <BranchNav message={message} siblings={siblings} onSelect={onSelectBranch} />
            )}
            {canRegenerate && (
              <button
                type="button"
                onClick={() => onRegenerate?.(message.id)}
                className={cn(SMALL_BUTTON, "gap-1.5 px-2 text-[12px] font-medium")}
                title={t("regenerate")}
              >
                <RefreshCw className="size-3.5" />
                {t("regenerate")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(ChatMessageView);
