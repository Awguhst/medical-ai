"use client";

import { useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { MessageSquare, MessagesSquare, Plus, Settings as SettingsIcon, Trash2, X } from "lucide-react";

import type { Conversation } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";

export const SIDEBAR_MIN = 240;
export const SIDEBAR_MAX = 480;
export const SIDEBAR_DEFAULT = 288;

const clampWidth = (value: number) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(value)));

/** Desktop width follows the stored setting but never crowds out the chat. */
const DESKTOP_WIDTH = "lg:w-[clamp(15rem,var(--sidebar-w),45vw)]";
const DRAWER_WIDTH = "w-[min(19rem,86vw)]";

type Props = {
  conversations: Conversation[];
  activeId: string;
  /** Mobile drawer state */
  open: boolean;
  /** Desktop: hidden completely */
  collapsed: boolean;
  /** Desktop width in px */
  width: number;
  onResize: (width: number) => void;
  onResizeEnd: (width: number) => void;
  onClose: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenSettings: () => void;
};

export default function Sidebar({
  conversations,
  activeId,
  open,
  collapsed,
  width,
  onResize,
  onResizeEnd,
  onClose,
  onNew,
  onSelect,
  onDelete,
  onOpenSettings,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);

  const startDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const drag = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging) onResize(clampWidth(e.clientX));
  };
  const endDrag = () => {
    if (!dragging) return;
    setDragging(false);
    onResizeEnd(width);
  };
  const resizeWithKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    const next =
      e.key === "ArrowLeft"
        ? width - 16
        : e.key === "ArrowRight"
          ? width + 16
          : e.key === "Home"
            ? SIDEBAR_MIN
            : e.key === "End"
              ? SIDEBAR_MAX
              : null;
    if (next === null) return;
    e.preventDefault();
    onResize(clampWidth(next));
    onResizeEnd(clampWidth(next));
  };

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-30 bg-black/65 backdrop-blur-sm transition-opacity duration-300 ease-out-quart lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
        aria-hidden
      />

      <aside
        style={{ "--sidebar-w": `${width}px` } as CSSProperties}
        className={cn(
          "fx-sidebar fixed inset-y-0 left-0 z-40 flex shrink-0 flex-col overflow-hidden border-r border-line lg:static lg:z-auto lg:translate-x-0 lg:shadow-none",
          DRAWER_WIDTH,
          dragging
            ? "transition-none"
            : "transition-[translate,width,visibility] duration-300 ease-out-quart",
          open ? "translate-x-0 shadow-float" : "-translate-x-full",
          collapsed ? "lg:invisible lg:w-0 lg:border-r-0" : DESKTOP_WIDTH,
        )}
        aria-label="Странично меню"
      >
        {/* Fixed-width inner column so content does not reflow while collapsing */}
        <div className={cn("flex h-full shrink-0 flex-col", DRAWER_WIDTH, DESKTOP_WIDTH)}>
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
            <Logo />
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="-mr-1.5 lg:hidden"
              aria-label="Затвори менюто"
            >
              <X className="size-5" />
            </Button>
          </div>

          <div className="px-3 pt-3">
            <button
              type="button"
              onClick={onNew}
              className="fx-card focus-ring group flex h-11 w-full items-center gap-3 rounded-xl border border-line px-2.5 text-left text-sm font-medium text-ink-900 hover:border-line-strong active:scale-[0.98]"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-fill-hover text-brand-300 ring-1 ring-line transition-[rotate,background-color,color,box-shadow] duration-300 ease-out-quart group-hover:rotate-90 group-hover:bg-primary group-hover:text-black group-hover:shadow-[0_4px_12px_-4px_rgb(255_255_255/0.5)]">
                <Plus className="size-4" strokeWidth={2.4} />
              </span>
              Нов разговор
            </button>
          </div>

          <div className="flex items-center justify-between px-5 pb-2 pt-5">
            <span className="eyebrow">История на разговорите</span>
            {sorted.length > 0 && (
              <span className="rounded-md bg-fill-hover px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-ink-500">
                {sorted.length}
              </span>
            )}
          </div>

          <nav className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {sorted.length === 0 ? (
              <div className="mx-0.5 flex flex-col items-center gap-3 rounded-xl border border-dashed border-line px-4 py-7 text-center">
                <span className="flex size-10 items-center justify-center rounded-xl bg-fill text-ink-400 ring-1 ring-line">
                  <MessagesSquare className="size-[18px]" />
                </span>
                <p className="text-pretty text-[12.5px] leading-relaxed text-ink-400">
                  Все още няма разговори. Историята се пази само в този раздел на браузъра.
                </p>
              </div>
            ) : (
              <ul className="space-y-1">
                {sorted.map((c) => {
                  const active = c.id === activeId;
                  return (
                    <li key={c.id} className="group relative animate-fade">
                      <button
                        type="button"
                        onClick={() => onSelect(c.id)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "focus-ring relative flex h-10 w-full items-center gap-2.5 rounded-lg pl-3 pr-9 text-left text-[13.5px] transition-[background-color,color,box-shadow] duration-200 ease-out-quart",
                          "before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-gradient-to-b before:from-brand-300 before:to-teal-400 before:transition-[opacity,scale] before:duration-300 before:ease-out-quart",
                          active
                            ? "bg-fill-hover font-medium text-ink-900 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] ring-1 ring-line before:opacity-100"
                            : "text-ink-700 before:scale-y-0 before:opacity-0 hover:bg-fill hover:text-ink-900",
                        )}
                      >
                        <MessageSquare
                          className={cn(
                            "size-4 shrink-0 transition-colors duration-200",
                            active ? "text-brand-300" : "text-ink-400 group-hover:text-ink-500",
                          )}
                        />
                        <span className="truncate">{c.title}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(c.id)}
                        className="focus-ring absolute right-1 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-ink-400 opacity-0 transition-[opacity,background-color,color,scale] duration-200 ease-out-quart hover:bg-red-100 hover:text-red-700 focus-visible:opacity-100 active:scale-90 group-hover:opacity-100 max-lg:opacity-100"
                        aria-label={`Изтрий разговора „${c.title}“`}
                        title="Изтрий разговора"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </nav>

          <div className="border-t border-line p-3">
            <button
              type="button"
              onClick={onOpenSettings}
              className="focus-ring group flex h-10 w-full items-center gap-2.5 rounded-lg px-3 text-[13.5px] text-ink-700 transition-[background-color,color] duration-200 ease-out-quart hover:bg-fill-hover hover:text-ink-900 active:scale-[0.98]"
            >
              <SettingsIcon className="size-4 text-ink-500 transition-[rotate,color] duration-500 ease-out-quart group-hover:rotate-90 group-hover:text-ink-700" />
              Настройки
            </button>
          </div>
        </div>
      </aside>

      {/* Desktop resize handle, straddling the sidebar edge */}
      {!collapsed && (
        <div className="relative z-30 hidden w-0 lg:block">
          <div
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label="Преоразмери страничното меню"
            aria-valuenow={width}
            aria-valuemin={SIDEBAR_MIN}
            aria-valuemax={SIDEBAR_MAX}
            title="Плъзнете за преоразмеряване, двоен клик за връщане"
            onPointerDown={startDrag}
            onPointerMove={drag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDoubleClick={() => {
              onResize(SIDEBAR_DEFAULT);
              onResizeEnd(SIDEBAR_DEFAULT);
            }}
            onKeyDown={resizeWithKeys}
            className="group absolute inset-y-0 -left-1.5 w-3 cursor-col-resize touch-none outline-none"
          >
            <span
              className={cn(
                "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-[background-color,width] duration-200 ease-out-quart group-hover:bg-brand-400/40 group-focus-visible:w-0.5 group-focus-visible:bg-brand-400/70",
                dragging ? "w-0.5 bg-brand-400/60" : "bg-transparent",
              )}
            />
          </div>
        </div>
      )}
    </>
  );
}
