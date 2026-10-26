// Structure that a plain .md file can't carry: manual sheet order, material sheets, glued
// sheets and saved filters. Stored as one JSON document next to the library (see api.ts).

export interface Filter {
  id: string;
  name: string;
  /** Text a sheet must contain (title or body). */
  query: string;
  /** Only sheets changed within this many days; 0 means any time. */
  days: number;
  /** Only sheets inside this group (and its subgroups); "" means anywhere. */
  group: string;
}

/**
 * What a section of a project is for. Manuscript counts toward the goal and is exported.
 * Matter (front and back matter) is exported but not counted. Material is neither.
 */
export type SectionRole = "manuscript" | "matter" | "material";

/** A group flagged as a project: a self-contained work, such as a novel, with its own goal. */
export interface Project {
  /** the template it was made from ("" for a plain group made into a project) */
  template: string;
  /** words to write; 0 means no goal */
  goal: number;
  /** "YYYY-MM-DD", or "" */
  deadline: string;
  /** section path -> role; sections not listed are manuscript */
  sections: Record<string, SectionRole>;
}

export interface Meta {
  /** group path -> sheet paths in the order the person arranged them */
  order: Record<string, string[]>;
  /** parent group path -> its subgroups in the order the person arranged them */
  groups: Record<string, string[]>;
  /** group path -> "icon:colour", the look chosen for it in the sidebar */
  style: Record<string, string>;
  /** project group path -> its settings */
  projects: Record<string, Project>;
  material: string[];
  /** each entry is a run of two or more sheets, in reading order, from the same group */
  glue: string[][];
  filters: Filter[];
}

export const emptyMeta = (): Meta => ({ order: {}, groups: {}, style: {}, projects: {}, material: [], glue: [], filters: [] });

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function parseMeta(text: string): Meta {
  const m = emptyMeta();
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return m;
  }
  if (!raw || typeof raw !== "object") return m;
  for (const field of ["order", "groups"] as const) {
    const table = raw[field] as Record<string, unknown> | undefined;
    if (table && typeof table === "object") for (const [k, v] of Object.entries(table)) m[field][k] = strings(v);
  }
  const style = raw.style as Record<string, unknown> | undefined;
  if (style && typeof style === "object") for (const [k, v] of Object.entries(style)) if (typeof v === "string") m.style[k] = v;
  const projects = raw.projects as Record<string, Partial<Project>> | undefined;
  if (projects && typeof projects === "object") {
    for (const [k, p] of Object.entries(projects)) {
      if (!p || typeof p !== "object") continue;
      const sections: Record<string, SectionRole> = {};
      for (const [sp, role] of Object.entries(p.sections ?? {})) if (role === "manuscript" || role === "matter" || role === "material") sections[sp] = role;
      m.projects[k] = { template: String(p.template ?? ""), goal: Math.max(0, Math.floor(Number(p.goal) || 0)), deadline: /^\d{4}-\d{2}-\d{2}$/.test(String(p.deadline)) ? String(p.deadline) : "", sections };
    }
  }
  m.material = strings(raw.material);
  if (Array.isArray(raw.glue)) m.glue = raw.glue.map(strings).filter((g) => g.length > 1);
  if (Array.isArray(raw.filters)) {
    for (const f of raw.filters as Partial<Filter>[]) {
      if (f && typeof f.id === "string" && typeof f.name === "string") {
        m.filters.push({ id: f.id, name: f.name, query: String(f.query ?? ""), days: Number(f.days) || 0, group: String(f.group ?? "") });
      }
    }
  }
  return m;
}

export const parentOf = (p: string): string => {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
};

/** Apply a path rewrite (rename, move) everywhere paths are stored. */
export function remapMeta(m: Meta, fn: (p: string) => string): void {
  for (const field of ["order", "groups"] as const) {
    const moved: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(m[field])) moved[fn(k)] = v.map(fn);
    m[field] = moved;
  }
  m.style = Object.fromEntries(Object.entries(m.style).map(([k, v]) => [fn(k), v]));
  m.projects = Object.fromEntries(
    Object.entries(m.projects).map(([k, p]) => [fn(k), { ...p, sections: Object.fromEntries(Object.entries(p.sections).map(([sp, r]) => [fn(sp), r])) }]),
  );
  m.material = m.material.map(fn);
  m.glue = m.glue.map((g) => g.map(fn));
  m.filters = m.filters.map((f) => ({ ...f, group: f.group ? fn(f.group) : "" }));
  tidy(m);
}

/** Forget everything about paths that no longer exist. */
export function dropFromMeta(m: Meta, gone: (p: string) => boolean): void {
  for (const field of ["order", "groups"] as const) {
    for (const k of Object.keys(m[field])) {
      if (gone(k)) delete m[field][k];
      else m[field][k] = m[field][k].filter((p) => !gone(p));
    }
  }
  for (const k of Object.keys(m.style)) if (gone(k)) delete m.style[k];
  for (const [k, p] of Object.entries(m.projects)) {
    if (gone(k)) delete m.projects[k];
    else for (const sp of Object.keys(p.sections)) if (gone(sp)) delete p.sections[sp];
  }
  m.material = m.material.filter((p) => !gone(p));
  m.glue = m.glue.map((g) => g.filter((p) => !gone(p)));
  m.filters = m.filters.map((f) => (f.group && gone(f.group) ? { ...f, group: "" } : f));
  tidy(m);
}

