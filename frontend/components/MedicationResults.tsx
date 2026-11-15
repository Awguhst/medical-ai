"use client";

import { CircleHelp, ExternalLink, Pill, ShieldAlert, TriangleAlert } from "lucide-react";

import { useT, type MessageKey, type Translate } from "@/lib/i18n";
import type { InteractionCheck, ToolResultData } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Only ever link to Framar itself, whatever the data says. */
function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const onFramar = parsed.hostname === "framar.bg" || parsed.hostname.endsWith(".framar.bg");
    return parsed.protocol === "https:" && onFramar ? parsed.href : null;
  } catch {
    return null;
  }
}

const KIND_LABELS: Record<string, MessageKey> = {
  product: "kind_product",
  active_ingredient: "kind_active_ingredient",
};

type Tone = "red" | "amber" | "neutral";

function describe(check: InteractionCheck, t: Translate): { tone: Tone; label: string; text: string } {
  if (check.status === "documented") {
    if (check.severity === "major") {
      return { tone: "red", label: t("ix_major_label"), text: t("ix_major_text") };
    }
    if (check.severity === "moderate") {
      return { tone: "amber", label: t("ix_moderate_label"), text: t("ix_moderate_text") };
    }
    return {
      tone: "neutral",
      label: check.severity === "minor" ? t("ix_minor_label") : t("ix_documented_label"),
      text: t("ix_documented_text"),
    };
  }
  if (check.same_active_ingredient) {
    return { tone: "amber", label: t("ix_same_label"), text: t("ix_same_text") };
  }
  if (check.status === "none_listed") {
    return { tone: "neutral", label: t("ix_none_label"), text: t("ix_none_text") };
  }
  return { tone: "neutral", label: t("ix_unchecked_label"), text: t("ix_unchecked_text") };
}

const TONE_CLASSES: Record<Tone, { box: string; badge: string; icon: string }> = {
  red: {
    box: "border-red-200 bg-red-50",
    badge: "bg-red-100 text-red-800",
    icon: "text-red-700",
  },
  amber: {
    box: "border-amber-200 bg-amber-50",
    badge: "bg-amber-100 text-amber-800",
    icon: "text-amber-700",
  },
  neutral: {
    box: "border-line bg-fill",
    badge: "bg-fill-hover text-ink-700",
    icon: "text-ink-500",
  },
};

export default function MedicationResults({ result }: { result: ToolResultData }) {
  const t = useT();
  const medications = result.medications ?? [];
  const checks = result.interaction_checks ?? [];

  return (
    <div className="animate-fade space-y-3 border-t border-line p-4">
      {medications.length > 0 && (
        <ul className="grid gap-2">
          {medications.map((med, index) => {
            const url = safeUrl(med.source_url);
            const found = med.status === "found";
            const kind = KIND_LABELS[med.kind ?? ""];
            return (
              <li
                key={`${med.query}-${index}`}
                className="flex items-start gap-3 rounded-xl border border-line bg-fill p-3 transition-[background-color,border-color] duration-200 ease-out-quart hover:border-line-strong hover:bg-fill-hover"
              >
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-line",
                    found ? "bg-fill-hover text-brand-300" : "bg-fill text-ink-400",
                  )}
                  aria-hidden
                >
                  {found ? <Pill className="size-[18px]" /> : <CircleHelp className="size-[18px]" />}
                </span>

                <div className="min-w-0 flex-1">
                  {found ? (
                    <>
                      <p className="break-words font-display text-sm font-bold leading-snug text-ink-900">
                        {med.name}
                      </p>
                      <p className="mt-0.5 text-[12.5px] leading-snug text-ink-500">
                        {kind ? t(kind) : t("kind_reference")}
                        {med.query && med.query.toLowerCase() !== (med.name ?? "").toLowerCase() && (
                          <> {t("searched_for", { query: med.query })}</>
                        )}
                      </p>
                      {(med.active_ingredients ?? []).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {(med.active_ingredients ?? []).map((ingredient) => (
                            <span
                              key={`${ingredient.name}-${ingredient.atc}`}
                              className="rounded-md bg-fill-hover px-2 py-0.5 text-[11.5px] text-ink-700"
                            >
                              {ingredient.name}
                              {ingredient.atc && (
                                <span className="ml-1.5 font-mono text-[10.5px] text-ink-400">
                                  {ingredient.atc}
                                </span>
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="break-words font-display text-sm font-bold leading-snug text-ink-700">
                        {med.query}
                      </p>
                      <p className="mt-0.5 text-[12.5px] leading-snug text-ink-500">
                        {med.status === "unavailable" ? t("med_unavailable") : t("med_not_found")}
                      </p>
                    </>
                  )}
                </div>

                {url && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="focus-ring inline-flex shrink-0 items-center gap-1.5 self-center rounded-lg border border-line bg-fill px-3 py-2 text-[12.5px] font-semibold text-ink-900 transition-[background-color,border-color,scale] duration-200 ease-out-quart hover:border-line-strong hover:bg-fill-hover active:scale-[0.97]"
                    aria-label={t("med_in_framar", { name: med.name ?? med.query })}
                  >
                    <span className="@max-lg:hidden">{t("source")}</span>
                    <ExternalLink className="size-3.5" />
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {checks.length > 0 && (
        <div className="space-y-2">
          <p className="eyebrow">{t("interactions_heading")}</p>
          <ul className="grid gap-2">
            {checks.map((check, index) => {
              const { tone, label, text } = describe(check, t);
              const classes = TONE_CLASSES[tone];
              const url = safeUrl(check.source_url);
              const Icon = tone === "red" ? ShieldAlert : tone === "amber" ? TriangleAlert : CircleHelp;
              return (
                <li key={index} className={cn("rounded-xl border p-3", classes.box)}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                    <Icon className={cn("size-4 shrink-0", classes.icon)} />
                    <p className="min-w-0 break-words text-[13px] font-semibold text-ink-900">
                      {check.between.join(" + ")}
                    </p>
                    <span
                      className={cn(
                        "rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide",
                        classes.badge,
                      )}
                    >
                      {label}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[12.5px] leading-snug text-ink-700">
                    {text}
                    {check.status === "documented" && check.same_active_ingredient && (
                      <> {t("ix_also_same")}</>
                    )}
                    {url && (
                      <>
                        {" "}
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="focus-ring inline-flex items-center gap-1 rounded-sm font-semibold text-brand-300 underline-offset-2 transition-colors duration-200 hover:text-brand-400 hover:underline"
                        >
                          {t("view_in_framar")}
                          <ExternalLink className="size-3" />
                        </a>
                      </>
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="text-[12px] leading-snug text-ink-500">{t("medications_disclaimer")}</p>
    </div>
  );
}
