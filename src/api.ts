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
interface MockStore {
  files: Record<string, MockFile>;
  dirs: string[];
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
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
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
  const persist = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(store));
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
    listTree: async () => build(""),
    listSheets: async (group, recursive) =>
      filesIn(group, recursive)
        .map((p) => {
          const f = store.files[p];
          const [title, preview] = titleAndPreview(f.content, baseOf(p).replace(/\.md$/, ""));
          return { path: p, title, preview, modified: Math.floor(f.modified / 1000), words: (f.content.match(/\S+/g) ?? []).length };
        })
        .sort((a, b) => b.modified - a.modified || a.title.localeCompare(b.title)),
    readSheet: (p) => (p in store.files ? Promise.resolve(store.files[p].content) : fail("Not found")),
    async writeSheet(p, content) {
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
      delete store.files[path];
      store.dirs = store.dirs.filter((d) => d !== path && !d.startsWith(path + "/"));
      for (const p of Object.keys(store.files)) if (p.startsWith(path + "/")) delete store.files[p];
      persist();
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
