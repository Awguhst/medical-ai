import { cn } from "@/lib/utils";

/** MedAI mark: a medical cross whose bar turns into a pulse line. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-teal-500 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.28),0_1px_2px_rgb(0_0_0/0.3),0_4px_12px_-4px_rgb(54_158_255/0.5)]",
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="size-[58%]" fill="none">
        <path
          d="M12 4v5.2M12 14.8V20"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <path
          d="M3.5 12h4l1.7-3.2 2.9 6.4 1.9-3.2h6.5"
          stroke="currentColor"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="flex flex-col leading-none">
        <span className="font-display text-[17px] font-extrabold tracking-tight text-ink-900">
          Med<span className="text-brand-300">AI</span>
        </span>
        <span className="mt-1 text-[10.5px] font-medium uppercase tracking-[0.14em] text-ink-400">
          Bulgaria
        </span>
      </span>
    </span>
  );
}
