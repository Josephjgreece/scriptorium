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

export interface Meta {
  /** group path -> sheet paths in the order the person arranged them */
  order: Record<string, string[]>;
  material: string[];
  /** each entry is a run of two or more sheets, in reading order, from the same group */
  glue: string[][];
  filters: Filter[];
}

export const emptyMeta = (): Meta => ({ order: {}, material: [], glue: [], filters: [] });

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
  const order = raw.order as Record<string, unknown> | undefined;
  if (order && typeof order === "object") for (const [k, v] of Object.entries(order)) m.order[k] = strings(v);
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
  const order: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(m.order)) order[fn(k)] = v.map(fn);
  m.order = order;
  m.material = m.material.map(fn);
  m.glue = m.glue.map((g) => g.map(fn));
  m.filters = m.filters.map((f) => ({ ...f, group: f.group ? fn(f.group) : "" }));
  tidy(m);
}

/** Forget everything about paths that no longer exist. */
export function dropFromMeta(m: Meta, gone: (p: string) => boolean): void {
  for (const k of Object.keys(m.order)) {
    if (gone(k)) delete m.order[k];
    else m.order[k] = m.order[k].filter((p) => !gone(p));
  }
  m.material = m.material.filter((p) => !gone(p));
  m.glue = m.glue.map((g) => g.filter((p) => !gone(p)));
  m.filters = m.filters.map((f) => (f.group && gone(f.group) ? { ...f, group: "" } : f));
  tidy(m);
}

/** Restore the invariants after paths moved: orders and glue only hold siblings, glue has 2+. */
export function tidy(m: Meta): void {
  for (const [k, v] of Object.entries(m.order)) {
    const kept = [...new Set(v.filter((p) => parentOf(p) === k))];
    if (kept.length) m.order[k] = kept;
    else delete m.order[k];
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

/** Marks that a glued sheet's text is a single document: this exact string joins its sheets. */
export const GLUE_MARK = "<!-- scriptorium:next-sheet -->";
export const GLUE_JOIN = `\n\n${GLUE_MARK}\n\n`;
