// Appearance: theme, font, size, line spacing and column width, plus the typing options.
// Stored in the browser (per device); applied as CSS variables the editor theme reads.

import { h } from "./ui";

export const THEMES = [
  { id: "auto", label: "Auto" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "sepia", label: "Sepia" },
  { id: "midnight", label: "Midnight" },
] as const;
export type ThemeName = (typeof THEMES)[number]["id"];

export const FONTS = {
  sans: { label: "Sans", stack: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif' },
  serif: { label: "Serif", stack: '"Iowan Old Style", "Charter", "Palatino Linotype", Cambria, Georgia, serif' },
  mono: { label: "Mono", stack: 'ui-monospace, "Cascadia Code", Consolas, Menlo, monospace' },
} as const;
export type FontName = keyof typeof FONTS;

export const WIDTHS = { narrow: "38rem", medium: "50rem", wide: "64rem", full: "100%" } as const;
export type WidthName = keyof typeof WIDTHS;

export interface Appearance {
  theme: ThemeName;
  font: FontName;
  /** editor text size in px */
  size: number;
  line: number;
  width: WidthName;
  /** curly quotes, en/em dashes and ellipses while typing */
  typography: boolean;
}

export const SIZE_RANGE = { min: 14, max: 30 } as const;
export const LINE_RANGE = { min: 1.3, max: 2.6 } as const;
export const DEFAULTS: Appearance = { theme: "auto", font: "sans", size: 21, line: 2, width: "medium", typography: true };

/** A number from saved data: only real numbers (or numeric strings) count; null, "" and junk fall back. */
const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
const clamp = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = num(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/** Read saved settings, tolerating anything: missing, old, hand-edited or corrupt values fall back to the defaults. */
export function parseAppearance(raw: string | null, legacyTheme: string | null = null): Appearance {
  let o: Record<string, unknown> = {};
  try {
    const v = JSON.parse(raw ?? "{}");
    if (v && typeof v === "object") o = v as Record<string, unknown>;
  } catch {
    /* use defaults */
  }
  const theme = THEMES.some((t) => t.id === (o.theme ?? legacyTheme)) ? ((o.theme ?? legacyTheme) as ThemeName) : DEFAULTS.theme;
  return {
    theme,
    font: o.font === "serif" || o.font === "mono" || o.font === "sans" ? o.font : DEFAULTS.font,
    size: Math.round(clamp(o.size, SIZE_RANGE.min, SIZE_RANGE.max, DEFAULTS.size)),
    line: Math.round(clamp(o.line, LINE_RANGE.min, LINE_RANGE.max, DEFAULTS.line) * 10) / 10,
    width: o.width === "narrow" || o.width === "wide" || o.width === "full" || o.width === "medium" ? o.width : DEFAULTS.width,
    typography: typeof o.typography === "boolean" ? o.typography : DEFAULTS.typography,
  };
}

export function applyAppearance(a: Appearance, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = a.theme;
  root.style.setProperty("--font-write", FONTS[a.font].stack);
  root.style.setProperty("--ed-size", `${a.size}px`);
  root.style.setProperty("--ed-line", String(a.line));
  root.style.setProperty("--ed-width", WIDTHS[a.width]);
}

export interface AppearanceActions {
  addComment(): void;
  insertFootnote(): void;
}

/** The panel behind the "Aa" button. `change` is called with every new state; the panel repaints itself. */
export function buildAppearancePanel(start: Appearance, change: (a: Appearance) => void, actions: AppearanceActions): HTMLElement {
  let a = { ...start };
  const set = (patch: Partial<Appearance>): void => {
    a = { ...a, ...patch };
    change(a);
    paint();
  };

  const themeBtns = THEMES.map((t) => h("button", { class: "seg swatch-" + t.id, type: "button", "data-theme-id": t.id, onclick: () => set({ theme: t.id }) }, t.label));
  const fontBtns = (Object.keys(FONTS) as FontName[]).map((f) => h("button", { class: "seg", type: "button", "data-font": f, style: `font-family:${FONTS[f].stack}`, onclick: () => set({ font: f }) }, FONTS[f].label));
  const widthBtns = (Object.keys(WIDTHS) as WidthName[]).map((w) => h("button", { class: "seg", type: "button", "data-width": w, onclick: () => set({ width: w }) }, w[0].toUpperCase() + w.slice(1)));
  const sizeIn = h("input", { type: "range", min: SIZE_RANGE.min, max: SIZE_RANGE.max, step: 1, "aria-label": "Text size", oninput: () => set({ size: Number(sizeIn.value) }) });
  const lineIn = h("input", { type: "range", min: LINE_RANGE.min, max: LINE_RANGE.max, step: 0.1, "aria-label": "Line spacing", oninput: () => set({ line: Number(lineIn.value) }) });
  const sizeVal = h("span", { class: "val" });
  const lineVal = h("span", { class: "val" });
  const typo = h("input", { type: "checkbox", id: "optTypography", onchange: () => set({ typography: typo.checked }) });

  function paint(): void {
    themeBtns.forEach((b) => b.classList.toggle("on", b.dataset.themeId === a.theme));
    fontBtns.forEach((b) => b.classList.toggle("on", b.dataset.font === a.font));
    widthBtns.forEach((b) => b.classList.toggle("on", b.dataset.width === a.width));
    sizeIn.value = String(a.size);
    lineIn.value = String(a.line);
    sizeVal.textContent = `${a.size} px`;
    lineVal.textContent = a.line.toFixed(1);
    typo.checked = a.typography;
  }
  paint();

  return h(
    "div",
    { class: "panel appearance" },
    h("div", { class: "panel-h" }, "Theme"),
    h("div", { class: "segs wrap" }, ...themeBtns),
    h("div", { class: "panel-h" }, "Font"),
    h("div", { class: "segs" }, ...fontBtns),
    h("div", { class: "panel-h" }, "Text size", sizeVal),
    sizeIn,
    h("div", { class: "panel-h" }, "Line spacing", lineVal),
    lineIn,
    h("div", { class: "panel-h" }, "Column width"),
    h("div", { class: "segs" }, ...widthBtns),
    h("label", { class: "check", for: "optTypography" }, typo, h("span", {}, "Curly quotes, dashes and ellipses as I type")),
    h("div", { class: "panel-h" }, "Insert"),
    h(
      "div",
      { class: "segs" },
      h("button", { class: "seg", type: "button", onclick: actions.addComment, title: "Ctrl/Cmd+Shift+M" }, "Comment"),
      h("button", { class: "seg", type: "button", onclick: actions.insertFootnote, title: "Ctrl/Cmd+Shift+Y" }, "Footnote"),
    ),
  );
}
