import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "focus-ring inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-[background-color,border-color,color,box-shadow,scale,opacity] duration-200 ease-out-quart active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "fx-primary bg-primary text-black shadow-sm hover:bg-primary-hover",
        outline:
          "border border-line bg-fill text-ink-700 hover:border-line-strong hover:bg-fill-hover hover:text-ink-900",
        ghost: "text-ink-500 hover:bg-fill-hover hover:text-ink-900",
        destructive:
          "border border-red-200 bg-red-50 text-red-700 hover:border-red-300/50 hover:bg-red-100",
        soft: "bg-fill text-ink-900 hover:bg-fill-hover",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 rounded-lg px-3 text-[13px]",
        lg: "h-11 px-5 text-[15px]",
        icon: "size-9",
        "icon-sm": "size-8 rounded-lg",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { Button, buttonVariants };