/** Restore the invariants after paths moved: orders and glue only hold siblings, glue has 2+. */
export function tidy(m: Meta): void {
  for (const field of ["order", "groups"] as const) {
    for (const [k, v] of Object.entries(m[field])) {
      const kept = [...new Set(v.filter((p) => parentOf(p) === k))];
      if (kept.length) m[field][k] = kept;
      else delete m[field][k];
    }
  }
  // a project's sections are its direct subgroups; a project can't sit inside another project
  for (const [k, p] of Object.entries(m.projects)) {
    for (const sp of Object.keys(p.sections)) if (parentOf(sp) !== k) delete p.sections[sp];
    if (Object.keys(m.projects).some((other) => other !== k && k.startsWith(other + "/"))) delete m.projects[k];
  }
  m.material = [...new Set(m.material)];
  const seen = new Set<string>();
  m.glue = m.glue
    .map((g) => g.filter((p) => parentOf(p) === parentOf(g[0]) && !seen.has(p) && (seen.add(p), true)))
    .filter((g) => g.length > 1);
}

export const glueOf = (m: Meta, path: string): string[] | null => m.glue.find((g) => g.includes(path)) ?? null;

/**
 * Arranged sheets keep their place; sheets not arranged yet (new ones) follow, as given.
 * Glued sheets always sit together, in their reading order, where the first of them stands.
 */
export function arrange<T extends { path: string }>(m: Meta, group: string, sheets: T[]): T[] {
  const rank = new Map((m.order[group] ?? []).map((p, i) => [p, i]));
  const loose = sheets.filter((s) => !rank.has(s.path));
  const placed = sheets.filter((s) => rank.has(s.path)).sort((a, b) => rank.get(a.path)! - rank.get(b.path)!);
  const list = [...placed, ...loose];
  const byPath = new Map(list.map((s) => [s.path, s]));
  const done = new Set<string>();
  const out: T[] = [];
  for (const s of list) {
    if (done.has(s.path)) continue;
    const g = glueOf(m, s.path);
    const members = g && g.every((p) => byPath.has(p)) ? g : [s.path];
    for (const p of members) {
      done.add(p);
      out.push(byPath.get(p)!);
    }
  }
  return out;
}

/** Subgroups in the order you arranged them; new ones follow, as given (alphabetical). */
export function arrangeGroups<T extends { path: string }>(m: Meta, parent: string, groups: T[]): T[] {
  const rank = new Map((m.groups[parent] ?? []).map((p, i) => [p, i]));
  const placed = groups.filter((g) => rank.has(g.path)).sort((a, b) => rank.get(a.path)! - rank.get(b.path)!);
  return [...placed, ...groups.filter((g) => !rank.has(g.path))];
}

/** Marks that a glued sheet's text is a single document: this exact string joins its sheets. */
export const GLUE_MARK = "<!-- scriptorium:next-sheet -->";
export const GLUE_JOIN = `\n\n${GLUE_MARK}\n\n`;

// ---- merging, for when two devices change the structure file through a synced folder

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Set merge: whatever `mine` added or removed relative to `base`, applied on top of `theirs`. */
function mergeSet<T>(base: T[], mine: T[], theirs: T[]): T[] {
  const key = (x: T) => JSON.stringify(x);
  const inBase = new Set(base.map(key));
  const inMine = new Set(mine.map(key));
  const removed = new Set([...inBase].filter((k) => !inMine.has(k)));
  const kept = theirs.filter((x) => !removed.has(key(x)));
  const have = new Set(kept.map(key));
  return [...kept, ...mine.filter((x) => !inBase.has(key(x)) && !have.has(key(x)))];
}

/** Record merge: my change or removal of a key wins, anything I left alone takes their version. */
function mergeRecord<T>(base: Record<string, T>, mine: Record<string, T>, theirs: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)])) {
    const [b, m, t] = [base[k], mine[k], theirs[k]];
    const pick = b !== undefined && m === undefined ? undefined : !same(m, b) ? m : t;
    if (pick !== undefined) out[k] = pick;
  }
  return out;
}

/**
 * Three-way merge of the structure file. `base` is the last state both sides agreed on, `mine`
 * is this app's current state, `theirs` is what is on disk now. Changes made on both sides to
 * different things all survive; where both touched the same thing, lists are combined and
 * single values take `mine`.
 */
export function mergeMeta(base: Meta, mine: Meta, theirs: Meta): Meta {
  const out = emptyMeta();
  for (const field of ["order", "groups"] as const) {
    for (const k of new Set([...Object.keys(base[field]), ...Object.keys(mine[field]), ...Object.keys(theirs[field])])) {
      const b = base[field][k] ?? [];
      const m = mine[field][k] ?? [];
      const t = theirs[field][k] ?? [];
      out[field][k] = same(m, b) ? t : same(t, b) ? m : mergeSet(b, m, t);
    }
  }
  out.style = mergeRecord(base.style, mine.style, theirs.style);
  out.projects = mergeRecord(base.projects, mine.projects, theirs.projects);
  out.material = mergeSet(base.material, mine.material, theirs.material);
  out.glue = mergeSet(base.glue, mine.glue, theirs.glue);
  const byId = (fs: Filter[]) => new Map(fs.map((f) => [f.id, f]));
  const [fb, fm, ft] = [byId(base.filters), byId(mine.filters), byId(theirs.filters)];
  for (const id of new Set([...fb.keys(), ...fm.keys(), ...ft.keys()])) {
    const [b, m, t] = [fb.get(id), fm.get(id), ft.get(id)];
    if (b && !m) continue; // deleted here
    if (b && !t && same(m, b)) continue; // deleted there, untouched here
    const pick = m && (!b || !same(m, b)) ? m : (t ?? m);
    if (pick) out.filters.push(pick);
  }
  tidy(out);
  return out;
}
