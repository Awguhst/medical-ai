"use client";

import { useState } from "react";
import { Cloud, FileText, HardDrive, Pill, Search, ShieldCheck, Stethoscope, Timer } from "lucide-react";

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

const POINTS = [
  {
    icon: Stethoscope,
    title: "Не е лекар и не поставя диагноза",
    text: "MedAI дава обща образователна информация. Тя не замества преглед, диагноза или лечение от медицински специалист.",
  },
  {
    icon: Cloud,
    title: "Съобщенията се обработват от външна AI услуга",
    text: "Текстът, който изпращате, се предава към Claude API на Anthropic, за да бъде генериран отговор. Не въвеждайте имена, ЕГН или други данни, по които можете да бъдете разпознати.",
  },
  {
    icon: HardDrive,
    title: "Рентгеновите снимки се анализират локално",
    text: "Рентгеновите снимки се обработват само на сървъра на MedAI. Към Claude се изпращат единствено резултатите от анализа, не и самата снимка.",
  },
  {
    icon: FileText,
    title: "Медицинските документи се изпращат към Claude",
    text: "Ако поискате да бъде разчетен документ (епикриза, изследвания, рецепта), самият файл се изпраща към Claude API заедно с всичко на него, включително име и ЕГН. Името, ЕГН и адресът не се извличат в разговора. Ако не желаете да ги изпращате, закрийте ги преди да снимате.",
  },
  {
    icon: Search,
    title: "Търсене на лекари в Superdoc",
    text: "Ако поискате да намерим специалист, към superdoc.bg се изпращат само специалността и населеното място. Резултатите не са препоръка от MedAI.",
  },
  {
    icon: Pill,
    title: "Справка за лекарства във Framar",
    text: "Когато става дума за лекарство, към framar.bg се изпраща само името му. Информацията е справочна и не замества лекар или фармацевт.",
  },
  {
    icon: Timer,
    title: "Временно съхранение",
    text: "Историята се пази само в този раздел на браузъра и изчезва при затварянето му. Качените снимки се изтриват автоматично от сървъра.",
  },
];

type Props = {
  open: boolean;
  onAccept: () => void;
  onDecline: () => void;
};

export default function ConsentDialog({ open, onAccept, onDecline }: Props) {
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
            <DialogTitle>Преди да започнете</DialogTitle>
            <DialogDescription>
              Моля, прочетете как MedAI обработва здравната информация.
            </DialogDescription>
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
                  <p className="text-sm font-semibold text-ink-900">{title}</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-ink-500">{text}</p>
                </div>
              </li>
            ))}
          </ul>

          <p className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-[13px] leading-relaxed text-red-900">
            <strong>При спешен случай</strong> (силна болка в гърдите, затруднено дишане, признаци
            на инсулт) се обадете незабавно на <strong>112</strong>.
          </p>

          <p className="text-[12px] leading-relaxed text-ink-400">
            Това е прототип. Приложението не е медицинско изделие и не е сертифицирано за клинична
            употреба.
          </p>

          <label className="flex cursor-pointer select-none items-start gap-3 rounded-xl border border-line bg-fill p-3.5 transition-[background-color,border-color,box-shadow] duration-300 ease-out-quart hover:border-line-strong hover:bg-fill-hover has-[:checked]:border-teal-300/70 has-[:checked]:bg-teal-50/50 has-[:checked]:shadow-[0_0_0_3px_rgb(20_184_166/0.08)]">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-0.5 size-[18px] shrink-0 cursor-pointer accent-teal-600"
            />
            <span className="text-sm leading-snug text-ink-700">
              Разбирам горното и съм съгласен/съгласна съобщенията ми и документите, които поискам
              да бъдат разчетени, да бъдат изпращани за обработка към Claude API (Anthropic).
            </span>
          </label>
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={onDecline}>
            Не сега
          </Button>
          <Button onClick={onAccept} disabled={!checked}>
            <ShieldCheck className="size-4" />
            Съгласен съм и продължавам
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
