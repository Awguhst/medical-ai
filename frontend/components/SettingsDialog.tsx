"use client";

import { useState } from "react";
import { Check, Languages, Palette, ShieldOff, Trash2, Wrench } from "lucide-react";

import { useT, type MessageKey } from "@/lib/i18n";
import { LANGUAGE_OPTIONS, THEME_OPTIONS, type ThemeOption } from "@/lib/preferences";
import type { Health, Settings } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

const READER_LABELS: Record<Health["image_reader"]["status"], MessageKey> = {
  ready: "reader_ready",
  not_configured: "reader_not_configured",
  disabled: "reader_disabled",
};

const TRIAGE_LABELS: Record<NonNullable<Health["image_triage"]>["status"], MessageKey> = {
  ready: "triage_ready",
  loading: "triage_loading",
  disabled: "triage_disabled",
  not_installed: "triage_not_installed",
  error: "triage_error",
};

function StatusRow({ label, value, ok }: { label: string; value: string; ok: boolean | null }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <span className="shrink-0 whitespace-nowrap text-sm text-ink-500">{label}</span>
      <span className="flex min-w-0 items-start gap-2 text-right text-sm font-medium text-ink-900">
        <span
          className={cn(
            "mt-1.5 size-2 shrink-0 rounded-full transition-[background-color,box-shadow] duration-300 ease-out-quart",
            ok === null
              ? "bg-slate-300"
              : ok
                ? "bg-teal-500 shadow-[0_0_0_3px_rgb(var(--rgb-ok)/0.18)]"
                : "bg-amber-500 shadow-[0_0_0_3px_rgb(var(--rgb-warn)/0.18)]",
          )}
        />
        {value}
      </span>
    </div>
  );
}

/** A miniature of the theme: page, a card on it, and its two accent colours. */
function ThemeSwatch({ swatch }: { swatch: ThemeOption["swatch"] }) {
  return (
    <span
      className="relative block h-14 w-full overflow-hidden rounded-lg ring-1 ring-black/40"
      style={{ background: swatch.base }}
      aria-hidden
    >
      <span className="absolute left-2 top-2 size-2 rounded-full" style={{ background: swatch.accent }} />
      <span className="absolute left-[18px] top-2 size-2 rounded-full" style={{ background: swatch.alt }} />
      <span
        className="absolute inset-x-2 bottom-2 top-[22px] rounded-md"
        style={{ background: swatch.card, boxShadow: `inset 0 0 0 1px rgb(255 255 255 / 0.08)` }}
      >
        <span
          className="absolute left-2 top-2 h-1 w-7 rounded-full"
          style={{ background: swatch.accent, opacity: 0.9 }}
        />
        <span className="absolute left-2 top-[18px] h-1 w-10 rounded-full bg-white/25" />
      </span>
    </span>
  );
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  health: Health | null;
  backendDown: boolean;
  consent: boolean;
  onRevokeConsent: () => void;
  onClearHistory: () => void;
  conversationCount: number;
};

