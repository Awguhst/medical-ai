import type { Language, ThemeName } from "./types";

/**
 * Interface language and colour theme. They carry no health data, so, like the
 * sidebar layout, they live in localStorage and outlive the tab (the chat
 * history in storage.ts does not). The keys are also read by the inline script
 * in app/layout.tsx, which applies both before the first paint.
 */
export const PREFERENCE_KEYS = {
  language: "medai.language",
  theme: "medai.theme",
  sidebarWidth: "medai.sidebar.width",
  sidebarCollapsed: "medai.sidebar.collapsed",
} as const;

export const DEFAULT_LANGUAGE: Language = "bg";

/** Each language is named in itself, so a user who cannot read the current one still finds theirs. */
export const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: "bg", label: "Български" },
  { value: "en", label: "English" },
];

export function isLanguage(value: unknown): value is Language {
  return value === "bg" || value === "en";
}

export const DEFAULT_THEME: ThemeName = "graphite";

export type ThemeOption = {
  value: ThemeName;
  /** Browser chrome colour (the theme-color meta tag) */
  themeColor: string;
  /** Colours for the preview swatch in the settings dialog */
  swatch: { base: string; card: string; accent: string; alt: string };
};

/** The three themes; their colours live in app/globals.css under [data-theme]. */
export const THEME_OPTIONS: ThemeOption[] = [
  {
    value: "graphite",
    themeColor: "#0d0d0d",
    swatch: { base: "#0d0d0d", card: "#1c1c1c", accent: "#369eff", alt: "#2dd4bf" },
  },
  {
    value: "ember",
    themeColor: "#15100d",
    swatch: { base: "#15100d", card: "#261c16", accent: "#f27a45", alt: "#f5c451" },
  },
  {
    value: "dusk",
    themeColor: "#140d14",
    swatch: { base: "#140d14", card: "#251829", accent: "#f26688", alt: "#f6b26b" },
  },
];

export function isThemeName(value: unknown): value is ThemeName {
  return THEME_OPTIONS.some((option) => option.value === value);
}

export function loadPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function savePreference(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage may be blocked; the preference still applies for this visit.
  }
}

/** Put the theme on <html> (the CSS keys off data-theme) and tint the browser chrome to match. */
export function applyTheme(theme: ThemeName) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  const option = THEME_OPTIONS.find((t) => t.value === theme);
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta && option) meta.content = option.themeColor;
}

/**
 * Runs inline before the page paints, so a stored theme and language apply
 * without a flash of the defaults. Kept dependency-free and tiny on purpose.
 */
export const PREFERENCE_BOOT_SCRIPT = `(function(){try{var d=document.documentElement,s=window.localStorage,t=s.getItem(${JSON.stringify(
  PREFERENCE_KEYS.theme,
)}),l=s.getItem(${JSON.stringify(PREFERENCE_KEYS.language)});if(${JSON.stringify(
  THEME_OPTIONS.map((t) => t.value),
)}.indexOf(t)>=0){d.setAttribute("data-theme",t);}if(l==="en"||l==="bg"){d.lang=l;}}catch(e){}})();`;
