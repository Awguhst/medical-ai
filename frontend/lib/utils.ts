import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
