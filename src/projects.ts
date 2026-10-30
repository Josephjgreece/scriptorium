// Projects: a group flagged as a self-contained work (a novel, an article) with a word goal,
// a deadline, and a role for each of its sections. Pure logic; the UI lives in main.ts / projectsUi.ts.

import { arrange, arrangeGroups, parentOf, type Meta, type Project, type SectionRole } from "./meta";

/** "Chapter 2" before "Chapter 10": the reading order for sheets nobody has arranged yet. */
const naturally = <T extends { path: string }>(sheets: T[]): T[] => [...sheets].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" }));

/**
 * The sheets of one group in the order to show them. Arranged sheets keep their place. Sheets not
 * arranged yet normally come newest first, but inside a project they read in name order, because a
 * manuscript is read from the start.
 */
export function orderedSheets<T extends { path: string }>(m: Meta, group: string, sheets: T[]): T[] {
  return arrange(m, group, projectOf(m, group) !== null ? naturally(sheets) : sheets);
}

/** The project a group or sheet belongs to (the project group itself included), or null. */
export function projectOf(m: Meta, path: string): string | null {
  for (const k of Object.keys(m.projects)) if (path === k || path.startsWith(k + "/")) return k;
  return null;
}

/** The section of a project containing `path`: its direct subgroup, or null when it is loose in the project. */
export function sectionOf(m: Meta, path: string): string | null {
  const proj = projectOf(m, path);
  if (proj === null || path === proj) return null;
  let p = path;
  while (parentOf(p) !== proj) {
    if (p === "") return null;
    p = parentOf(p);
  }
  // a sheet directly in the project has parent === proj from the start, so it is not in a section
  return p === path && path.endsWith(".md") ? null : p;
}

export function roleOf(m: Meta, path: string): SectionRole {
  const proj = projectOf(m, path);
  const sec = sectionOf(m, path);
  return proj !== null && sec !== null ? (m.projects[proj].sections[sec] ?? "manuscript") : "manuscript";
}

/** Material, either flagged on the sheet itself or because it lives in a Material section. */
export const isMaterialPath = (m: Meta, path: string): boolean => m.material.includes(path) || roleOf(m, path) === "material";

/** Counts toward word totals and the project goal: not material and not front/back matter. */
export const countsTowardGoal = (m: Meta, path: string): boolean => !isMaterialPath(m, path) && roleOf(m, path) !== "matter";

/** Included when the project or group is exported: everything except material. */
export const isExported = (m: Meta, path: string): boolean => !isMaterialPath(m, path);

export interface Progress {
  words: number;
  goal: number;
  /** 0 to 100, capped; 0 when there is no goal */
  percent: number;
  deadline: string;
  /** whole days from today until the deadline (0 = today), null with no deadline */
  daysLeft: number | null;
  /** words a day still needed to make the deadline, null when there is nothing to pace */
  perDay: number | null;
}

const day = (iso: string): number => {
  const [y, mo, d] = iso.split("-").map(Number);
  return Date.UTC(y, mo - 1, d) / 86_400_000;
};
export const todayIso = (now = new Date()): string => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

export function progress(project: Project, words: number, now = new Date()): Progress {
  const goal = project.goal;
  const daysLeft = project.deadline ? day(project.deadline) - day(todayIso(now)) : null;
  const remaining = Math.max(0, goal - words);
  return {
    words,
    goal,
    percent: goal ? Math.min(100, Math.floor((words / goal) * 100)) : 0,
    deadline: project.deadline,
    daysLeft,
    perDay: goal && daysLeft !== null && daysLeft >= 0 && remaining > 0 ? Math.ceil(remaining / Math.max(1, daysLeft)) : null,
  };
}

/** "12,300 of 80,000 words · 15%" or just the count when there is no goal. */
export function goalText(p: Progress): string {
  const n = (x: number) => x.toLocaleString();
  return p.goal ? `${n(p.words)} of ${n(p.goal)} words · ${p.percent}%` : `${n(p.words)} ${p.words === 1 ? "word" : "words"}`;
}

/** "12 days left · about 410 words a day" / "due today" / "3 days overdue" / "". */
export function deadlineText(p: Progress): string {
  if (p.daysLeft === null) return "";
  if (p.daysLeft < 0) return `${-p.daysLeft} ${p.daysLeft === -1 ? "day" : "days"} overdue`;
  const when = p.daysLeft === 0 ? "due today" : `${p.daysLeft} ${p.daysLeft === 1 ? "day" : "days"} left`;
  return p.perDay ? `${when} · about ${p.perDay.toLocaleString()} words a day` : when;
}

interface TreeNode {
  path: string;
  children: TreeNode[];
}

/**
 * Every sheet of a project in reading order: the sheets loose in the project, then each section
 * (in the order you arranged them), each with its sheets in their arranged order.
 */
export function projectSheets<T extends { path: string }>(m: Meta, project: TreeNode, all: T[]): T[] {
  const out: T[] = [];
  const walk = (node: TreeNode): void => {
    out.push(...orderedSheets(m, node.path, all.filter((s) => parentOf(s.path) === node.path)));
    for (const c of arrangeGroups(m, node.path, node.children)) walk(c);
  };
  walk(project);
  return out;
}

// ---- templates

export interface Template {
  id: string;
  name: string;
  description: string;
  sections: { name: string; role: SectionRole; sheets: string[] }[];
}

/** Each sheet is its starting text; the first line becomes the sheet's title. */
export const TEMPLATES: Template[] = [
  {
    id: "novel",
    name: "Novel",
    description: "Front matter, chapters, back matter, and notes and characters kept as material",
    sections: [
      { name: "Front Matter", role: "matter", sheets: ["# Title Page\n\n"] },
      { name: "Chapters", role: "manuscript", sheets: ["# Chapter 1\n\n"] },
      { name: "Back Matter", role: "matter", sheets: ["# Acknowledgements\n\n"] },
      { name: "Notes", role: "material", sheets: ["# Notes\n\n"] },
      { name: "Characters", role: "material", sheets: ["# Characters\n\n"] },
    ],
  },
  {
    id: "stories",
    name: "Short story collection",
    description: "A section for the stories, one for ideas, and a title page",
    sections: [
      { name: "Front Matter", role: "matter", sheets: ["# Title Page\n\n"] },
      { name: "Stories", role: "manuscript", sheets: ["# First Story\n\n"] },
      { name: "Ideas", role: "material", sheets: ["# Ideas\n\n"] },
    ],
  },
  {
    id: "essay",
    name: "Article or essay",
    description: "A draft, with research kept as material",
    sections: [
      { name: "Draft", role: "manuscript", sheets: ["# Working Title\n\n"] },
      { name: "Research", role: "material", sheets: ["# Sources\n\n"] },
    ],
  },
  { id: "blank", name: "Blank project", description: "An empty project; add sections as you go", sections: [] },
];
