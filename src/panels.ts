// The navigator (headings of the open text) and the statistics panel.

import { type Heading, type TextStats } from "./text";
import { h } from "./ui";

export interface NavEntry {
  kind: "sheet" | "heading";
  label: string;
  level: number;
  from: number;
}

/** Headings of the text, plus a marker where each glued sheet begins when there are several. */
export function navEntries(headings: Heading[], joins: number[]): NavEntry[] {
  const out: NavEntry[] = headings.map((x) => ({ kind: "heading", label: x.text, level: x.level, from: x.from }));
  if (joins.length) {
    out.push({ kind: "sheet", label: "Sheet 1", level: 0, from: 0 });
    joins.forEach((from, i) => out.push({ kind: "sheet", label: `Sheet ${i + 2}`, level: 0, from }));
  }
  // a sheet marker sorts before the headings that start at the same place
  return out.sort((a, b) => a.from - b.from || (a.kind === "sheet" ? -1 : 1) - (b.kind === "sheet" ? -1 : 1));
}

/** The heading the cursor is under: the last one that starts at or before it. */
export function currentEntry(entries: NavEntry[], head: number): number {
  let at = -1;
  entries.forEach((e, i) => {
    if (e.kind === "heading" && e.from <= head) at = i;
  });
  return at;
}

export function buildNavigator(entries: NavEntry[], head: number, pick: (from: number) => void): HTMLElement {
  if (!entries.some((e) => e.kind === "heading")) {
    return h("div", { class: "panel navigator" }, h("div", { class: "panel-h" }, "Navigator"), h("div", { class: "none" }, "No headings yet. Start a line with # to make one."));
  }
  const cur = currentEntry(entries, head);
  const minLevel = Math.min(...entries.filter((e) => e.kind === "heading").map((e) => e.level));
  const items = entries.map((e, i) =>
    e.kind === "sheet"
      ? h("div", { class: "nav-sheet" }, e.label)
      : h("button", { class: "nav-item" + (i === cur ? " on" : ""), type: "button", style: `padding-left:${10 + (e.level - minLevel) * 14}px`, onclick: () => pick(e.from) }, e.label),
  );
  return h("div", { class: "panel navigator" }, h("div", { class: "panel-h" }, "Navigator"), h("div", { class: "nav-list" }, ...items));
}

const n = (x: number): string => x.toLocaleString();

export function buildStats(doc: TextStats, selection: TextStats | null): HTMLElement {
  const rows: [string, (s: TextStats) => string][] = [
    ["Words", (s) => n(s.words)],
    ["Characters", (s) => n(s.characters)],
    ["Without spaces", (s) => n(s.charactersNoSpaces)],
    ["Sentences", (s) => n(s.sentences)],
    ["Paragraphs", (s) => n(s.paragraphs)],
    ["Reading time", (s) => (s.readingMinutes ? `${s.readingMinutes} min` : "–")],
  ];
  const head = h("div", { class: "stat-row stat-head" }, h("span", {}, ""), ...(selection ? [h("span", {}, "Selection")] : []), h("span", {}, "Text"));
  return h(
    "div",
    { class: "panel stats" },
    h("div", { class: "panel-h" }, "Statistics"),
    head,
    ...rows.map(([label, f]) => h("div", { class: "stat-row" }, h("span", { class: "stat-k" }, label), ...(selection ? [h("span", {}, f(selection))] : []), h("span", {}, f(doc)))),
    h("div", { class: "hint" }, "Comments and Markdown marks are not counted."),
  );
}
