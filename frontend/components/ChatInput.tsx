"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  CircleAlert,
  FileText,
  ImagePlus,
  LoaderCircle,
  Paperclip,
  Square,
  X,
} from "lucide-react";

import { ApiError, uploadImage } from "@/lib/api";
import { useT, type MessageKey } from "@/lib/i18n";
import type { Attachment } from "@/lib/types";
import { cn, newId } from "@/lib/utils";

const ACCEPT = "image/png,image/jpeg,image/webp,image/bmp,application/pdf";
const isPdf = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);
const isAccepted = (file: File) => file.type.startsWith("image/") || isPdf(file);
const MAX_FILES = 4;
const MAX_BYTES = 10 * 1024 * 1024;
/** Badge for what the server recognised in the picture ("unknown" shows nothing). */
const CONTENT_LABELS: Record<string, MessageKey> = {
  xray: "content_xray",
  scan: "content_scan",
  document: "content_document",
  photo: "content_photo",
};

type Pending = {
  key: string;
  name: string;
  pdf: boolean;
  previewUrl: string;
  status: "uploading" | "ready" | "error";
  error?: string;
  attachment?: Attachment;
};

type Props = {
  conversationId: string;
  sessionId: string;
  busy: boolean;
  disabled?: boolean;
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
};

export default function ChatInput({
  conversationId,
  sessionId,
  busy,
  disabled,
  onSend,
  onStop,
}: Props) {
  const t = useT();
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const conversationRef = useRef(conversationId);
  const countRef = useRef(0);
  // Drag enter/leave fire for every child; count them so the highlight never flickers.
  const dragDepthRef = useRef(0);

  useEffect(() => {
    countRef.current = pending.length;
  }, [pending]);

  // Attachments belong to one conversation: reset when it changes.
  useEffect(() => {
    conversationRef.current = conversationId;
    setPending((items) => {
      items.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      return [];
    });
    setText("");
    textareaRef.current?.focus();
  }, [conversationId]);

  // Auto-grow the textarea.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const addFiles = useCallback(
    (files: File[]) => {
      const images = files.filter(isAccepted);
      if (images.length === 0) return;

      const room = Math.max(0, MAX_FILES - countRef.current);
      const accepted = images.slice(0, room).map<Pending>((file) => {
        const key = newId();
        const item: Pending = {
          key,
          name: file.name,
          pdf: isPdf(file),
          previewUrl: URL.createObjectURL(file),
          status: "uploading",
        };
        if (file.size > MAX_BYTES) {
          return { ...item, status: "error", error: t("file_too_large") };
        }
        const targetConversation = conversationId;
        uploadImage(file, conversationId, sessionId)
          .then((attachment) => {
            if (conversationRef.current !== targetConversation) return;
            setPending((list) =>
              list.map((p) => (p.key === key ? { ...p, status: "ready", attachment } : p)),
            );
          })
          .catch((err) => {
            const message = err instanceof ApiError ? err.message : t("upload_failed");
            setPending((list) =>
              list.map((p) => (p.key === key ? { ...p, status: "error", error: message } : p)),
            );
          });
        return item;
      });
      countRef.current += accepted.length;
      setPending((current) => [...current, ...accepted]);
    },
    [conversationId, sessionId, t],
  );

  const remove = (key: string) =>
    setPending((list) => {
      const item = list.find((p) => p.key === key);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return list.filter((p) => p.key !== key);
    });

  const uploading = pending.some((p) => p.status === "uploading");
  const ready = pending.filter((p) => p.status === "ready" && p.attachment);
  const canSend = !busy && !disabled && !uploading && (text.trim().length > 0 || ready.length > 0);

  const submit = () => {
    if (!canSend) return;
    onSend(
      text.trim(),
      ready.map((p) => p.attachment!),
    );
    pending.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    setPending([]);
    setText("");
  };

  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");

  return (
    <div
      data-dragging={dragging || undefined}
      className="fx-glass relative rounded-[1.25rem] border border-line bg-card shadow-lift"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepthRef.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (hasFiles(e)) e.preventDefault();
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepthRef.current = 0;
        setDragging(false);
        addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {dragging && (
        <div
          className="pointer-events-none absolute inset-0 z-10 flex animate-fade items-center justify-center gap-2.5 rounded-[1.25rem] bg-base/70 text-sm font-medium text-ink-900 backdrop-blur-sm"
          aria-hidden
        >
          <span className="flex size-9 items-center justify-center rounded-xl bg-brand-400/15 text-brand-300 ring-1 ring-brand-400/40">
            <ImagePlus className="size-[18px]" />
          </span>
          {t("drop_here")}
        </div>
      )}

      {pending.length > 0 && (
        <ul className="flex flex-wrap gap-3 px-3 pt-3">
          {pending.map((p) => {
            const contentKey = CONTENT_LABELS[p.attachment?.content ?? ""];
            return (
              <li key={p.key} className="relative animate-pop">
                <div
                  className={cn(
                    "relative size-[4.5rem] overflow-hidden rounded-xl bg-black ring-1 transition-shadow duration-200",
                    p.status === "error" ? "ring-red-300" : "ring-white/15",
                  )}
                  title={p.error ?? p.name}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {p.pdf ? (
                    <span className="flex size-full flex-col items-center justify-center gap-1 bg-fill-hover text-ink-700">
                      <FileText className="size-6" />
                      <span className="text-[10px] font-semibold uppercase tracking-wide">PDF</span>
                    </span>
                  ) : (
                    <img src={p.previewUrl} alt={p.name} className="size-full object-cover" />
                  )}
                  {p.status === "ready" && !p.pdf && contentKey && (
                    <span className="absolute inset-x-0 bottom-0 animate-fade bg-black/65 px-1 py-0.5 text-center text-[9.5px] font-semibold uppercase tracking-wider text-white/90 backdrop-blur-sm">
                      {t(contentKey)}
                    </span>
                  )}
                  {p.status === "uploading" && (
                    <span className="absolute inset-0 flex animate-fade items-center justify-center bg-black/55 text-white backdrop-blur-[2px]">
                      <LoaderCircle className="size-5 animate-spin" />
                    </span>
                  )}
                  {p.status === "error" && (
                    <span className="absolute inset-0 flex items-center justify-center bg-red-900/70 text-white">
                      <CircleAlert className="size-5" />
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => remove(p.key)}
                  className="focus-ring absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-black text-white shadow-soft ring-2 ring-card transition-[scale,background-color] duration-200 ease-spring hover:scale-110 hover:bg-red-600 active:scale-95"
                  aria-label={t("remove_file", { name: p.name })}
                >
                  <X className="size-3" />
                </button>
                {p.status === "error" && (
                  <p className="mt-1 w-[4.5rem] text-[10.5px] leading-tight text-red-700">{p.error}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-end gap-2 p-2">
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || pending.length >= MAX_FILES}
          className="focus-ring flex size-9 shrink-0 items-center justify-center rounded-xl text-ink-500 transition-[background-color,color,scale] duration-200 ease-out-quart hover:bg-fill-hover hover:text-ink-900 active:scale-95 disabled:opacity-40"
          aria-label={t("attach")}
          title={t("attach_hint")}
        >
          <Paperclip className="size-[18px]" />
        </button>

        <textarea
          ref={textareaRef}
          value={text}
          rows={1}
          disabled={disabled}
          maxLength={6000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.some(isAccepted)) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          placeholder={t("composer_placeholder")}
          aria-label={t("composer_label")}
          className="scroll-quiet max-h-[200px] min-h-9 flex-1 resize-none bg-transparent px-1 py-1.5 text-[15px] leading-6 text-ink-900 outline-none transition-opacity duration-200 placeholder:text-ink-400 disabled:opacity-60"
        />

        {busy ? (
          <button
            type="button"
            onClick={onStop}
            className="focus-ring flex size-9 shrink-0 animate-pop items-center justify-center rounded-xl bg-primary text-black shadow-sm transition-[scale,background-color] duration-200 ease-out-quart hover:scale-105 hover:bg-primary-hover active:scale-95"
            aria-label={t("stop_reply")}
            title={t("stop")}
          >
            <Square className="size-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            className="fx-primary focus-ring group flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-black shadow-sm hover:bg-primary-hover active:scale-95 disabled:bg-fill-hover disabled:text-ink-400 disabled:shadow-none"
            aria-label={t("send")}
            title={t("send_hint")}
          >
            {uploading ? (
              <LoaderCircle className="size-5 animate-spin" />
            ) : (
              <ArrowUp
                className="size-[18px] transition-[translate] duration-200 ease-out-quart group-hover:group-enabled:-translate-y-0.5"
                strokeWidth={2.4}
              />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
