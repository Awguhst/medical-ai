"use client";

import { useState } from "react";
import {
  Cloud,
  FileText,
  HardDrive,
  Pill,
  Search,
  ShieldCheck,
  Stethoscope,
  Timer,
  type LucideIcon,
} from "lucide-react";

import { useT, type MessageKey } from "@/lib/i18n";
import { LogoMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const POINTS: { icon: LucideIcon; title: MessageKey; text: MessageKey }[] = [
  { icon: Stethoscope, title: "consent_1_title", text: "consent_1_text" },
  { icon: Cloud, title: "consent_2_title", text: "consent_2_text" },
  { icon: HardDrive, title: "consent_3_title", text: "consent_3_text" },
  { icon: FileText, title: "consent_4_title", text: "consent_4_text" },
  { icon: Search, title: "consent_5_title", text: "consent_5_text" },
  { icon: Pill, title: "consent_6_title", text: "consent_6_text" },
  { icon: Timer, title: "consent_7_title", text: "consent_7_text" },
];

type Props = {
  open: boolean;
  onAccept: () => void;
  onDecline: () => void;
};

export default function ConsentDialog({ open, onAccept, onDecline }: Props) {
  const t = useT();
  const [checked, setChecked] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onDecline()}>
      <DialogContent
        showClose={false}
        className="sm:max-w-xl"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="flex flex-row items-center gap-3 space-y-0">
          <LogoMark className="size-10 rounded-xl" />
          <div>
            <DialogTitle>{t("consent_title")}</DialogTitle>
            <DialogDescription>{t("consent_description")}</DialogDescription>
          </div>
        </DialogHeader>

        <DialogBody className="space-y-3">
          <ul className="space-y-2">
            {POINTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3 rounded-xl border border-line bg-fill p-3.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-fill text-brand-300 ring-1 ring-line">
                  <Icon className="size-[18px]" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink-900">{t(title)}</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-ink-500">{t(text)}</p>
                </div>
              </li>
            ))}
          </ul>

          <p className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-[13px] leading-relaxed text-red-900">
            <strong>{t("consent_emergency_lead")}</strong> {t("consent_emergency_body")}{" "}
            <strong>112</strong>
            {t("consent_emergency_after")}
          </p>

          <p className="text-[12px] leading-relaxed text-ink-400">{t("consent_prototype")}</p>

          <label className="flex cursor-pointer select-none items-start gap-3 rounded-xl border border-line bg-fill p-3.5 transition-[background-color,border-color,box-shadow] duration-300 ease-out-quart hover:border-line-strong hover:bg-fill-hover has-[:checked]:border-teal-300/70 has-[:checked]:bg-teal-50/50 has-[:checked]:shadow-[0_0_0_3px_rgb(var(--rgb-ok)/0.08)]">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-0.5 size-[18px] shrink-0 cursor-pointer accent-teal-600"
            />
            <span className="text-sm leading-snug text-ink-700">{t("consent_checkbox")}</span>
          </label>
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={onDecline}>
            {t("consent_decline")}
          </Button>
          <Button onClick={onAccept} disabled={!checked}>
            <ShieldCheck className="size-4" />
            {t("consent_accept")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
