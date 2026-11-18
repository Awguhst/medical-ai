import type { KeyboardEvent } from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Whether this key press in a message box should send the message. With a
 * mouse or trackpad (so a physical keyboard, almost always) Enter sends and
 * Shift+Enter breaks the line; on a touch screen Enter breaks the line and
 * the button sends. Ctrl+Enter and Cmd+Enter send everywhere.
 */
export function enterSends(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
  if (e.key !== "Enter" || e.nativeEvent.isComposing) return false;
  if (e.ctrlKey || e.metaKey) return true;
  return !e.shiftKey && window.matchMedia("(pointer: fine)").matches;
}

export function newId(): string {
  const c = globalThis.crypto;
  if (typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  // Fallback for non-secure contexts (e.g. LAN IP over http).
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
