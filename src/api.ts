import { countWords, stripComments } from "./text";

// Backend bridge. In the desktop app every call goes to the Rust side (plain files on disk).
// In a plain browser (`npm run dev` without Tauri) a localStorage-backed stand-in is used so
// the UI can be developed and tested without building the desktop shell.

export interface Group {
  name: string;
  path: string;
  count: number;
  children: Group[];
}
export interface SheetInfo {
  path: string;
  title: string;
  preview: string;
  modified: number;
  words: number;
  /** a copy a sync service made when two devices edited the same sheet */
  conflict: boolean;
  /** for a conflicted copy: the sheet it was copied from, when that still exists */
  original: string | null;
}
export interface TrashItem {
  /** the entry's name inside .trash; what the trash calls take */
  id: string;
  name: string;
  title: string;
  preview: string;
  isGroup: boolean;
  /** where it was before it was deleted ("" when unknown) */
  original: string;
  deleted: number;
  sheets: number;
  words: number;
}
export interface SearchHit {
  path: string;
  title: string;
  snippet: string;
}

export interface Api {
  readonly desktop: boolean;
  libraryRoot(): Promise<string>;
  listTree(): Promise<Group>;
  listSheets(group: string, recursive: boolean): Promise<SheetInfo[]>;
  readSheet(path: string): Promise<string>;
  writeSheet(path: string, content: string): Promise<string>;
  createSheet(group: string): Promise<string>;
  createGroup(parent: string, name: string): Promise<string>;
  renameItem(path: string, newName: string): Promise<string>;
  deleteItem(path: string): Promise<void>;
  moveItem(path: string, destGroup: string): Promise<string>;
  search(query: string): Promise<SearchHit[]>;
  /** Returns the saved file path, or null if the person cancelled. */
  exportSheet(path: string, suggestedName: string): Promise<string | null>;
  /** Export text that isn't one file on disk (glued sheets). */
  exportText(content: string, suggestedName: string): Promise<string | null>;
  listTrash(): Promise<TrashItem[]>;
  readTrash(id: string): Promise<string>;
  /** Put an item back where it came from; returns its new path. */
  restoreTrash(id: string): Promise<string>;
  purgeTrash(id: string): Promise<void>;
  emptyTrash(): Promise<number>;
  /** True when the library folder is fixed by the SCRIPTORIUM_LIBRARY environment variable. */
  libraryLocked(): Promise<boolean>;
  /** Ask for a folder and switch to it; returns its path, or null if cancelled. */
  chooseLibrary(): Promise<string | null>;
  /** Changes whenever anything in the library changes on disk (outside edits, sync). */
  stamp(): Promise<string>;
  /** Settle a conflicted copy: keep it (replacing the original) or discard it. */
  resolveConflict(path: string, keepCopy: boolean): Promise<string>;
  /** Save text beside a sheet as a conflicted copy, so nothing is lost. Returns the new path. */
  saveConflictCopy(path: string, content: string): Promise<string>;
  /** Structure metadata (order, material, glue, filters) as JSON text; "" when none saved yet. */
  readMeta(): Promise<string>;
  writeMeta(json: string): Promise<void>;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// ---------------------------------------------------------------- desktop

async function tauriApi(): Promise<Api> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { save } = await import("@tauri-apps/plugin-dialog");
  return {
    desktop: true,
    libraryRoot: () => invoke("library_root"),
    listTree: () => invoke("list_tree"),
    listSheets: (group, recursive) => invoke("list_sheets", { group, recursive }),
    readSheet: (path) => invoke("read_sheet", { path }),
    writeSheet: (path, content) => invoke("write_sheet", { path, content }),
    createSheet: (group) => invoke("create_sheet", { group }),
    createGroup: (parent, name) => invoke("create_group", { parent, name }),
    renameItem: (path, newName) => invoke("rename_item", { path, newName }),
    deleteItem: (path) => invoke("delete_item", { path }),
    moveItem: (path, destGroup) => invoke("move_item", { path, destGroup }),
    search: (query) => invoke("search", { query }),
    async exportSheet(path, suggestedName) {
      const dest = await pickExportPath(suggestedName);
      if (!dest) return null;
      await invoke("export_sheet", { path, dest });
      return dest;
    },
    async exportText(content, suggestedName) {
      const dest = await pickExportPath(suggestedName);
      if (!dest) return null;
      await invoke("export_text", { content, dest });
      return dest;
    },
    listTrash: () => invoke("list_trash"),
    readTrash: (id) => invoke("read_trash_sheet", { id }),
    restoreTrash: (id) => invoke("restore_trash", { id }),
    purgeTrash: (id) => invoke("purge_trash", { id }),
    emptyTrash: () => invoke("empty_trash"),
    libraryLocked: () => invoke("library_locked"),
    async chooseLibrary() {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const dir = await open({ directory: true, multiple: false, title: "Choose library folder" });
      return typeof dir === "string" ? invoke<string>("set_library", { path: dir }) : null;
    },
    stamp: () => invoke("library_stamp"),
    resolveConflict: (path, keepCopy) => invoke("resolve_conflict", { path, keepCopy }),
    saveConflictCopy: (path, content) => invoke("save_conflict_copy", { path, content }),
    readMeta: () => invoke("read_meta"),
    writeMeta: (json) => invoke("write_meta", { json }),
  };