export default function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onSettingsChange,
  health,
  backendDown,
  consent,
  onRevokeConsent,
  onClearHistory,
  conversationCount,
}: Props) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const readerReady = health?.image_reader.status === "ready";
  const triage = health?.image_triage;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setConfirming(false);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("settings")}</DialogTitle>
          <DialogDescription>{t("settings_description")}</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-6">
          <section>
            <h3 className="eyebrow">{t("section_appearance")}</h3>
            <div className="mt-2 space-y-4 rounded-xl border border-line bg-fill p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <span className="flex items-start gap-2.5">
                  <Languages className="mt-0.5 size-4 shrink-0 text-ink-500" />
                  <span>
                    <span id="language-label" className="block text-sm font-semibold text-ink-900">
                      {t("language")}
                    </span>
                    <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-500">
                      {t("language_hint")}
                    </span>
                  </span>
                </span>
                <div
                  role="radiogroup"
                  aria-labelledby="language-label"
                  className="grid shrink-0 grid-cols-2 gap-1 rounded-xl border border-line bg-surface/60 p-1"
                >
                  {LANGUAGE_OPTIONS.map((option) => {
                    const selected = settings.language === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        lang={option.value}
                        onClick={() => onSettingsChange({ ...settings, language: option.value })}
                        className={cn(
                          "focus-ring h-8 min-w-24 rounded-lg px-3 text-[13px] font-medium transition-[background-color,color,box-shadow,scale] duration-200 ease-out-quart active:scale-[0.97]",
                          selected
                            ? "bg-primary text-black shadow-sm"
                            : "text-ink-700 hover:bg-fill-hover hover:text-ink-900",
                        )}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="border-t border-line pt-4">
                <span className="flex items-start gap-2.5">
                  <Palette className="mt-0.5 size-4 shrink-0 text-ink-500" />
                  <span>
                    <span id="theme-label" className="block text-sm font-semibold text-ink-900">
                      {t("theme")}
                    </span>
                    <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-500">
                      {t("theme_hint")}
                    </span>
                  </span>
                </span>
                <div role="radiogroup" aria-labelledby="theme-label" className="mt-3 grid grid-cols-3 gap-2">
                  {THEME_OPTIONS.map((option) => {
                    const selected = settings.theme === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => onSettingsChange({ ...settings, theme: option.value })}
                        className={cn(
                          "focus-ring group relative rounded-xl border p-2 text-left transition-[border-color,background-color,box-shadow,translate] duration-300 ease-out-quart hover:-translate-y-0.5 active:translate-y-0",
                          selected
                            ? "border-brand-400/70 bg-fill-hover shadow-[0_0_0_3px_rgb(var(--rgb-glow-1)/0.14)]"
                            : "border-line bg-surface/40 hover:border-line-strong hover:bg-fill-hover",
                        )}
                      >
                        <ThemeSwatch swatch={option.swatch} />
                        <span className="mt-2 flex items-center justify-between gap-1">
                          <span className="truncate text-[13px] font-semibold text-ink-900">
                            {t(`theme_${option.value}`)}
                          </span>
                          <span
                            className={cn(
                              "flex size-4 shrink-0 items-center justify-center rounded-full transition-[background-color,scale] duration-200 ease-spring",
                              selected ? "scale-100 bg-brand-400 text-black" : "scale-0 bg-transparent",
                            )}
                            aria-hidden
                          >
                            <Check className="size-3" strokeWidth={3} />
                          </span>
                        </span>
                        <span className="mt-0.5 hidden text-[11px] leading-snug text-ink-500 sm:block">
                          {t(`theme_${option.value}_hint`)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          <section>
            <h3 className="eyebrow">{t("section_status")}</h3>
            <div className="mt-2 divide-y divide-line rounded-xl border border-line bg-fill px-4">
              <StatusRow
                label={t("status_server")}
                value={
                  backendDown
                    ? t("status_no_connection")
                    : health
                      ? t("status_running")
                      : t("status_checking")
                }
                ok={backendDown ? false : health ? true : null}
              />
              <StatusRow
                label={t("status_claude")}
                value={
                  health
                    ? health.claude_configured
                      ? health.claude_model
                      : t("status_missing_key")
                    : t("status_no_data")
                }
                ok={health ? health.claude_configured : null}
              />
              <StatusRow
                label={t("status_image_reader")}
                value={health ? t(READER_LABELS[health.image_reader.status]) : t("status_no_data")}
                ok={health ? readerReady : null}
              />
              <StatusRow
                label={t("status_triage")}
                value={triage ? t(TRIAGE_LABELS[triage.status]) : t("status_no_data")}
                ok={!triage ? null : triage.status === "ready" ? true : triage.status === "loading" ? null : false}
              />
            </div>
          </section>

          <section>
            <h3 className="eyebrow">{t("section_view")}</h3>
            <div className="mt-2 rounded-xl border border-line bg-fill p-4">
              <div className="flex items-start justify-between gap-4">
                <label htmlFor="show-tools" className="flex cursor-pointer items-start gap-2.5">
                  <Wrench className="mt-0.5 size-4 shrink-0 text-ink-500" />
                  <span>
                    <span className="block text-sm font-semibold text-ink-900">
                      {t("show_tools_title")}
                    </span>
                    <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-500">
                      {t("show_tools_text")}
                    </span>
                  </span>
                </label>
                <Switch
                  id="show-tools"
                  checked={settings.showToolActivity}
                  onCheckedChange={(showToolActivity) =>
                    onSettingsChange({ ...settings, showToolActivity })
                  }
                />
              </div>
            </div>
          </section>

          <section>
            <h3 className="eyebrow">{t("section_privacy")}</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-500">{t("privacy_text")}</p>

            <div className="mt-3 flex flex-col gap-2">
              {confirming ? (
                <div className="animate-pop rounded-xl border border-red-200 bg-red-50 p-3.5">
                  <p className="text-sm font-medium text-red-900">{t("confirm_delete")}</p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      className="border-red-600 bg-red-600 text-white hover:bg-red-500"
                      onClick={() => {
                        onClearHistory();
                        setConfirming(false);
                      }}
                    >
                      {t("confirm_delete_yes")}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>
                      {t("cancel")}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="destructive"
                  className="justify-start"
                  onClick={() => setConfirming(true)}
                  disabled={conversationCount === 0}
                >
                  <Trash2 className="size-4" />
                  {t("delete_history")}
                  {conversationCount > 0 && (
                    <span className="ml-auto text-xs font-normal text-red-400">
                      {conversationCount}
                    </span>
                  )}
                </Button>
              )}

              <Button
                variant="outline"
                className="justify-start"
                onClick={onRevokeConsent}
                disabled={!consent}
              >
                <ShieldOff className="size-4" />
                {consent ? t("revoke_consent") : t("consent_not_given")}
              </Button>
            </div>
          </section>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
