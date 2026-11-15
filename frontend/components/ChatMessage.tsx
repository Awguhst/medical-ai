"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CircleAlert, FileText, Info, Phone, RotateCcw } from "lucide-react";

import type { ChatMessage as Message, ToolPart } from "@/lib/types";
import { LogoMark } from "@/components/Logo";
import ImageAttachment from "@/components/ImageAttachment";
import ToolResult from "@/components/ToolResult";
import { Button } from "@/components/ui/button";

function TypingDots() {
  return (
    <div className="flex h-8 items-center gap-1.5" role="status" aria-label="MedAI пише">
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
  return (
    <div className="flex animate-rise items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 shadow-[0_0_0_1px_rgb(239_68_68/0.12),0_12px_32px_-16px_rgb(239_68_68/0.55)]">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-red-600 text-white shadow-[0_0_18px_-2px_rgb(239_68_68/0.7)]">
        <Phone className="size-4" />
      </span>
      <div className="text-sm leading-snug text-red-900">
        <p className="font-display font-bold">Възможен спешен случай</p>
        <p className="mt-0.5 text-pretty">
          Ако състоянието е тежко или се влошава, обадете се незабавно на{" "}
          <a
            href="tel:112"
            className="focus-ring rounded-sm font-bold underline underline-offset-2 transition-colors hover:text-white"
          >
            112
          </a>
          . Не чакайте отговор от MedAI.
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

/** With tool activity hidden, the only output worth showing is a picture the
    reply text cannot carry: the annotated X-ray. Everything else is in the words. */
function QuietToolOutput({ part }: { part: ToolPart }) {
  const result = part.state === "done" ? part.result : undefined;
  if (!result?.annotated_image_id) return null;
  return (
    <div className="animate-rise pt-1">
      <ImageAttachment
        imageId={result.annotated_image_id}
        alt={
          result.simulated
            ? "Демо изображение със симулирани рамки"
            : "Рентгенова снимка с отбелязани области"
        }
        caption={result.simulated ? "Демо: симулирани рамки, без медицинско значение" : undefined}
        sizeClassName="max-h-[26rem] max-w-full"
      />
    </div>
  );
}

type Props = {
  message: Message;
  onRetry?: () => void;
  /** Render the tool cards; off by default so the chat reads like a plain reply */
  showTools?: boolean;
};

function ChatMessageView({ message, onRetry, showTools = false }: Props) {
  if (message.role === "user") {
    const attachments = message.attachments ?? [];
    return (
      <div className="flex animate-rise flex-col items-end gap-2">
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
                      PDF документ{a.pages ? ` · ${a.pages} стр.` : ""}
                    </span>
                  </span>
                </div>
              ) : (
                <ImageAttachment
                  key={a.imageId}
                  imageId={a.imageId}
                  alt={`Прикачено изображение: ${a.filename}`}
                  caption={a.filename}
                  sizeClassName="max-h-56 max-w-full sm:max-w-xs"
                />
              ),
            )}
          </div>
        )}
        {message.text && (
          <div className="fx-bubble max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md px-4 py-2.5 text-[15px] leading-relaxed text-ink-900">
            {message.text}
          </div>
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
          ) : (
            <QuietToolOutput key={part.toolUseId} part={part} />
          ),
        )}

        {waitingForText && <TypingDots />}

        {message.notice && (
          <div className="flex animate-fade items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <Info className="mt-0.5 size-4 shrink-0" />
            <span className="text-pretty">{message.notice}</span>
          </div>
        )}

        {message.stopped && !message.error && (
          <p className="animate-fade text-[13px] text-ink-400">Отговорът беше спрян.</p>
        )}

        {message.error && (
          <div
            className="flex animate-rise flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            role="alert"
          >
            <CircleAlert className="size-4 shrink-0" />
            <span className="min-w-0 flex-1">{message.error}</span>
            {onRetry && (
              <Button variant="destructive" size="sm" onClick={onRetry}>
                <RotateCcw className="size-3.5" />
                Опитай отново
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(ChatMessageView);