  async function pickExportPath(suggestedName: string): Promise<string | null> {
    const safe = suggestedName.replace(/[\\/:*?"<>|]/g, "").trim() || "Sheet";
    return save({
      defaultPath: `${safe}.docx`,
      filters: [
        { name: "Word document", extensions: ["docx"] },
        { name: "PDF (needs a LaTeX engine)", extensions: ["pdf"] },
        { name: "HTML", extensions: ["html"] },
        { name: "OpenDocument", extensions: ["odt"] },
        { name: "EPUB", extensions: ["epub"] },
      ],
    });
  }
}

// ---------------------------------------------------------------- browser stand-in

interface MockFile {
  content: string;
  modified: number;
}
interface TrashRec {
  id: string;
  original: string;
  group: boolean;
  /** paths relative to the deleted item (a sheet is just its own name) */
  files: Record<string, MockFile>;
  dirs: string[];
  deleted: number;
}
interface MockStore {
  files: Record<string, MockFile>;
  dirs: string[];
  trash?: TrashRec[];
}

const KEY = "scriptorium-web-library";
const META_KEY = "scriptorium-web-meta";

// Browser preview: "export" downloads the Markdown itself.
function download(text: string, name: string): string {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  a.download = `${name || "Sheet"}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
  return a.download;
}

function parentOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}
function baseOf(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}
function join(a: string, b: string): string {
  return a ? `${a}/${b}` : b;
}
function cleanTitle(line: string): string {
  return line.trim().replace(/^[#>\s]+/, "").replace(/[*_`]/g, "").trim();
}
function titleAndPreview(text: string, fallback: string): [string, string] {
  const lines = stripComments(text).split("\n").map((l) => l.trim()).filter(Boolean);
  const title = lines[0] ? cleanTitle(lines[0]) || fallback : fallback;
  return [title, (lines[1] ?? "").slice(0, 140)];
}
function slugify(title: string): string {
  return title.replace(/[^\p{L}\p{N} _-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 60).trim();
}

const WELCOME =
  "# Welcome to Scriptorium\n\nThis is the browser preview: your sheets live in this browser only. " +
  "In the desktop app they are plain Markdown files in a folder.\n\n## Shortcuts\n\n" +
  "- Ctrl/Cmd+N: new sheet\n- Ctrl/Cmd+Shift+N: new group\n- Ctrl/Cmd+K: search\n" +
  "- Ctrl/Cmd+Shift+T: typewriter mode\n- Ctrl/Cmd+Shift+F: focus mode\n- Ctrl/Cmd+Shift+D: theme\n";

function webApi(): Api {
  let store: MockStore;
  try {
    store = JSON.parse(localStorage.getItem(KEY) ?? "") as MockStore;
  } catch {
    store = { files: { "Welcome.md": { content: WELCOME, modified: Date.now() } }, dirs: [] };
  }
  let lastRaw = localStorage.getItem(KEY);
  // Pick up changes made behind our back (another tab, like a sync client touching the folder).
  const reload = () => {
    const raw = localStorage.getItem(KEY);
    if (raw && raw !== lastRaw) {
      try {
        store = JSON.parse(raw) as MockStore;
        lastRaw = raw;
      } catch {
        /* ignore a half-written value */
      }
    }
  };
  const conflictOf = (p: string): string | null => {
    const m = baseOf(p).replace(/\.md$/, "").match(/^(.*?)\s*\([^)]*conflicted copy[^)]*\)(.*)$/i);
    return m && (m[1] + m[2]).trim() ? join(parentOf(p), `${(m[1] + m[2]).trim()}.md`) : null;
  };
  const persist = () => {
    try {
      lastRaw = JSON.stringify(store);
      localStorage.setItem(KEY, lastRaw);
    } catch {
      /* storage unavailable: keep in memory only */
    }
  };
  const unique = (dir: string, stem: string, ext: string): string => {
    const taken = (name: string) => join(dir, name) in store.files || store.dirs.includes(join(dir, name));
    let name = ext ? `${stem}.${ext}` : stem;
    for (let n = 2; taken(name); n++) name = ext ? `${stem} ${n}.${ext}` : `${stem} ${n}`;
    return join(dir, name);
  };
  const filesIn = (group: string, recursive: boolean) =>
    Object.keys(store.files).filter((p) => (recursive ? !group || p.startsWith(group + "/") : parentOf(p) === group));
  const build = (path: string): Group => ({
    name: path ? baseOf(path) : "Library",
    path,
    count: filesIn(path, false).length,
    children: store.dirs
      .filter((d) => parentOf(d) === path)
      .sort((a, b) => baseOf(a).toLowerCase().localeCompare(baseOf(b).toLowerCase()))
      .map(build),
  });
  const fail = (m: string) => Promise.reject(new Error(m));

  return {
    desktop: false,
    libraryRoot: async () => "Browser preview (stored in this browser)",
    listTree: async () => {
      reload();
      return build("");
    },
    listSheets: async (group, recursive) => {
      reload();
      return filesIn(group, recursive)
        .map((p) => {
          const f = store.files[p];
          const [title, preview] = titleAndPreview(f.content, baseOf(p).replace(/\.md$/, ""));
          return { path: p, title, preview, modified: Math.floor(f.modified / 1000), words: countWords(f.content), conflict: conflictOf(p) !== null, original: conflictOf(p) && conflictOf(p)! in store.files ? conflictOf(p) : null };
        })
        .sort((a, b) => b.modified - a.modified || a.title.localeCompare(b.title));
    },
    readSheet: async (p) => {
      reload();
      return p in store.files ? store.files[p].content : fail("Not found");
    },
    async writeSheet(p, content) {
      reload();
      if (!(p in store.files)) return fail("Not found");
      store.files[p] = { content, modified: Date.now() };
      let out = p;
      const stem = baseOf(p).replace(/\.md$/, "");
      if (/^Untitled( \d+)?$/.test(stem)) {
        const slug = slugify(titleAndPreview(content, "")[0]);
        if (slug) {
          const target = unique(parentOf(p), slug, "md");
          if (target !== p) {
            store.files[target] = store.files[p];
            delete store.files[p];
            out = target;
          }
        }
      }
      persist();
      return out;
    },
    async createSheet(group) {
      const p = unique(group, "Untitled", "md");
      store.files[p] = { content: "", modified: Date.now() };
      persist();
      return p;
    },
    async createGroup(parent, name) {
      const n = name.trim();
      if (!n || /[\\/:*?"<>|]/.test(n) || n.startsWith(".")) return fail("That name isn't allowed");
      const p = join(parent, n);
      if (store.dirs.includes(p) || p in store.files) return fail("Something with that name already exists");
      store.dirs.push(p);
      persist();
      return p;
    },
    async renameItem(path, newName) {
      const n = newName.trim();
      if (!n || /[\\/:*?"<>|]/.test(n) || n.startsWith(".")) return fail("That name isn't allowed");
      if (path in store.files) {
        const target = join(parentOf(path), /\.md$/i.test(n) ? n : n + ".md");
        if (target === path) return path;
        if (target in store.files) return fail("Something with that name already exists");
        store.files[target] = store.files[path];
        delete store.files[path];
        persist();
        return target;
      }
      const target = join(parentOf(path), n);
      if (target === path) return path;
      if (store.dirs.includes(target)) return fail("Something with that name already exists");
      const remap = (p: string) => (p === path || p.startsWith(path + "/") ? target + p.slice(path.length) : p);
      store.dirs = store.dirs.map(remap);
      store.files = Object.fromEntries(Object.entries(store.files).map(([p, f]) => [remap(p), f]));
      persist();
      return target;
    },
    async deleteItem(path) {
      reload();
      const rec: TrashRec = { id: `${Date.now()}-${baseOf(path)}`, original: path, group: !(path in store.files), files: {}, dirs: [], deleted: Date.now() };
      if (path in store.files) rec.files[baseOf(path)] = store.files[path];
      else {
        for (const [p, f] of Object.entries(store.files)) if (p.startsWith(path + "/")) rec.files[p.slice(path.length + 1)] = f;
        rec.dirs = store.dirs.filter((d) => d.startsWith(path + "/")).map((d) => d.slice(path.length + 1));
      }
      (store.trash ??= []).push(rec);
      delete store.files[path];
      store.dirs = store.dirs.filter((d) => d !== path && !d.startsWith(path + "/"));
      for (const p of Object.keys(store.files)) if (p.startsWith(path + "/")) delete store.files[p];
      persist();
    },
    async listTrash() {
      reload();
      return (store.trash ?? [])
        .map((r): TrashItem => {
          const files = Object.entries(r.files);
          const words = files.reduce((n, [, f]) => n + countWords(f.content), 0);
          if (r.group) {
            return { id: r.id, name: baseOf(r.original), title: baseOf(r.original), preview: `${files.length} ${files.length === 1 ? "sheet" : "sheets"}`, isGroup: true, original: r.original, deleted: Math.floor(r.deleted / 1000), sheets: files.length, words };
          }
          const [title, preview] = titleAndPreview(files[0][1].content, baseOf(r.original).replace(/\.md$/, ""));
          return { id: r.id, name: baseOf(r.original), title, preview, isGroup: false, original: r.original, deleted: Math.floor(r.deleted / 1000), sheets: 1, words };
        })
        .sort((a, b) => b.deleted - a.deleted || a.title.localeCompare(b.title));
    },
    async readTrash(id) {
      reload();
      const r = store.trash?.find((x) => x.id === id);
      return r && !r.group ? Object.values(r.files)[0].content : fail("Not in the trash");
    },
    async restoreTrash(id) {
      reload();
      const r = store.trash?.find((x) => x.id === id);
      if (!r) return fail("Not in the trash");
      const parent = parentOf(r.original);
      for (let d = parent; d; d = parentOf(d)) if (!store.dirs.includes(d)) store.dirs.push(d);
      let target: string;
      if (r.group) {
        target = unique(parent, baseOf(r.original), "");
        store.dirs.push(target, ...r.dirs.map((d) => join(target, d)));
        for (const [rel, f] of Object.entries(r.files)) store.files[join(target, rel)] = f;
      } else {
        target = unique(parent, baseOf(r.original).replace(/\.md$/, ""), "md");
        store.files[target] = Object.values(r.files)[0];
      }
      store.trash = store.trash!.filter((x) => x.id !== id);
      persist();
      return target;
    },
    async purgeTrash(id) {
      reload();
      store.trash = (store.trash ?? []).filter((x) => x.id !== id);
      persist();
    },
    async emptyTrash() {
      reload();
      const n = store.trash?.length ?? 0;
      store.trash = [];
      persist();
      return n;
    },
    async moveItem(path, destGroup) {
      if (parentOf(path) === destGroup) return path;
      if (path in store.files) {
        const target = unique(destGroup, baseOf(path).replace(/\.md$/, ""), "md");
        store.files[target] = store.files[path];
        delete store.files[path];
        persist();
        return target;
      }
      if (destGroup === path || destGroup.startsWith(path + "/")) return fail("A group can't be moved into itself");
      const target = unique(destGroup, baseOf(path), "");
      const remap = (p: string) => (p === path || p.startsWith(path + "/") ? target + p.slice(path.length) : p);
      store.dirs = store.dirs.map(remap);
      store.files = Object.fromEntries(Object.entries(store.files).map(([p, f]) => [remap(p), f]));
      persist();
      return target;
    },
    async search(query) {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const hits: SearchHit[] = [];
      for (const [p, f] of Object.entries(store.files)) {
        const [title] = titleAndPreview(f.content, baseOf(p).replace(/\.md$/, ""));
        const line = f.content.split("\n").find((l) => l.toLowerCase().includes(q));
        if (line !== undefined || title.toLowerCase().includes(q)) {
          hits.push({ path: p, title, snippet: (line ?? "").trim().slice(0, 140) });
        }
      }
      return hits.slice(0, 100);
    },
    async exportSheet(path, suggestedName) {
      return download(store.files[path]?.content ?? "", suggestedName);
    },
    async exportText(content, suggestedName) {
      return download(content, suggestedName);
    },
    libraryLocked: async () => false,
    chooseLibrary: async () => null,
    stamp: async () => {
      reload();
      return String(Object.entries(store.files).reduce((n, [k, f]) => n + f.modified + f.content.length + k.length, store.dirs.length) + (localStorage.getItem(META_KEY)?.length ?? 0));
    },
    async resolveConflict(path, keepCopy) {
      const original = conflictOf(path);
      if (!original || !(original in store.files)) return fail("The original sheet isn't there any more");
      if (keepCopy) store.files[original] = store.files[path];
      delete store.files[path];
      persist();
      return original;
    },
    async saveConflictCopy(path, content) {
      const p = unique(parentOf(path), `${baseOf(path).replace(/\.md$/, "")} (conflicted copy)`, "md");
      store.files[p] = { content, modified: Date.now() };
      persist();
      return p;
    },
    readMeta: async () => localStorage.getItem(META_KEY) ?? "",
    async writeMeta(json) {
      try {
        localStorage.setItem(META_KEY, json);
      } catch {
        /* storage unavailable */
      }
    },
  };
}

export async function loadApi(): Promise<Api> {
  return isTauri ? tauriApi() : webApi();
}
