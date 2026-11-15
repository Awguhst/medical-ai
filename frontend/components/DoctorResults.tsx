"use client";

import { CalendarClock, ExternalLink, MapPin, Star } from "lucide-react";

import { useT } from "@/lib/i18n";
import type { ToolResultData } from "@/lib/types";

/** Only ever link to Superdoc itself, whatever the data says. */
function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "superdoc.bg" ? parsed.href : null;
  } catch {
    return null;
  }
}

function initials(name: string, fallback: string): string {
  const words = name
    .replace(/^(д-р|доц\.?|проф\.?|dr\.?)\s+/giu, "")
    .split(/\s+/)
    .filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || fallback;
}

export default function DoctorResults({ result }: { result: ToolResultData }) {
  const t = useT();
  const doctors = result.doctors ?? [];
  const searchUrl = safeUrl(result.search_url);
  const query = result.query;

  return (
    <div className="animate-fade space-y-3 border-t border-line p-4">
      {query && (
        <p className="text-[13px] text-ink-500">
          {t("search_label")} <span className="font-semibold text-ink-900">{query.specialty}</span>
          {query.city ? (
            <>
              {" "}
              {t("search_in")} <span className="font-semibold text-ink-900">{query.city}</span>
            </>
          ) : (
            ` ${t("search_all_bulgaria")}`
          )}
        </p>
      )}

      {doctors.length > 0 && (
        <ul className="grid gap-2">
          {doctors.map((doctor) => {
            const url = safeUrl(doctor.profile_url);
            return (
              <li
                key={doctor.profile_url}
                className="flex items-start gap-3 rounded-xl border border-line bg-fill p-3 transition-[background-color,border-color] duration-200 ease-out-quart hover:border-line-strong hover:bg-fill-hover"
              >
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-fill-hover font-display text-sm font-bold text-ink-900 ring-1 ring-line"
                  aria-hidden
                >
                  {initials(doctor.name, t("initials_fallback"))}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <p className="font-display text-sm font-bold text-ink-900">{doctor.name}</p>
                    {doctor.sponsored && (
                      <span className="rounded-md bg-fill-hover px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500">
                        {t("sponsored")}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[13px] leading-snug text-ink-500">{doctor.specialties}</p>

                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-700">
                    {doctor.rating !== null && (
                      <span className="inline-flex items-center gap-1">
                        <Star className="size-3.5 fill-amber-400 text-amber-400" />
                        <span className="font-semibold tabular-nums">{doctor.rating.toFixed(1)}</span>
                        {doctor.reviews_count !== null && (
                          <span className="text-ink-400">
                            {t("reviews_count", { count: doctor.reviews_count })}
                          </span>
                        )}
                      </span>
                    )}
                    {doctor.location && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3.5 text-ink-400" />
                        {doctor.location}
                      </span>
                    )}
                    {doctor.next_available && (
                      <span className="inline-flex items-center gap-1 text-teal-700">
                        <CalendarClock className="size-3.5" />
                        {t("earliest_slot", { when: doctor.next_available })}
                      </span>
                    )}
                  </div>
                </div>

                {url && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="fx-primary focus-ring inline-flex shrink-0 items-center gap-1.5 self-center rounded-lg bg-primary px-3 py-2 text-[12.5px] font-semibold text-black hover:bg-primary-hover active:scale-[0.97]"
                    aria-label={t("doctor_profile", { name: doctor.name })}
                  >
                    <span className="@max-lg:hidden">{t("book")}</span>
                    <ExternalLink className="size-3.5" />
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {searchUrl && (
        <a
          href={searchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="focus-ring inline-flex items-center gap-1.5 rounded-sm text-[13px] font-semibold text-brand-300 underline-offset-2 transition-colors duration-200 hover:text-brand-400 hover:underline"
        >
          {t("all_results_superdoc")}
          <ExternalLink className="size-3.5" />
        </a>
      )}

      <p className="text-[12px] leading-snug text-ink-500">{t("doctors_disclaimer")}</p>
    </div>
  );
}
