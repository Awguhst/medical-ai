"use client";

import {
  CircleAlert,
  CircleCheck,
  FileText,
  FlaskConical,
  Info,
  Pill,
  ScanLine,
  Stethoscope,
} from "lucide-react";

import { useT } from "@/lib/i18n";
import type { ToolPart } from "@/lib/types";
import { cn } from "@/lib/utils";
import DoctorResults from "@/components/DoctorResults";
import DocumentResults from "@/components/DocumentResults";
import ImageAttachment from "@/components/ImageAttachment";
import MedicationResults from "@/components/MedicationResults";

const OK_STATUSES = new Set(["success", "partial"]);
const INFO_STATUSES = new Set([
  "model_not_configured",
  "model_incompatible",
  "unsupported_image",
  "image_not_found",
  "no_results",
  "unknown_specialty",
  "unknown_city",
  "not_found",
  "not_a_medical_document",
  "medical_image",
  "unreadable",
  "too_long",
  "not_read",
]);

/** Inline record of one tool call: running indicator, then the result. */
export default function ToolResult({ part }: { part: ToolPart }) {
  const t = useT();
  const running = part.state === "running";
  const result = part.result;
  const simulated = Boolean(result?.simulated);
  const status = result?.status ?? "";
  const ok = OK_STATUSES.has(status);
  const info = INFO_STATUSES.has(status);
  const detections = result?.detections ?? [];
  const isDoctors = result?.kind === "doctors" || part.toolName === "find_doctors";
  const isMedications = result?.kind === "medications" || part.toolName === "lookup_medication";
  const isDocument = result?.kind === "document" || part.toolName === "read_document";
  const Icon = isDoctors ? Stethoscope : isMedications ? Pill : isDocument ? FileText : ScanLine;

  // One neutral card for every state; only the border signals demo or failure.
  const failed = !running && Boolean(result) && !ok && !info && !simulated;
  const tone = simulated ? "border-amber-200" : failed ? "border-red-200" : "border-line";

  return (
    <div
      className={cn(
        "fx-sheen animate-rise overflow-hidden rounded-2xl border bg-card transition-[border-color,box-shadow] duration-300 ease-out-quart",
        tone,
        running && "fx-running",
      )}
    >
      {/* Header: which tool is being used */}
      <div className="flex items-center gap-3 px-4 py-3">
        <span
          className={cn(
            "relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg transition-colors duration-300",
            simulated ? "bg-amber-100 text-amber-700" : "bg-fill text-brand-300 ring-1 ring-line",
          )}
        >
          <Icon className="size-4" />
          {running && (
            <span className="absolute inset-x-1 top-0 h-0.5 animate-scan rounded bg-brand-alt" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] leading-tight text-ink-500">{t("tool_using")}</p>
          <p className="mt-0.5 truncate font-display text-sm font-bold leading-tight text-ink-900">
            {part.label}
          </p>
        </div>
        {simulated && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white shadow-[0_4px_12px_-4px_rgb(var(--rgb-warn)/0.6)]">
            <FlaskConical className="size-3" />
            {t("demo_badge")}
          </span>
        )}
      </div>

      {/* Status line */}
      <div className="flex items-start gap-2.5 border-t border-line px-4 py-3 text-sm">
        {running ? (
          <>
            <span className="mt-1 flex gap-1" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="size-1.5 animate-dot rounded-full bg-brand-500"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </span>
            <span className="text-ink-700" role="status">
              {part.runningText || t("tool_running")}
            </span>
          </>
        ) : (
          <>
            {ok ? (
              <CircleCheck className="mt-0.5 size-4 shrink-0 animate-pop text-teal-600" />
            ) : simulated ? (
              <FlaskConical className="mt-0.5 size-4 shrink-0 text-amber-600" />
            ) : info ? (
              <Info className="mt-0.5 size-4 shrink-0 text-ink-500" />
            ) : (
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-red-600" />
            )}
            <span className={cn("animate-fade font-medium", ok ? "text-teal-800" : "text-ink-700")}>
              {result?.message ?? t("tool_finished")}
            </span>
          </>
        )}
      </div>

      {!running && result && isDoctors && (ok || result.search_url) && (
        <DoctorResults result={result} />
      )}

      {!running && result && isMedications && (result.medications ?? []).length > 0 && (
        <MedicationResults result={result} />
      )}

      {!running && result && isDocument && (result.document || result.sent_to_claude) && (
        <DocumentResults result={result} />
      )}

      {!running && result && !isDoctors && !isMedications && !isDocument && (simulated || ok) && (
        <div className="animate-fade space-y-3 border-t border-line p-4">
          {simulated && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] font-medium leading-snug text-amber-900">
              {t("demo_simulation_note")}
            </p>
          )}

          {result.annotated_image_id && (
            <ImageAttachment
              imageId={result.annotated_image_id}
              alt={simulated ? t("demo_image_alt") : t("xray_annotated_model_alt")}
              sizeClassName="max-h-[26rem] max-w-full"
            />
          )}

          {ok && detections.length === 0 && (
            <p className="rounded-xl border border-line bg-fill px-3 py-2.5 text-[13px] leading-snug text-ink-700">
              {t("no_detections")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
