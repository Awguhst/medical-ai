"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        // "On" uses the theme's second accent (teal, gold or apricot) with a soft halo of the same colour.
        "focus-ring peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-slate-200 shadow-[inset_0_1px_2px_rgb(0_0_0/0.45)] transition-[background-color,box-shadow] duration-300 ease-out-quart data-[state=checked]:bg-brand-alt data-[state=checked]:shadow-[inset_0_1px_2px_rgb(0_0_0/0.2),0_0_0_4px_rgb(var(--rgb-alt)/0.14)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-5 rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.4),0_2px_6px_rgb(0_0_0/0.25)] transition-[translate] duration-300 ease-spring data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
