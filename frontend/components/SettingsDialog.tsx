"use client";

import { useState } from "react";
import { FlaskConical, ShieldOff, Trash2, Wrench } from "lucide-react";

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

const YOLO_LABELS: Record<Health["yolo"]["status"], string> = {
  ready: "Медицински модел: наличен",
  not_configured: "Моделът не е конфигуриран",
  weights_missing: "Файлът с теглата не е намерен",
  incompatible: "Теглата не са медицински модел",
  error: "Грешка при зареждане на модела",
};

const TRIAGE_LABELS: Record<NonNullable<Health["image_triage"]>["status"], string> = {
  ready: "Локален модел: наличен",
  loading: "Зарежда се...",
  disabled: "Изключено на сървъра",
  not_installed: "Библиотеката не е инсталирана",
  error: "Грешка при зареждане на модела",
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
                ? "bg-teal-500 shadow-[0_0_0_3px_rgb(20_184_166/0.18)]"
                : "bg-amber-500 shadow-[0_0_0_3px_rgb(245_158_11/0.18)]",
          )}
        />
        {value}
      </span>
    </div>
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
  const [confirming, setConfirming] = useState(false);
  const yoloReady = health?.yolo.status === "ready";
  const demoAllowed = Boolean(health?.yolo.demo_mode_allowed) && !yoloReady;
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
          <DialogTitle>Настройки</DialogTitle>
          <DialogDescription>Състояние на системата, демо режим и поверителност.</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-6">
          <section>
            <h3 className="eyebrow">
              Състояние
            </h3>
            <div className="mt-2 divide-y divide-line rounded-xl border border-line bg-fill px-4">
              <StatusRow
                label="Сървър"
                value={backendDown ? "Няма връзка" : health ? "Работи" : "Проверка..."}
                ok={backendDown ? false : health ? true : null}
              />
              <StatusRow
                label="Claude API"
                value={
                  health
                    ? health.claude_configured
                      ? health.claude_model
                      : "Липсва API ключ"
                    : "Няма данни"
                }
                ok={health ? health.claude_configured : null}
              />
              <StatusRow
                label="X-ray Analyzer"
                value={health ? YOLO_LABELS[health.yolo.status] : "Няма данни"}
                ok={health ? yoloReady : null}
              />
              <StatusRow
                label="Разпознаване на снимки"
                value={triage ? TRIAGE_LABELS[triage.status] : "Няма данни"}
                ok={!triage ? null : triage.status === "ready" ? true : triage.status === "loading" ? null : false}
              />
            </div>
            {health && yoloReady && health.yolo.classes.length > 0 && (
              <p className="mt-2 text-[12px] leading-relaxed text-ink-500">
                Класове на модела: {health.yolo.classes.join(", ")}
              </p>
            )}
          </section>

          <section>
            <h3 className="eyebrow">
              Демо режим
            </h3>
            <div
              className={cn(
                "mt-2 rounded-xl border p-4 transition-[border-color,background-color,box-shadow] duration-300 ease-out-quart",
                settings.demoMode && demoAllowed
                  ? "border-amber-200 bg-amber-50/60 shadow-[0_0_0_3px_rgb(245_158_11/0.06)]"
                  : "border-line bg-fill",
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <label htmlFor="demo-mode" className="flex cursor-pointer items-start gap-2.5">
                  <FlaskConical className="mt-0.5 size-4 shrink-0 text-amber-600" />
                  <span>
                    <span className="block text-sm font-semibold text-ink-900">
                      Симулиран анализ на снимки
                    </span>
                    <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-500">
                      За тестване на интерфейса, когато липсва медицински модел. Резултатите са
                      случайни, ясно обозначени като „Демо“ и нямат медицинско значение.
                    </span>
                  </span>
                </label>
                <Switch
                  id="demo-mode"
                  checked={settings.demoMode && demoAllowed}
                  disabled={!demoAllowed}
                  onCheckedChange={(demoMode) => onSettingsChange({ ...settings, demoMode })}
                />
              </div>
              {!demoAllowed && health && (
                <p className="mt-2.5 text-[12px] text-ink-500">
                  {yoloReady
                    ? "Недостъпен: конфигуриран е реален медицински модел."
                    : "Демо режимът е изключен на сървъра."}
                </p>
              )}
            </div>
          </section>

          <section>
            <h3 className="eyebrow">Изглед</h3>
            <div className="mt-2 rounded-xl border border-line bg-fill p-4">
              <div className="flex items-start justify-between gap-4">
                <label htmlFor="show-tools" className="flex cursor-pointer items-start gap-2.5">
                  <Wrench className="mt-0.5 size-4 shrink-0 text-ink-500" />
                  <span>
                    <span className="block text-sm font-semibold text-ink-900">
                      Показвай работата на инструментите
                    </span>
                    <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-500">
                      Карти със статус и сурови данни от всяка проверка: рентген, лекарства, лекари,
                      документи. Изключено: виждате само отговора на MedAI.
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
            <h3 className="eyebrow">
              Поверителност
            </h3>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-500">
              Историята се пази само в този раздел на браузъра (sessionStorage). Съобщенията се
              обработват от Claude API. Рентгеновите снимки се анализират локално на сървъра.
              Документ, който поискате да бъде разчетен, се изпраща към Claude API. Качените
              файлове се изтриват автоматично. При търсене на лекар към superdoc.bg се изпращат само специалността и
              населеното място, а при справка за лекарство към framar.bg се изпраща само името му.
            </p>

            <div className="mt-3 flex flex-col gap-2">
              {confirming ? (
                <div className="animate-pop rounded-xl border border-red-200 bg-red-50 p-3.5">
                  <p className="text-sm font-medium text-red-900">
                    Да се изтрият ли всички разговори и качени снимки? Действието е необратимо.
                  </p>
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
                      Да, изтрий всичко
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>
                      Отказ
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
                  Изтрий цялата история
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
                {consent ? "Оттегли съгласието за обработка" : "Съгласието не е дадено"}
              </Button>
            </div>
          </section>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
