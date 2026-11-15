"use client";

import { CloudUpload, FileText } from "lucide-react";

import type { ToolResultData } from "@/lib/types";
import { cn } from "@/lib/utils";

const READABLE: Record<string, { label: string; className: string }> = {
  good: { label: "Четлив", className: "bg-teal-100 text-teal-800" },
  partial: { label: "Частично четлив", className: "bg-amber-100 text-amber-800" },
  poor: { label: "Трудно четлив", className: "bg-red-100 text-red-800" },
};

const MEDICATION_CONTEXT: Record<string, string> = {
  prescribed: "Предписано",
  during_stay: "По време на престоя",
  previous: "Досегашна терапия",
};

const FLAG: Record<string, { label: string; className: string }> = {
  high: { label: "Над нормата", className: "bg-amber-100 text-amber-800" },
  low: { label: "Под нормата", className: "bg-amber-100 text-amber-800" },
  abnormal: { label: "Извън нормата", className: "bg-amber-100 text-amber-800" },
  normal: { label: "В норма", className: "bg-fill-hover text-ink-500" },
  unknown: { label: "Без посочена норма", className: "bg-fill-hover text-ink-500" },
};

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <p className="eyebrow">
        {title} <span className="ml-1 tabular-nums text-ink-500">{count}</span>
      </p>
      {children}
    </section>
  );
}

/** What the document reader extracted, plus a notice that the file was sent to Claude. */
export default function DocumentResults({ result }: { result: ToolResultData }) {
  const doc = result.document;
  const readable = doc ? READABLE[doc.readable] : undefined;
  const flagged = (doc?.tests ?? []).filter((t) => t.flag !== "normal" && t.flag !== "unknown");
  const otherTests = (doc?.tests ?? []).filter((t) => t.flag === "normal" || t.flag === "unknown");

  return (
    <div className="animate-fade space-y-4 border-t border-line p-4">
      {doc && (
        <>
          <div className="flex items-start gap-3 rounded-xl border border-line bg-fill p-3">
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-fill-hover text-brand-300 ring-1 ring-line"
              aria-hidden
            >
              <FileText className="size-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="break-words font-display text-sm font-bold leading-snug text-ink-900">
                  {doc.document_type_label || "Медицински документ"}
                </p>
                {readable && (
                  <span
                    className={cn(
                      "rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide",
                      readable.className,
                    )}
                  >
                    {readable.label}
                  </span>
                )}
              </div>
              <p className="mt-0.5 break-words text-[12.5px] leading-snug text-ink-500">
                {[doc.issuer, doc.issued_date].filter(Boolean).join(" · ") || result.file_name}
              </p>
            </div>
          </div>

          {doc.diagnoses.length > 0 && (
            <Section title="Диагнози" count={doc.diagnoses.length}>
              <ul className="grid gap-1.5">
                {doc.diagnoses.map((d, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2.5 rounded-lg border border-line bg-fill px-3 py-2 text-[13px] leading-snug text-ink-900"
                  >
                    {d.icd10 && (
                      <span className="mt-px shrink-0 rounded-md bg-fill-hover px-1.5 py-0.5 font-mono text-[11px] text-brand-300">
                        {d.icd10}
                      </span>
                    )}
                    <span className="min-w-0 break-words">{d.name}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {doc.medications.length > 0 && (
            <Section title="Лекарства" count={doc.medications.length}>
              <ul className="grid gap-1.5">
                {doc.medications.map((m, i) => (
                  <li key={i} className="rounded-lg border border-line bg-fill px-3 py-2">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <p className="break-words text-[13px] font-semibold text-ink-900">
                        {m.name}
                        {m.dose && <span className="ml-1.5 font-normal text-ink-700">{m.dose}</span>}
                      </p>
                      {MEDICATION_CONTEXT[m.context] && (
                        <span className="text-[11px] text-ink-400">{MEDICATION_CONTEXT[m.context]}</span>
                      )}
                    </div>
                    {(m.schedule || m.duration) && (
                      <p className="mt-0.5 break-words text-[12.5px] leading-snug text-ink-500">
                        {[m.schedule, m.duration].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {doc.tests.length > 0 && (
            <Section title="Изследвания" count={doc.tests.length}>
              {/* Rows wrap instead of overflowing, so the flag never gets clipped on a phone. */}
              <ul className="overflow-hidden rounded-xl border border-line bg-fill text-[13px]">
                {[...flagged, ...otherTests].map((t, i) => {
                  const flag = FLAG[t.flag] ?? FLAG.unknown;
                  return (
                    <li
                      key={i}
                      className={cn(
                        "flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2",
                        i > 0 && "border-t border-line",
                      )}
                    >
                      <span className="min-w-[7rem] flex-1 break-words text-ink-900">{t.name}</span>
                      <span className="whitespace-nowrap tabular-nums text-ink-900">
                        <span className="font-semibold">{t.value}</span>
                        {t.unit && <span className="ml-1 text-ink-500">{t.unit}</span>}
                      </span>
                      {t.reference_range && (
                        <span className="whitespace-nowrap tabular-nums text-ink-500 @lg:w-24 @lg:text-right">
                          <span className="@lg:hidden">норма </span>
                          {t.reference_range}
                        </span>
                      )}
                      <span
                        className={cn(
                          "whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold @lg:ml-auto",
                          flag.className,
                        )}
                      >
                        {flag.label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}

          {doc.recommendations.length > 0 && (
            <Section title="Препоръки" count={doc.recommendations.length}>
              <ul className="list-disc space-y-1 pl-5 text-[13px] leading-snug text-ink-700 marker:text-ink-400">
                {doc.recommendations.map((r, i) => (
                  <li key={i} className="break-words">
                    {r}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {doc.unreadable_parts.length > 0 && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12.5px] leading-snug text-amber-900">
              Неразчетени части: {doc.unreadable_parts.join("; ")}.
            </p>
          )}
        </>
      )}

      <p className="flex items-start gap-2 text-[12px] leading-snug text-ink-500">
        <CloudUpload className="mt-px size-3.5 shrink-0 text-ink-400" />
        <span>
          {result.sent_to_claude
            ? "За да бъде разчетен, файлът беше изпратен към Claude API (Anthropic) заедно с всичко, което се вижда на него. Името, ЕГН и адресът не се извличат и не се показват тук. "
            : "Файлът не беше изпратен за разчитане. "}
          Разчитането е автоматично и може да съдържа грешки: сверете дозите и стойностите с оригинала.
          Това не е медицинско заключение.
        </span>
      </p>
    </div>
  );
}
