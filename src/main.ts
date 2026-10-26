import "./styles.css";
import { loadApi, type Api, type Group, type SearchHit, type SheetInfo, type TrashItem } from "./api";
import { createEditor, makeState } from "./editor";
import { arrange, arrangeGroups, dropFromMeta, emptyMeta, glueOf, GLUE_JOIN, mergeMeta, parentOf, parseMeta, remapMeta, type Filter, type Meta } from "./meta";

// ------------------------------------------------------------------ small helpers

type Kid = Node | string | null | undefined;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...kids: Kid[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = String(v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids) if (kid != null) el.append(kid);
  return el;
}

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`#${id} missing`);
  return found as T;
}

function ls(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

const ICONS: Record<string, string> = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  folderPlus: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/>',
  type: '<path d="M4 7V5h16v2M12 5v14M9 19h6"/>',
  theme: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  export: '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>',
  focus: '<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  sidebar: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M9.5 5v14"/>',
  book: '<path d="M5 4.5h10a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h10"/>',
  star: '<path d="M12 4l2.4 5 5.4.7-4 3.8 1 5.4L12 16.3 7.2 18.9l1-5.4-4-3.8 5.4-.7z"/>',
  heart: '<path d="M12 19s-7-4.4-7-9.5A4 4 0 0 1 12 7a4 4 0 0 1 7 2.5C19 14.6 12 19 12 19z"/>',
  flag: '<path d="M6 20V5M6 5h11l-2 3.5 2 3.5H6"/>',
  bookmark: '<path d="M7 4h10v16l-5-3.5L7 20z"/>',
  bolt: '<path d="M13 3L6 13.5h5L10 21l8-11h-5.5z"/>',
  bulb: '<path d="M9 17h6M10 20h4M12 4a5.5 5.5 0 0 0-3 10v3h6v-3a5.5 5.5 0 0 0-3-10z"/>',
  leaf: '<path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14"/><path d="M5 19c3-4 6-6 9-8"/>',
  pen: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12M10.5 10.5v6M13.5 10.5v6"/>',
  warn: '<path d="M12 4.5l8.5 15h-17z"/><path d="M12 10v4.2M12 16.8v.2"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  funnel: '<path d="M4 5h16l-6 7.5V19l-4-2v-4.5z"/>',
  torn: '<path d="M6 4h12v13l-2 2.2-2-2.2-2 2.2-2-2.2-2 2.2-2-2.2z"/><path d="M9 9h6M9 12.5h4"/>',
  glue: '<path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1"/><path d="M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1"/>',
  all: '<path d="M7 4h10a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M9 4v16"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  doc: '<path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10.5a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5z"/><path d="M9 12h6M9 15.5h6M9 8.5h3"/>',
  inbox: '<path d="M4 13l2.5-7h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M4 13h4.5l1 2h5l1-2H20"/>',
};
/** Icons and colours a group can be given in the sidebar. */
const GROUP_ICONS = ["doc", "book", "star", "heart", "flag", "bookmark", "bolt", "bulb", "leaf", "pen"];
const GROUP_COLORS: Record<string, string> = { blue: "#3b78d8", teal: "#2f93c0", green: "#3a9a5b", orange: "#d9822b", red: "#c8453b", purple: "#8a58c8" };

function icon(name: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICONS[name];
  return svg;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

let toastTimer = 0;
function toast(text: string): void {
  const t = el("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("show"), 3200);
}

function whenText(secs: number): string {
  if (!secs) return "";
  const d = new Date(secs * 1000);
  const now = new Date();
  const day = (x: Date) => Math.floor(new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime() / 86400000);
  const diff = day(now) - day(d);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

// ------------------------------------------------------------------ modals + menus

function modal(build: (close: (v: string | null) => void, ov: HTMLElement) => HTMLElement): Promise<string | null> {
  return new Promise((resolve) => {
    const ov = h("div", { class: "modal-ov" });
    const close = (v: string | null) => {
      ov.remove();
      window.removeEventListener("keydown", onKey, true);
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(null);
      }
    };
    ov.addEventListener("mousedown", (e) => {
      if (e.target === ov) close(null);
    });
    ov.append(build(close, ov));
    document.body.append(ov);
    window.addEventListener("keydown", onKey, true);
  });
}

function askText(title: string, initial = "", okLabel = "OK"): Promise<string | null> {
  return modal((close) => {
    const input = h("input", { type: "text", value: initial, spellcheck: "false" });
    const ok = () => {
      const v = input.value.trim();
      close(v || null);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") ok();
    });
    queueMicrotask(() => {
      input.focus();
      input.select();
    });
    return h(
      "div",
      { class: "modal" },
      h("h3", {}, title),
      input,
      h("div", { class: "actions" }, h("button", { class: "btn", onclick: () => close(null) }, "Cancel"), h("button", { class: "btn primary", onclick: ok }, okLabel)),
    );
  });
}

async function askConfirm(title: string, body: string, okLabel: string): Promise<boolean> {
  const r = await modal((close) => {
    const okBtn = h("button", { class: "btn primary", onclick: () => close("yes") }, okLabel);
    queueMicrotask(() => okBtn.focus());
    return h("div", { class: "modal" }, h("h3", {}, title), h("p", {}, body), h("div", { class: "actions" }, h("button", { class: "btn", onclick: () => close(null) }, "Cancel"), okBtn));
  });
  return r === "yes";
}

interface MenuItem {
  label: string;
  run: () => void;
  danger?: boolean;
  sep?: boolean;
}
function showMenu(x: number, y: number, items: MenuItem[]): void {
  document.querySelector(".menu")?.remove();
  const menu = h("div", { class: "menu", role: "menu" });
  for (const it of items) {
    if (it.sep) menu.append(h("div", { class: "menu-sep" }));
    menu.append(
      h("div", {
        class: "menu-item" + (it.danger ? " danger" : ""),
        role: "menuitem",
        onclick: () => {
          menu.remove();
          it.run();
        },
      }, it.label),
    );
  }
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
  const away = (e: Event) => {
    if (!menu.contains(e.target as Node)) {
      menu.remove();
      window.removeEventListener("mousedown", away, true);
    }
  };
  window.addEventListener("mousedown", away, true);
  window.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape") {
      menu.remove();
      window.removeEventListener("keydown", esc);
    }
  });
}

// ------------------------------------------------------------------ app

async function main(): Promise<void> {
  const api: Api = await loadApi();

  type View = { kind: "all" } | { kind: "recent" } | { kind: "conflicts" } | { kind: "trash" } | { kind: "filter"; id: string } | { kind: "group"; path: string };
  const S = {
    tree: null as Group | null,
    view: { kind: "group", path: "" } as View,
    sheets: [] as SheetInfo[],
    hits: null as SearchHit[] | null,
    current: null as string | null,
    /** when the open text is several glued sheets: their paths, in reading order */
    glue: null as string[] | null,
    savedParts: [] as string[],
    meta: emptyMeta() as Meta,
    /** every sheet in the library, refreshed with the lists */
    all: [] as SheetInfo[],
    trash: [] as TrashItem[],
    /** id of the trashed sheet shown read-only in the editor */
    trashPreview: null as string | null,
    /** keys (first path) of the selected list rows */
    sel: new Set<string>(),
    anchor: null as string | null,
    /** the row the keyboard is on (the end of a Shift-extended selection) */
    cursor: null as string | null,
    version: 0,
    savedVersion: 0,
    typewriter: ls("typewriter") === "1",
    theme: ls("theme") ?? "auto",
    noLib: ls("noLib") === "1",
    collapsed: new Set<string>(safeJson(ls("collapsed"))),
  };

  function safeJson(s: string | null): string[] {
    try {
      const v = JSON.parse(s ?? "[]");
      return Array.isArray(v) ? v.map(String) : [];
    } catch {
      return [];
    }
  }

  const treeEl = el("tree");
  const sheetsEl = el("sheets");
  const listTitle = el("listTitle");
  const searchEl = el<HTMLInputElement>("search");
  const crumb = el("edCrumb");

  // -------- editor
  const view = createEditor(el("editor"));
  const hooks = { onChange: onDocChanged, isTypewriter: () => S.typewriter };
  const setDoc = (text: string, glued = false, readOnly = false) => view.setState(makeState(text, hooks, glued, readOnly));
  setDoc("");

  // -------- icons on static buttons
  el("btnSidebar").append(icon("sidebar"));
  el("btnSidebar2").append(icon("sidebar"));
  el("btnNewGroup").append(icon("folderPlus"));
  el("btnNewSheet").append(icon("plus"));
  el("btnTypewriter").append(icon("type"));
  el("btnTheme").append(icon("theme"));
  el("btnExport").append(icon("export"));
  el("btnFocus").append(icon("focus"));

  // -------- theme / modes
  function applyTheme(): void {
    document.documentElement.dataset.theme = S.theme;
    el("btnTheme").title = `Theme: ${S.theme} (Ctrl/Cmd+Shift+D)`;
  }
  function cycleTheme(): void {
    S.theme = S.theme === "auto" ? "light" : S.theme === "light" ? "dark" : "auto";
    lsSet("theme", S.theme);
    applyTheme();
    toast(`Theme: ${S.theme}`);
  }
  function applyTypewriter(): void {
    document.body.classList.toggle("typewriter", S.typewriter);
    el("btnTypewriter").classList.toggle("on", S.typewriter);
  }
  function toggleTypewriter(): void {
    S.typewriter = !S.typewriter;
    lsSet("typewriter", S.typewriter ? "1" : "0");
    applyTypewriter();
    if (S.typewriter) view.dispatch({ effects: [], scrollIntoView: true });
    toast(`Typewriter mode ${S.typewriter ? "on" : "off"}`);
  }
  function applySidebar(): void {
    document.body.classList.toggle("no-lib", S.noLib);
    el("btnSidebar").classList.toggle("on", false);
  }
  function toggleSidebar(): void {
    S.noLib = !S.noLib;
    lsSet("noLib", S.noLib ? "1" : "0");
    applySidebar();
  }
  function toggleFocus(): void {
    const on = document.body.classList.toggle("focus");
    el("btnFocus").classList.toggle("on", on);
    if (current()) view.focus();
  }
  applyTheme();
  applyTypewriter();
  applySidebar();

  const current = () => S.current;

  // -------- status bar
  function updateStats(): void {
    const text = view.state.doc.toString().split(GLUE_JOIN).join("\n\n");
    const words = (text.match(/\S+/g) ?? []).length;
    el("stWords").textContent = `${words.toLocaleString()} ${words === 1 ? "word" : "words"}`;
    el("stChars").textContent = `${text.length.toLocaleString()} characters`;
    el("stRead").textContent = isMaterial(S.current) ? "Material · not counted in totals" : `${Math.max(words ? 1 : 0, Math.ceil(words / 220))} min read`;
  }
  function setSave(text: string): void {
    el("stSave").textContent = text;
  }
  function setHasNone(none: boolean): void {
    document.body.classList.toggle("has-none", none);
  }

  // -------- structure metadata (order, material, glue, filters)
  // `metaBase` is the last structure both this app and the disk agreed on. Writing merges it with
  // whatever another device saved in the meantime, so synced devices don't overwrite each other.
  let metaBase: Meta = emptyMeta();
  let metaChain: Promise<void> = Promise.resolve();
  const json = (m: Meta): string => JSON.stringify(m);

  async function mergeAndWrite(): Promise<void> {
    const disk = parseMeta(await api.readMeta());
    if (json(disk) !== json(metaBase)) S.meta = mergeMeta(metaBase, S.meta, disk);
    if (json(S.meta) !== json(disk)) await api.writeMeta(json(S.meta));
    metaBase = parseMeta(json(S.meta));
  }
  function persistMeta(): void {
    const before = json(S.meta);
    metaChain = metaChain
      .then(mergeAndWrite)
      .then(() => {
        if (json(S.meta) !== before) void refresh(); // another device's changes arrived with ours
      })
      .catch((e) => toast(`Couldn't save structure: ${msg(e)}`));
  }
  const isMaterial = (path: string | null): boolean => !!path && S.meta.material.includes(path);
  const isOpen = (path: string): boolean => path === S.current || !!S.glue?.includes(path);

  function applyMaterialClass(): void {
    document.body.classList.toggle("is-material", isMaterial(S.current));
    updateStats();
  }
  function refreshCrumb(): void {
    if (!S.current) {
      crumb.textContent = "";
      return;
    }
    const name = (S.current.split("/").pop() ?? "").replace(/\.md$/i, "");
    crumb.textContent = `${groupOf(S.current)}  ›  ${name}${S.glue ? `  +${S.glue.length - 1} glued` : ""}`;
  }

  /** Every path-changing operation (rename, move, untitled → named) funnels through here. */
  function applyRemap(fn: (p: string) => string): void {
    remapMeta(S.meta, fn);
    persistMeta();
    if (S.current) S.current = fn(S.current);
    if (S.glue) S.glue = S.glue.map(fn);
    S.sel = new Set([...S.sel].map(fn));
    S.anchor = S.anchor ? fn(S.anchor) : null;
    if (S.view.kind === "group") S.view = { kind: "group", path: fn(S.view.path) };
    S.collapsed = new Set([...S.collapsed].map(fn));
    lsSet("collapsed", JSON.stringify([...S.collapsed]));
    refreshCrumb();
    applyMaterialClass();
  }

  // -------- saving
  let saveTimer = 0;
  let chain: Promise<void> = Promise.resolve();
  let listTimer = 0;

  function onDocChanged(): void {
    S.version++;
    setSave("Editing…");
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void flushSave(), 700);
    updateStats();
  }

  let saving = 0;
  let failing = false;
  let retryTimer = 0;
  const DRAFT_KEY = "scriptorium-unsaved-draft";

  const isDirty = (): boolean => !!S.current && S.version !== S.savedVersion;

  /** Put the open text back from disk (after it changed elsewhere), keeping the caret and scroll. */
  function loadOpen(texts: string[]): void {
    const head = view.state.selection.main.head;
    const top = view.scrollDOM.scrollTop;
    S.savedParts = texts;
    const joined = texts.join(GLUE_JOIN);
    setDoc(joined, !!S.glue);
    S.version = S.savedVersion = 0;
    view.dispatch({ selection: { anchor: Math.min(head, joined.length) } });
    view.scrollDOM.scrollTop = top;
    updateStats();
  }

  async function doSave(): Promise<void> {
    if (!S.current || S.version === S.savedVersion) return;
    const v = S.version;
    const text = view.state.doc.toString();
    const paths = S.glue ?? [S.current];
    const parts = S.glue ? text.split(GLUE_JOIN) : [text];
    if (parts.length !== paths.length) throw new Error("a divider between glued sheets was damaged");
    saving++;
    try {
      const renamed = new Map<string, string>();
      let elsewhere: string | null = null;
      for (let i = 0; i < paths.length; i++) {
        if (parts[i] === S.savedParts[i]) continue;
        // Did the file change outside the app since we loaded it? Never overwrite that silently:
        // the other version stays as the sheet, and what was typed here is kept as a copy.
        const onDisk = await api.readSheet(paths[i]).catch(() => null);
        if (onDisk !== null && onDisk !== S.savedParts[i]) {
          await api.saveConflictCopy(paths[i], parts[i]);
          S.savedParts[i] = onDisk;
          elsewhere = paths[i];
          continue;
        }
        const np = await api.writeSheet(paths[i], parts[i]);
        S.savedParts[i] = parts[i];
        if (np !== paths[i]) renamed.set(paths[i], np);
      }
      S.savedVersion = v;
      localStorage.removeItem(DRAFT_KEY);
      if (renamed.size && S.current === paths[0]) applyRemap((p) => renamed.get(p) ?? p);
      if (elsewhere) {
        if (S.version === v) loadOpen(S.savedParts);
        toast(`“${titleOf(elsewhere)}” was changed elsewhere. Your edits are kept as a conflicted copy beside it.`);
        setSave("Changed elsewhere");
      } else {
        setSave(S.version === v ? "Saved" : "Editing…");
      }
      scheduleListRefresh();
    } finally {
      saving--;
    }
  }

  function flushSave(): Promise<void> {
    clearTimeout(saveTimer);
    chain = chain
      .then(doSave)
      .then(() => {
        failing = false;
        clearTimeout(retryTimer);
      })
      .catch((e) => {
        setSave("Not saved. Retrying…");
        if (!failing) toast(`Couldn't save: ${msg(e)}. Your text is safe here and I'll keep trying.`);
        failing = true;
        stashDraft();
        clearTimeout(retryTimer);
        retryTimer = window.setTimeout(() => void flushSave(), 5000);
      });
    return chain;
  }

  /** Last resort for text that couldn't be written: keep it where it survives closing the app. */
  function stashDraft(): void {
    if (!isDirty() || !S.current) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ path: S.glue?.[0] ?? S.current, text: view.state.doc.toString() }));
    } catch {
      /* nothing more we can do */
    }
  }

  /** On start-up: text stashed because it couldn't be saved becomes a copy beside its sheet. */
  async function recoverDraft(): Promise<void> {
    const raw = ls(DRAFT_KEY);
    if (!raw) return;
    try {
      const d = JSON.parse(raw) as { path: string; text: string };
      const copy = await api.saveConflictCopy(d.path, d.text.split(GLUE_JOIN).join("\n\n"));
      localStorage.removeItem(DRAFT_KEY);
      toast(`Recovered text that couldn't be saved last time: “${copy.split("/").pop()?.replace(/\.md$/i, "")}”`);
    } catch {
      /* the sheet may be gone; keep the draft for next time */
    }
  }

  function scheduleListRefresh(): void {
    clearTimeout(listTimer);
    listTimer = window.setTimeout(() => void refresh(), 350);
  }

  window.addEventListener("blur", () => void flushSave());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) void flushSave();
  });
  window.addEventListener("beforeunload", (e) => {
    if (!isDirty()) return;
    stashDraft(); // if the write below doesn't finish, the text is recovered next start
    void flushSave();
    e.preventDefault();
  });

  // -------- data refresh
  async function refresh(): Promise<void> {
    try {
      S.tree = await api.listTree();
      S.all = await api.listSheets("", true);
      S.trash = await api.listTrash();
      S.sheets = await loadSheets();
    } catch (e) {
      // The group we were looking at may be gone; fall back to the root.
      S.view = { kind: "group", path: "" };
      try {
        S.tree = await api.listTree();
        S.all = await api.listSheets("", true);
        S.trash = await api.listTrash();
        S.sheets = await api.listSheets("", false);
      } catch (e2) {
        toast(msg(e2 ?? e));
      }
    }
    renderTree();
    renderSheets();
  }

  const RECENT_SECS = 7 * 86400;
  async function loadSheets(): Promise<SheetInfo[]> {
    const v = S.view;
    if (v.kind === "group") return arrange(S.meta, v.path, await api.listSheets(v.path, false));
    if (v.kind === "all") return S.all;
    if (v.kind === "conflicts") return S.all.filter((x) => x.conflict);
    if (v.kind === "recent") {
      const since = Date.now() / 1000 - RECENT_SECS;
      return S.all.filter((x) => x.modified >= since);
    }
    if (v.kind === "trash") return []; // the Trash has its own list
    // a saved filter: text, group and recency, all of which must match
    const f = S.meta.filters.find((x) => x.id === v.id);
    if (!f) return [];
    const since = f.days ? Date.now() / 1000 - f.days * 86400 : 0;
    let found = S.all.filter((x) => x.modified >= since && (!f.group || x.path.startsWith(f.group + "/")));
    if (f.query.trim()) {
      const hits = new Set((await api.search(f.query)).map((x) => x.path));
      found = found.filter((x) => hits.has(x.path));
    }
    return found;
  }

  const viewGroupPath = (): string => (S.view.kind === "group" ? S.view.path : "");

  // -------- library tree
  function renderTree(): void {
    treeEl.replaceChildren();
    if (!S.tree) return;
    const smartRow = (kind: "all" | "recent" | "conflicts" | "trash", ico: string, label: string, count = 0): HTMLElement =>
      h(
        "div",
        { class: "row" + (S.view.kind === kind ? " active" : "") + (kind === "conflicts" ? " warn" : ""), style: "padding-left:8px", "data-nav": kind, onclick: () => void selectView({ kind }) },
        h("span", { class: "chev" }),
        icon(ico),
        h("span", { class: "name" }, label),
        count ? h("span", { class: "count" }, String(count)) : null,
      );
    treeEl.append(h("div", { class: "tree-label" }, "Library"), smartRow("all", "all", "All"), smartRow("recent", "clock", "Last 7 Days"));
    // only shown when a sync service has left conflicted copies behind
    const conflicts = S.all.filter((x) => x.conflict).length;
    if (conflicts || S.view.kind === "conflicts") treeEl.append(smartRow("conflicts", "warn", "Conflicts", conflicts));
    treeEl.append(smartRow("trash", "trash", "Trash", S.trash.length));

    treeEl.append(
      h(
        "div",
        { class: "tree-label with-btn" },
        h("span", {}, "Filters"),
        h("button", { class: "icon-btn mini", title: "New filter", "aria-label": "New filter", onclick: () => void newFilter() }, icon("plus")),
      ),
    );
    if (!S.meta.filters.length) treeEl.append(h("div", { class: "tree-hint" }, "Smart folders: save a search to keep it here."));
    for (const f of S.meta.filters) {
      const row = h(
        "div",
        { class: "row" + (S.view.kind === "filter" && S.view.id === f.id ? " active" : ""), style: "padding-left:8px", "data-nav": "filter", onclick: () => void selectView({ kind: "filter", id: f.id }) },
        h("span", { class: "chev" }),
        icon("funnel"),
        h("span", { class: "name" }, f.name),
      );
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showMenu(e.clientX, e.clientY, [
          { label: "Edit filter…", run: () => void editFilter(f) },
          { label: "Delete filter", run: () => void deleteFilter(f), danger: true, sep: true },
        ]);
      });
      treeEl.append(row);
    }

    const rowFor = (g: Group, depth: number, label: string, ico: string, color = ""): HTMLElement => {
      const isRoot = g.path === "";
      const open = !S.collapsed.has(g.path);
      const active = S.view.kind === "group" && S.view.path === g.path;
      const chev = h("span", { class: "chev" + (open ? " open" : "") });
      if (!isRoot && g.children.length) {
        chev.append(icon("chev"));
        chev.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleCollapsed(g.path);
        });
      }
      const ic = icon(ico);
      if (color) ic.style.stroke = color;
      const row = h(
        "div",
        {
          class: "row" + (active ? " active" : ""),
          style: `padding-left:${8 + depth * 16}px`,
          "data-nav": "group",
          "data-gpath": g.path,
          "data-kids": g.children.length ? "1" : null,
          draggable: isRoot ? null : "true",
          onclick: () => void selectView({ kind: "group", path: g.path }),
        },
        chev,
        ic,
        h("span", { class: "name" }, label),
      );
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showMenu(e.clientX, e.clientY, groupMenu(g));
      });
      row.addEventListener("dragstart", (e) => {
        dragGroup = g.path;
        e.dataTransfer?.setData("text/x-scriptorium-group", g.path);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      });
      // dropping a group: near the top or bottom edge puts it before or after this one,
      // in the middle moves it inside. Dropping sheets always moves them inside.
      const zoneOf = (e: DragEvent): "before" | "after" | "into" => {
        if (isRoot) return "into";
        const r = row.getBoundingClientRect();
        const f = (e.clientY - r.top) / r.height;
        return f < 0.28 ? "before" : f > 0.72 ? "after" : "into";
      };
      const clearMarks = () => row.classList.remove("drop", "drop-above", "drop-below");
      row.addEventListener("dragover", (e) => {
        const types = e.dataTransfer?.types ?? [];
        if (types.includes("text/x-scriptorium-group")) {
          if (!dragGroup || dragGroup === g.path || g.path.startsWith(dragGroup + "/")) return;
          e.preventDefault();
          const z = zoneOf(e);
          clearMarks();
          row.classList.add(z === "before" ? "drop-above" : z === "after" ? "drop-below" : "drop");
        } else if (types.includes("text/x-scriptorium-paths") || types.includes("text/x-scriptorium")) {
          e.preventDefault();
          row.classList.add("drop");
        }
      });
      row.addEventListener("dragleave", clearMarks);
      row.addEventListener("dragend", () => {
        dragGroup = null;
        treeEl.querySelectorAll(".drop, .drop-above, .drop-below").forEach((n) => n.classList.remove("drop", "drop-above", "drop-below"));
      });
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        clearMarks();
        if (e.dataTransfer?.types.includes("text/x-scriptorium-group")) {
          if (dragGroup) void moveGroup(dragGroup, g, zoneOf(e));
          dragGroup = null;
          return;
        }
        const raw = e.dataTransfer?.getData("text/x-scriptorium-paths");
        const src = e.dataTransfer?.getData("text/x-scriptorium");
        const paths = raw ? (JSON.parse(raw) as string[]) : src ? [src] : [];
        if (paths.length) void moveTo(paths, g.path);
      });
      return row;
    };

    // Loose sheets in the library folder live in the Inbox, like Ulysses.
    treeEl.append(h("div", { class: "tree-label" }, "On this computer"), rowFor(S.tree, 0, "Inbox", "inbox"));
    const addGroup = (g: Group, depth: number): void => {
      const [ico, colour] = (S.meta.style[g.path] ?? "").split(":");
      treeEl.append(rowFor(g, depth, g.name, GROUP_ICONS.includes(ico) ? ico : "doc", GROUP_COLORS[colour] ?? ""));
      if (!S.collapsed.has(g.path)) for (const c of arrangeGroups(S.meta, g.path, g.children)) addGroup(c, depth + 1);
    };
    for (const c of arrangeGroups(S.meta, "", S.tree.children)) addGroup(c, 0);
  }

  let dragGroup: string | null = null;

  function toggleCollapsed(path: string): void {
    if (S.collapsed.has(path)) S.collapsed.delete(path);
    else S.collapsed.add(path);
    lsSet("collapsed", JSON.stringify([...S.collapsed]));
    renderTree();
  }

  const findGroup = (g: Group | null, path: string): Group | null => (!g ? null : g.path === path ? g : g.children.reduce<Group | null>((f, c) => f ?? findGroup(c, path), null));

  /** Move a group next to another (before / after) or inside it, keeping everything that refers to it in step. */
  async function moveGroup(src: string, target: Group, zone: "before" | "after" | "into"): Promise<void> {
    if (src === target.path || target.path.startsWith(src + "/")) return;
    const dest = zone === "into" ? target.path : parentOf(target.path);
    await flushSave();
    try {
      let np = src;
      if (parentOf(src) !== dest) {
        np = await api.moveItem(src, dest);
        applyRemap((p) => (p === src || p.startsWith(src + "/") ? np + p.slice(src.length) : p));
      }
      if (zone === "into") S.collapsed.delete(target.path);
      else {
        const sibs = arrangeGroups(S.meta, dest, findGroup(S.tree, dest)?.children ?? []).map((c) => (c.path === src ? np : c.path)).filter((p) => p !== np);
        const at = sibs.indexOf(target.path);
        sibs.splice(zone === "before" ? at : at + 1, 0, np);
        S.meta.groups[dest] = sibs;
        persistMeta();
      }
      await refresh();
    } catch (e) {
      toast(msg(e));
      await refresh();
    }
  }

  async function askGroupStyle(g: Group): Promise<void> {
    const [curIcon, curColor] = (S.meta.style[g.path] ?? "doc:").split(":");
    let pickIcon = GROUP_ICONS.includes(curIcon) ? curIcon : "doc";
    let pickColor = GROUP_COLORS[curColor] ? curColor : "";
    const r = await modal((close) => {
      const iconBtns = GROUP_ICONS.map((n) => h("button", { class: "pick", title: n, "data-icon": n }, icon(n)));
      const colorBtns = ["", ...Object.keys(GROUP_COLORS)].map((c) => h("button", { class: "pick swatch", title: c || "no colour", "data-color": c, style: c ? `background:${GROUP_COLORS[c]}` : null }));
      const paint = () => {
        iconBtns.forEach((b) => b.classList.toggle("on", b.dataset.icon === pickIcon));
        colorBtns.forEach((b) => b.classList.toggle("on", (b.dataset.color ?? "") === pickColor));
        iconBtns.forEach((b) => ((b.firstElementChild as SVGElement).style.stroke = pickColor ? GROUP_COLORS[pickColor] : ""));
      };
      iconBtns.forEach((b) => b.addEventListener("click", () => ((pickIcon = b.dataset.icon!), paint())));
      colorBtns.forEach((b) => b.addEventListener("click", () => ((pickColor = b.dataset.color ?? ""), paint())));
      paint();
      return h(
        "div",
        { class: "modal" },
        h("h3", {}, `Icon for “${g.name}”`),
        h("div", { class: "pick-grid" }, ...iconBtns),
        h("div", { class: "pick-grid" }, ...colorBtns),
        h("div", { class: "actions" }, h("button", { class: "btn", onclick: () => close(null) }, "Cancel"), h("button", { class: "btn primary", onclick: () => close(`${pickIcon}:${pickColor}`) }, "Done")),
      );
    });
    if (r === null) return;
    if (r === "doc:") delete S.meta.style[g.path];
    else S.meta.style[g.path] = r;
    persistMeta();
    renderTree();
  }

  function groupMenu(g: Group): MenuItem[] {
    const items: MenuItem[] = [
      { label: "New sheet here", run: () => void newSheetIn(g.path) },
      { label: "New group inside…", run: () => void newGroup(g.path) },
      { label: "Export group…", run: () => void exportGroup(g), sep: true },
    ];
    if (g.path !== "") {
      items.push(
        { label: "Rename…", run: () => void renameGroup(g), sep: true },
        { label: "Icon & colour…", run: () => void askGroupStyle(g) },
        { label: "Delete group", run: () => void deleteGroup(g), danger: true },
      );
    }
    return items;
  }

  async function selectView(v: View): Promise<void> {
    if (S.trashPreview && v.kind !== "trash") leaveTrashPreview();
    S.view = v;
    searchEl.value = "";
    S.hits = null;
    await refresh();
  }

  // -------- sheet list
  /** One row in the list: a single sheet, or a run of glued sheets shown as one. */
  interface Unit {
    key: string;
    paths: string[];
    sheets: SheetInfo[];
  }
  let units: Unit[] = [];
  let dragKeys: string[] = [];

  function unitsOf(sheets: SheetInfo[]): Unit[] {
    const byPath = new Map(sheets.map((x) => [x.path, x]));
    const used = new Set<string>();
    const out: Unit[] = [];
    sheets.forEach((x, i) => {
      if (used.has(x.path)) return;
      const g = glueOf(S.meta, x.path);
      // glued sheets collapse into one row only while they sit next to each other in this list
      if (g && g[0] === x.path && g.every((p, j) => sheets[i + j]?.path === p)) {
        g.forEach((p) => used.add(p));
        out.push({ key: x.path, paths: g, sheets: g.map((p) => byPath.get(p)!) });
      } else {
        used.add(x.path);
        out.push({ key: x.path, paths: [x.path], sheets: [x] });
      }
    });
    return out;
  }

  const plural = (n: number, one: string, many = one + "s"): string => `${n.toLocaleString()} ${n === 1 ? one : many}`;
  const inGroupView = (): boolean => S.view.kind === "group" && !S.hits;

  let scrollToSelected = false;
  function renderSheets(): void {
    drawSheets();
    if (scrollToSelected && sheetsEl.querySelector(".selected")) {
      scrollToSelected = false;
      sheetsEl.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
    }
  }

  function drawSheets(): void {
    sheetsEl.replaceChildren();
    listTitle.replaceChildren();
    if (S.hits) {
      listTitle.append(
        h("span", { class: "lt-name" }, plural(S.hits.length, "result")),
        h("button", { class: "lt-btn", onclick: () => void newFilter({ query: searchEl.value.trim() }) }, "Save as filter"),
      );
      if (!S.hits.length) sheetsEl.append(h("div", { class: "none" }, "Nothing found."));
      for (const hit of S.hits) sheetsEl.append(hitRow(hit));
      return;
    }
    const v = S.view;
    if (v.kind === "trash") {
      listTitle.append(h("span", { class: "lt-name" }, "Trash"));
      if (S.trash.length) listTitle.append(h("button", { class: "lt-btn danger", onclick: () => void emptyTrashAll() }, "Empty Trash"));
      if (!S.trash.length) sheetsEl.append(h("div", { class: "none" }, "The Trash is empty."));
      for (const t of S.trash) sheetsEl.append(trashRow(t));
      return;
    }
    const name =
      v.kind === "all" ? "All" : v.kind === "recent" ? "Last 7 Days" : v.kind === "conflicts" ? "Conflicts" : v.kind === "filter" ? (S.meta.filters.find((f) => f.id === v.id)?.name ?? "Filter") : v.path === "" ? "Inbox" : (v.path.split("/").pop() ?? "");
    const words = S.sheets.filter((x) => !isMaterial(x.path)).reduce((n, x) => n + x.words, 0);
    listTitle.append(
      h("span", { class: "lt-name" }, name),
      h("span", { class: "lt-count", title: "Material sheets are not counted" }, `${plural(S.sheets.length, "sheet")} · ${plural(words, "word")}`),
    );
    units = unitsOf(S.sheets);
    if (!units.length) {
      sheetsEl.append(h("div", { class: "none" }, v.kind === "recent" ? "Nothing written in the last 7 days." : v.kind === "conflicts" ? "No conflicts. Everything is in agreement." : v.kind === "filter" ? "No sheets match this filter." : "No sheets here yet."));
      return;
    }
    for (const u of units) sheetsEl.append(unitRow(u));
  }

  function groupOf(path: string): string {
    const i = path.lastIndexOf("/");
    return i < 0 ? "Inbox" : path.slice(0, i);
  }

  function unitRow(u: Unit): HTMLElement {
    const first = u.sheets[0];
    const mat = isMaterial(first.path);
    const glued = u.sheets.length > 1;
    const conflict = first.conflict && !glued;
    const words = u.sheets.reduce((n, x) => n + x.words, 0);
    const meta = [
      whenText(Math.max(...u.sheets.map((x) => x.modified))),
      glued ? `${u.sheets.length} glued sheets · ${plural(words, "word")}` : plural(words, "word"),
      conflict ? "Conflicted copy" : "",
      S.view.kind !== "group" ? groupOf(first.path) : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const badge = conflict ? icon("warn") : mat ? icon("torn") : glued ? icon("glue") : null;
    const row = h(
      "div",
      { class: "sheet-item" + (S.sel.has(u.key) ? " selected" : "") + (mat ? " material" : "") + (glued ? " glued" : "") + (conflict ? " conflict" : ""), draggable: "true", "data-key": u.key },
      h("div", { class: "si-head" }, h("div", { class: "si-title" }, first.title || "Untitled"), badge ? h("span", { class: "si-badge" }, badge) : null),
      h("div", { class: "si-prev" }, first.preview),
      h("div", { class: "si-meta" }, meta),
    );
    row.addEventListener("click", (e) => clickUnit(u, e));
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (!S.sel.has(u.key)) {
        S.sel = new Set([u.key]);
        S.anchor = u.key;
        renderSheets();
      }
      showMenu(e.clientX, e.clientY, unitMenu(u));
    });
    row.addEventListener("dragstart", (e) => {
      dragKeys = S.sel.has(u.key) ? units.filter((x) => S.sel.has(x.key)).map((x) => x.key) : [u.key];
      const paths = units.filter((x) => dragKeys.includes(x.key)).flatMap((x) => x.paths);
      if (!e.dataTransfer) return;
      e.dataTransfer.setData("text/x-scriptorium", paths[0]);
      e.dataTransfer.setData("text/x-scriptorium-paths", JSON.stringify(paths));
      if (inGroupView()) e.dataTransfer.setData("text/x-scriptorium-order", "1");
      e.dataTransfer.effectAllowed = "move";
    });
    const above = (e: DragEvent) => e.clientY - row.getBoundingClientRect().top < row.clientHeight / 2;
    const clear = () => row.classList.remove("drop-above", "drop-below");
    row.addEventListener("dragover", (e) => {
      if (!inGroupView() || !e.dataTransfer?.types.includes("text/x-scriptorium-order") || dragKeys.includes(u.key)) return;
      e.preventDefault();
      const up = above(e);
      row.classList.toggle("drop-above", up);
      row.classList.toggle("drop-below", !up);
    });
    row.addEventListener("dragleave", clear);
    row.addEventListener("dragend", () => {
      sheetsEl.querySelectorAll(".drop-above, .drop-below").forEach((n) => n.classList.remove("drop-above", "drop-below"));
    });
    row.addEventListener("drop", (e) => {
      if (!inGroupView() || !e.dataTransfer?.types.includes("text/x-scriptorium-order") || dragKeys.includes(u.key)) return;
      e.preventDefault();
      clear();
      void reorder(u.key, above(e));
    });
    return row;
  }

  function hitRow(hit: SearchHit): HTMLElement {
    const row = h(
      "div",
      { class: "sheet-item" + (isOpen(hit.path) ? " selected" : ""), "data-path": hit.path, onclick: () => void openSheet(hit.path) },
      h("div", { class: "si-head" }, h("div", { class: "si-title" }, hit.title || "Untitled")),
      h("div", { class: "si-prev" }, hit.snippet),
      h("div", { class: "si-meta" }, groupOf(hit.path)),
    );
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showMenu(e.clientX, e.clientY, [
        { label: "Open", run: () => void openSheet(hit.path) },
        { label: "Export…", run: () => void exportSheet(hit.path) },
        { label: "Delete sheet", run: () => void deleteSheets([hit.path]), danger: true, sep: true },
      ]);
    });
    return row;
  }

  function clickUnit(u: Unit, e: MouseEvent): void {
    if (e.metaKey || e.ctrlKey) {
      if (S.sel.has(u.key)) S.sel.delete(u.key);
      else S.sel.add(u.key);
      S.anchor = u.key;
      renderSheets();
      return;
    }
    if (e.shiftKey && S.anchor) {
      const a = units.findIndex((x) => x.key === S.anchor);
      const b = units.findIndex((x) => x.key === u.key);
      if (a >= 0 && b >= 0) {
        S.sel = new Set(units.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.key));
        renderSheets();
        return;
      }
    }
    void openSheet(u.paths[0]);
  }

  function canGlue(targets: Unit[]): boolean {
    if (!inGroupView() || targets.length < 2 || targets.some((t) => t.paths.some((p) => isMaterial(p)))) return false;
    const at = targets.map((t) => units.indexOf(t)).sort((a, b) => a - b);
    return at.every((n, i) => n === at[0] + i);
  }

  function unitMenu(u: Unit): MenuItem[] {
    const targets = S.sel.has(u.key) && S.sel.size > 1 ? units.filter((x) => S.sel.has(x.key)) : [u];
    const paths = targets.flatMap((t) => t.paths);
    const allMaterial = paths.every((p) => isMaterial(p));
    const items: MenuItem[] = [{ label: "Open", run: () => void openSheet(u.paths[0]) }];
    const copy = targets.length === 1 && u.sheets[0].conflict ? u.sheets[0] : null;
    if (copy?.original) {
      items.push(
        { label: "Open original", run: () => void openSheet(copy.original!) },
        { label: "Keep this version (replaces the original)", run: () => void settleConflict(copy.path, true) },
        { label: "Discard this copy", run: () => void settleConflict(copy.path, false) },
      );
    }
    if (canGlue(targets)) items.push({ label: `Glue ${paths.length} sheets`, run: () => void glueUnits(targets) });
    if (targets.length === 1 && u.paths.length > 1) items.push({ label: "Unglue sheets", run: () => void unglue(u) });
    if (targets.length === 1 && u.paths.length === 1) items.push({ label: "Rename file…", run: () => void renameSheet(u.paths[0]) });
    items.push({ label: allMaterial ? "Remove material mark" : "Mark as material", run: () => void setMaterial(paths, !allMaterial) });
    if (targets.length === 1) items.push({ label: "Export…", run: () => void exportSheet(u.paths[0]) });
    items.push(
      { label: "Move to Inbox", run: () => void moveTo(paths, "") },
      { label: paths.length > 1 ? `Delete ${paths.length} sheets` : "Delete sheet", run: () => void deleteSheets(paths), danger: true, sep: true },
    );
    return items;
  }

  // -------- material, glue, order
  async function setMaterial(paths: string[], on: boolean): Promise<void> {
    if (on && paths.some((p) => glueOf(S.meta, p))) {
      toast("Unglue these sheets before marking them as material");
      return;
    }
    const set = new Set(S.meta.material);
    for (const p of paths) {
      if (on) set.add(p);
      else set.delete(p);
    }
    S.meta.material = [...set];
    persistMeta();
    applyMaterialClass();
    renderSheets();
  }

  async function reopen(path: string): Promise<void> {
    S.current = null;
    S.glue = null;
    await openSheet(path);
  }

  async function glueUnits(targets: Unit[]): Promise<void> {
    await flushSave();
    const paths = targets.flatMap((t) => t.paths);
    S.meta.glue = S.meta.glue.filter((g) => !g.some((p) => paths.includes(p)));
    S.meta.glue.push(paths);
    S.meta.order[viewGroupPath()] = units.flatMap((x) => x.paths);
    persistMeta();
    await reopen(paths[0]);
    await refresh();
  }

  async function unglue(u: Unit): Promise<void> {
    await flushSave();
    S.meta.glue = S.meta.glue.filter((g) => g[0] !== u.paths[0]);
    persistMeta();
    if (u.paths.some((p) => isOpen(p))) await reopen(S.current ?? u.paths[0]);
    await refresh();
  }

  async function reorder(targetKey: string, before: boolean): Promise<void> {
    const moving = units.filter((x) => dragKeys.includes(x.key));
    const rest = units.filter((x) => !dragKeys.includes(x.key));
    const i = rest.findIndex((x) => x.key === targetKey);
    if (i < 0 || !moving.length) return;
    rest.splice(before ? i : i + 1, 0, ...moving);
    S.meta.order[viewGroupPath()] = rest.flatMap((x) => x.paths);
    persistMeta();
    await refresh();
  }

  // -------- opening / closing sheets
  async function openSheet(path: string, focus = true): Promise<void> {
    const g = glueOf(S.meta, path);
    const key = g?.[0] ?? path;
    if (isOpen(path)) {
      S.sel = new Set([key]);
      S.anchor = S.cursor = key;
      renderSheets();
      if (focus) view.focus();
      return;
    }
    await flushSave();
    if (S.trashPreview) clearTrashPreview();
    const paths = g ?? [path];
    try {
      const texts = await Promise.all(paths.map((p) => api.readSheet(p)));
      S.current = paths[0];
      S.glue = g;
      S.savedParts = texts;
      setDoc(texts.join(GLUE_JOIN), !!g);
      S.version = S.savedVersion = 0;
      S.sel = new Set([key]);
      S.anchor = S.cursor = key;
      setHasNone(false);
      setSave("");
      refreshCrumb();
      applyMaterialClass();
      renderSheets();
      if (focus) view.focus();
    } catch (e) {
      toast(`Couldn't open that sheet: ${msg(e)}`);
      await refresh();
    }
  }

  function closeEditor(): void {
    S.current = null;
    S.glue = null;
    S.savedParts = [];
    setDoc("");
    S.version = S.savedVersion = 0;
    setHasNone(true);
    refreshCrumb();
    applyMaterialClass();
  }

  // -------- actions
  async function newSheetIn(group: string): Promise<void> {
    await flushSave();
    try {
      searchEl.value = "";
      S.hits = null;
      const p = await api.createSheet(group);
      // a new sheet goes after the sheet you are on (or the end of the group), keeping the rest as is
      const others = arrange(S.meta, group, await api.listSheets(group, false)).map((x) => x.path).filter((x) => x !== p);
      const here = S.current ? (S.glue ?? [S.current]).at(-1)! : null;
      const at = here ? others.indexOf(here) : -1;
      S.meta.order[group] = at >= 0 ? [...others.slice(0, at + 1), p, ...others.slice(at + 1)] : [...others, p];
      persistMeta();
      if (S.view.kind !== "group" || S.view.path !== group) S.view = { kind: "group", path: group };
      await refresh();
      await openSheet(p);
    } catch (e) {
      toast(msg(e));
    }
  }
  const newSheet = () => newSheetIn(viewGroupPath());

  async function newGroup(parent = viewGroupPath()): Promise<void> {
    const name = await askText("New group", "", "Create");
    if (!name) return;
    try {
      const p = await api.createGroup(parent, name);
      S.collapsed.delete(parent);
      lsSet("collapsed", JSON.stringify([...S.collapsed]));
      await selectView({ kind: "group", path: p });
    } catch (e) {
      toast(msg(e));
    }
  }

  async function renameGroup(g: Group): Promise<void> {
    const name = await askText("Rename group", g.name, "Rename");
    if (!name || name === g.name) return;
    await flushSave();
    try {
      const np = await api.renameItem(g.path, name);
      applyRemap((p) => (p === g.path || p.startsWith(g.path + "/") ? np + p.slice(g.path.length) : p));
      await refresh();
    } catch (e) {
      toast(msg(e));
    }
  }

  async function renameSheet(path: string): Promise<void> {
    const stem = (path.split("/").pop() ?? "").replace(/\.md$/i, "");
    const name = await askText("Rename file", stem, "Rename");
    if (!name || name === stem) return;
    await flushSave();
    try {
      const np = await api.renameItem(path, name);
      applyRemap((p) => (p === path ? np : p));
      await refresh();
    } catch (e) {
      toast(msg(e));
    }
  }

  /** Forget deleted paths: structure, selection, the open sheet and the current view. */
  function afterDelete(gone: (p: string) => boolean): void {
    dropFromMeta(S.meta, gone);
    persistMeta();
    S.sel = new Set([...S.sel].filter((k) => !gone(k)));
    if (S.view.kind === "group" && gone(S.view.path)) S.view = { kind: "group", path: "" };
    if (S.current && (gone(S.current) || S.glue?.some(gone))) closeEditor();
  }

  async function deleteGroup(g: Group): Promise<void> {
    const ok = await askConfirm(`Delete “${g.name}”?`, "The group and everything in it moves to the Trash, so you can restore it later.", "Delete");
    if (!ok) return;
    await flushSave();
    try {
      await api.deleteItem(g.path);
      afterDelete((p) => p === g.path || p.startsWith(g.path + "/"));
      await refresh();
      toast("Moved to the Trash");
    } catch (e) {
      toast(msg(e));
    }
  }

  async function deleteSheets(paths: string[]): Promise<void> {
    await flushSave();
    try {
      for (const p of paths) await api.deleteItem(p);
    } catch (e) {
      toast(msg(e));
    }
    afterDelete((p) => paths.includes(p));
    if (S.hits) S.hits = S.hits.filter((x) => !paths.includes(x.path));
    await refresh();
    toast("Moved to the Trash");
  }

  async function moveTo(paths: string[], group: string): Promise<void> {
    await flushSave();
    const moved = new Map<string, string>();
    try {
      for (const p of paths) moved.set(p, await api.moveItem(p, group));
    } catch (e) {
      toast(msg(e));
    }
    if (moved.size) applyRemap((p) => moved.get(p) ?? p);
    await refresh();
  }

  // -------- trash
  const whereText = (path: string): string => (path ? groupOf(path) : "somewhere");

  function trashRow(t: TrashItem): HTMLElement {
    const row = h(
      "div",
      { class: "sheet-item trash" + (S.trashPreview === t.id ? " selected" : ""), "data-id": t.id },
      h("div", { class: "si-head" }, h("div", { class: "si-title" }, t.title || "Untitled"), t.isGroup ? h("span", { class: "si-badge" }, icon("folder")) : null),
      h("div", { class: "si-prev" }, t.preview),
      h("div", { class: "si-meta" }, [`Deleted ${whenText(t.deleted)}`, plural(t.words, "word"), t.original ? `from ${whereText(t.original)}` : ""].filter(Boolean).join(" · ")),
    );
    row.addEventListener("click", () => void previewTrash(t));
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showMenu(e.clientX, e.clientY, [
        { label: "Restore", run: () => void restoreTrashItem(t) },
        { label: "Delete permanently…", run: () => void purgeTrashItem(t), danger: true, sep: true },
      ]);
    });
    return row;
  }

  function clearTrashPreview(): void {
    S.trashPreview = null;
    document.body.classList.remove("previewing-trash");
  }
  function leaveTrashPreview(): void {
    clearTrashPreview();
    closeEditor();
  }

  /** Show a trashed sheet read-only, with a bar to restore it. */
  async function previewTrash(t: TrashItem): Promise<void> {
    await flushSave();
    try {
      const text = t.isGroup ? `This group and its ${plural(t.sheets, "sheet")} are in the Trash.\n\nRestore it to read and edit them again.` : await api.readTrash(t.id);
      S.current = null;
      S.glue = null;
      S.savedParts = [];
      S.version = S.savedVersion = 0;
      S.trashPreview = t.id;
      document.body.classList.add("previewing-trash");
      el("trashBarText").textContent = t.isGroup ? `The group “${t.name}” is in the Trash.` : `“${t.title}” is in the Trash. It is read-only here.`;
      setDoc(text, false, true);
      setHasNone(false);
      document.body.classList.remove("is-material");
      crumb.textContent = `Trash  ›  ${t.title}`;
      updateStats();
      renderSheets();
    } catch (e) {
      toast(msg(e));
      await refresh();
    }
  }

  async function restoreTrashItem(t: TrashItem): Promise<void> {
    try {
      const np = await api.restoreTrash(t.id);
      if (S.trashPreview === t.id) leaveTrashPreview();
      searchEl.value = "";
      S.hits = null;
      S.view = { kind: "group", path: t.isGroup ? np : parentOf(np) };
      await refresh();
      if (!t.isGroup) await openSheet(np);
      toast(`Restored “${t.title}”`);
    } catch (e) {
      toast(msg(e));
      await refresh();
    }
  }

  async function purgeTrashItem(t: TrashItem): Promise<void> {
    const ok = await askConfirm(`Delete “${t.title}” permanently?`, "It will be gone for good. This can't be undone.", "Delete permanently");
    if (!ok) return;
    try {
      await api.purgeTrash(t.id);
      if (S.trashPreview === t.id) leaveTrashPreview();
      await refresh();
      toast("Deleted permanently");
    } catch (e) {
      toast(msg(e));
    }
  }

  async function emptyTrashAll(): Promise<void> {
    const n = S.trash.length;
    if (!n) return;
    const ok = await askConfirm("Empty the Trash?", `${plural(n, "item")} will be deleted for good. This can't be undone.`, "Empty Trash");
    if (!ok) return;
    try {
      await api.emptyTrash();
      if (S.trashPreview) leaveTrashPreview();
      await refresh();
      toast("Trash emptied");
    } catch (e) {
      toast(msg(e));
    }
  }

  el("btnTrashRestore").addEventListener("click", () => {
    const t = S.trash.find((x) => x.id === S.trashPreview);
    if (t) void restoreTrashItem(t);
  });
  el("btnTrashPurge").addEventListener("click", () => {
    const t = S.trash.find((x) => x.id === S.trashPreview);
    if (t) void purgeTrashItem(t);
  });

  async function settleConflict(path: string, keepCopy: boolean): Promise<void> {
    await flushSave();
    try {
      const survivor = await api.resolveConflict(path, keepCopy);
      afterDelete((p) => p === path);
      if (S.current && isOpen(survivor)) await reopen(survivor);
      await refresh();
      toast(keepCopy ? "Kept this version. The old one is in the Trash" : "Copy moved to the Trash");
    } catch (e) {
      toast(msg(e));
    }
  }

  // -------- export
  const titleOf = (path: string): string => S.sheets.find((x) => x.path === path)?.title ?? (path.split("/").pop() ?? "Sheet").replace(/\.md$/i, "");

  async function exportSheet(path = S.current ?? ""): Promise<void> {
    if (!path) return;
    await flushSave();
    try {
      const glued = glueOf(S.meta, path);
      const out = glued
        ? await api.exportText((await Promise.all(glued.map((p) => api.readSheet(p)))).join("\n\n"), titleOf(glued[0]))
        : await api.exportSheet(path, titleOf(path));
      if (out) toast(`Exported to ${out}`);
    } catch (e) {
      toast(msg(e));
    }
  }

  /** A whole group as one document, in the order you arranged it. Material sheets are left out. */
  async function exportGroup(g: Group): Promise<void> {
    await flushSave();
    try {
      const parts: string[] = [];
      const walk = async (node: Group): Promise<void> => {
        for (const x of arrange(S.meta, node.path, await api.listSheets(node.path, false))) {
          if (!isMaterial(x.path)) parts.push(await api.readSheet(x.path));
        }
        for (const c of node.children) await walk(c);
      };
      await walk(g);
      if (!parts.length) {
        toast("Nothing to export: this group has no sheets that aren't material");
        return;
      }
      const out = await api.exportText(parts.join("\n\n"), g.path === "" ? "Library" : g.name);
      if (out) toast(`Exported to ${out}`);
    } catch (e) {
      toast(msg(e));
    }
  }

  // -------- filters
  async function askFilter(init: Partial<Filter>, title: string, okLabel: string): Promise<Omit<Filter, "id"> | null> {
    const groups: string[] = [];
    const walk = (g: Group): void => {
      if (g.path) groups.push(g.path);
      g.children.forEach(walk);
    };
    if (S.tree) walk(S.tree);
    const r = await modal((close) => {
      const name = h("input", { type: "text", value: init.name ?? "", placeholder: "Name", spellcheck: "false" });
      const query = h("input", { type: "text", value: init.query ?? "", placeholder: "Sheet contains… (for example: draft)", spellcheck: "false" });
      const grp = h("select", {}, h("option", { value: "" }, "Anywhere in the library"), ...groups.map((g) => h("option", { value: g }, g)));
      grp.value = init.group ?? "";
      const days = h(
        "select",
        {},
        ...(
          [
            [0, "Changed any time"],
            [1, "Changed in the last day"],
            [7, "Changed in the last 7 days"],
            [30, "Changed in the last 30 days"],
          ] as const
        ).map(([v, l]) => h("option", { value: String(v) }, l)),
      );
      days.value = String(init.days ?? 0);
      const ok = () => {
        const q = query.value.trim();
        if (!q && !grp.value && !Number(days.value)) {
          query.focus();
          return;
        }
        close(JSON.stringify({ name: name.value.trim() || q || grp.value || "Filter", query: q, group: grp.value, days: Number(days.value) }));
      };
      for (const i of [name, query]) i.addEventListener("keydown", (e) => e.key === "Enter" && ok());
      queueMicrotask(() => (init.name || !init.query ? name : query).focus());
      return h(
        "div",
        { class: "modal" },
        h("h3", {}, title),
        name,
        query,
        grp,
        days,
        h("div", { class: "actions" }, h("button", { class: "btn", onclick: () => close(null) }, "Cancel"), h("button", { class: "btn primary", onclick: ok }, okLabel)),
      );
    });
    return r ? (JSON.parse(r) as Omit<Filter, "id">) : null;
  }

  async function newFilter(init: Partial<Filter> = {}): Promise<void> {
    const f = await askFilter(init, "New filter", "Create");
    if (!f) return;
    const filter: Filter = { ...f, id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` };
    S.meta.filters.push(filter);
    persistMeta();
    await selectView({ kind: "filter", id: filter.id });
  }

  async function editFilter(f: Filter): Promise<void> {
    const next = await askFilter(f, "Edit filter", "Save");
    if (!next) return;
    Object.assign(f, next);
    persistMeta();
    await refresh();
  }

  async function deleteFilter(f: Filter): Promise<void> {
    S.meta.filters = S.meta.filters.filter((x) => x.id !== f.id);
    persistMeta();
    if (S.view.kind === "filter" && S.view.id === f.id) S.view = { kind: "group", path: "" };
    await refresh();
  }

  // -------- outside changes (sync services, other editors, other devices)
  let lastStamp = "";
  let checking = false;

  async function checkOutside(): Promise<void> {
    if (checking || saving || document.hidden) return;
    checking = true;
    try {
      const stamp = await api.stamp();
      if (stamp === lastStamp) return;
      lastStamp = stamp;
      // structure saved by another device
      const disk = parseMeta(await api.readMeta());
      if (json(disk) !== json(metaBase)) {
        S.meta = mergeMeta(metaBase, S.meta, disk);
        metaBase = disk;
        if (json(S.meta) !== json(disk)) persistMeta();
      }
      // the sheet being written: take the new text unless there are unsaved edits here
      // (those are protected when saving, see doSave)
      if (S.current && !isDirty()) {
        try {
          const texts = await Promise.all((S.glue ?? [S.current]).map((p) => api.readSheet(p)));
          if (!isDirty() && !saving && texts.some((t, i) => t !== S.savedParts[i])) loadOpen(texts);
        } catch {
          toast("The open sheet was moved or deleted outside Scriptorium");
          closeEditor();
        }
      }
      await refresh();
    } catch {
      /* a drive that is briefly unavailable: try again on the next tick */
    } finally {
      checking = false;
    }
  }
  window.setInterval(() => void checkOutside(), 2500);
  window.addEventListener("focus", () => void checkOutside());

  // -------- library folder
  async function initLibraryButton(): Promise<void> {
    const root = await api.libraryRoot().catch(() => "");
    const locked = await api.libraryLocked().catch(() => false);
    const btn = el("btnLibrary");
    btn.title = root;
    btn.append(icon("folder"), h("span", { class: "lib-name" }, root.split(/[\\/]/).filter(Boolean).pop() ?? root));
    btn.addEventListener("click", () => {
      const r = btn.getBoundingClientRect();
      const items: MenuItem[] = api.desktop ? [{ label: root, run: () => {} }] : [{ label: "Browser preview: sheets live in this browser only", run: () => {} }];
      if (!api.desktop) {
        /* nothing to choose in the browser */
      } else if (locked) items.push({ label: "The folder is fixed by SCRIPTORIUM_LIBRARY", run: () => {} });
      else {
        items.push({
          label: "Choose library folder…",
          sep: true,
          run: async () => {
            await flushSave();
            try {
              if (await api.chooseLibrary()) location.reload();
            } catch (e) {
              toast(msg(e));
            }
          },
        });
      }
      showMenu(r.left + 8, r.top - 44 - items.length * 30, items);
    });
  }

  // -------- keyboard: sidebar, list, quick open
  async function goToSheet(path: string): Promise<void> {
    searchEl.value = "";
    S.hits = null;
    for (let d = parentOf(path); d; d = parentOf(d)) S.collapsed.delete(d);
    if (S.view.kind !== "group" || S.view.path !== parentOf(path)) S.view = { kind: "group", path: parentOf(path) };
    await refresh();
    await openSheet(path);
  }

  /** Ctrl/Cmd+O: type part of a title or folder name, arrows to pick, Enter to open. */
  async function quickOpen(): Promise<void> {
    if (document.querySelector(".modal-ov")) return;
    const pick = await modal((close) => {
      const input = h("input", { type: "text", placeholder: "Open a sheet…", spellcheck: "false", "aria-label": "Open a sheet" });
      const list = h("div", { class: "qo-list", role: "listbox" });
      let shown: SheetInfo[] = [];
      let at = 0;
      const subsequence = (q: string, text: string): boolean => {
        let i = 0;
        for (const ch of text) if (ch === q[i] && ++i === q.length) return true;
        return q.length === 0;
      };
      const search = (): SheetInfo[] => {
        const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
        if (!words.length) return [...S.all].sort((a, b) => b.modified - a.modified).slice(0, 8);
        const score = (x: SheetInfo): number => {
          const title = x.title.toLowerCase();
          const hay = `${title} ${x.path.toLowerCase()}`;
          if (!words.every((w) => hay.includes(w))) return words.length === 1 && subsequence(words[0], title) ? 1 : 0;
          return 10 + (title.startsWith(words[0]) ? 5 : 0) + (title.includes(words[0]) ? 3 : 0);
        };
        return S.all
          .map((x) => [x, score(x)] as const)
          .filter(([, n]) => n > 0)
          .sort((a, b) => b[1] - a[1] || b[0].modified - a[0].modified)
          .slice(0, 8)
          .map(([x]) => x);
      };
      const draw = () => {
        shown = search();
        at = Math.min(at, Math.max(0, shown.length - 1));
        list.replaceChildren(
          ...(shown.length
            ? shown.map((x, i) =>
                h(
                  "div",
                  { class: "qo-item" + (i === at ? " on" : ""), role: "option", onmousedown: (e: Event) => (e.preventDefault(), close(x.path)) },
                  h("span", { class: "qo-title" }, x.title || "Untitled"),
                  h("span", { class: "qo-where" }, groupOf(x.path)),
                ),
              )
            : [h("div", { class: "none" }, "No sheet found. Ctrl/Cmd+K searches inside sheets.")]),
        );
      };
      input.addEventListener("input", () => ((at = 0), draw()));
      input.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          at = Math.max(0, Math.min(shown.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)));
          draw();
        } else if (e.key === "Enter" && shown[at]) {
          e.preventDefault();
          close(shown[at].path);
        }
      });
      draw();
      queueMicrotask(() => input.focus());
      return h("div", { class: "modal qo" }, input, list);
    });
    if (pick) await goToSheet(pick);
  }

  // Sidebar: arrows move through the rows (opening each), Left/Right fold groups, Enter jumps to the list.
  treeEl.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const rows = [...treeEl.querySelectorAll<HTMLElement>(".row")];
    const i = rows.findIndex((r) => r.classList.contains("active"));
    const go = (n: number): void => {
      e.preventDefault();
      const r = rows[Math.max(0, Math.min(rows.length - 1, n))];
      r?.click();
      requestAnimationFrame(() => treeEl.querySelector(".row.active")?.scrollIntoView({ block: "nearest" }));
    };
    const cur = rows[i];
    const path = cur?.dataset.gpath;
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(rows.length - 1);
    else if (e.key === "ArrowRight" && path && cur.dataset.kids && S.collapsed.has(path)) {
      e.preventDefault();
      toggleCollapsed(path);
    } else if (e.key === "ArrowLeft" && path) {
      e.preventDefault();
      if (cur.dataset.kids && !S.collapsed.has(path)) toggleCollapsed(path);
      else if (path) void selectView({ kind: "group", path: parentOf(path) });
    } else if (e.key === "Enter") {
      e.preventDefault();
      sheetsEl.focus();
    }
  });

  // List: arrows open the next or previous sheet, Shift+arrows select a run (to glue or move),
  // Enter goes to the text, Delete moves the selection to the Trash.
  sheetsEl.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const rows = [...sheetsEl.querySelectorAll<HTMLElement>(".sheet-item")];
    if (!rows.length) return;
    const keyOfRow = (r: HTMLElement): string => r.dataset.key ?? r.dataset.path ?? r.dataset.id ?? "";
    const found = rows.findIndex((r) => keyOfRow(r) === S.cursor);
    const i = found >= 0 ? found : Math.max(0, rows.findIndex((r) => r.classList.contains("selected")));
    const move = (n: number): void => {
      e.preventDefault();
      const r = rows[Math.max(0, Math.min(rows.length - 1, n))];
      scrollToSelected = true;
      const key = r.dataset.key;
      if (key !== undefined && e.shiftKey && S.anchor) {
        const a = units.findIndex((x) => x.key === S.anchor);
        const b = units.findIndex((x) => x.key === key);
        if (a >= 0 && b >= 0) {
          S.sel = new Set(units.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.key));
          S.cursor = key;
          renderSheets();
          return;
        }
      }
      S.cursor = keyOfRow(r);
      if (key !== undefined) {
        const u = units.find((x) => x.key === key);
        if (u) void openSheet(u.paths[0], false);
      } else if (r.dataset.path) void openSheet(r.dataset.path, false);
      else if (r.dataset.id) {
        const t = S.trash.find((x) => x.id === r.dataset.id);
        if (t) void previewTrash(t);
      }
    };
    if (e.key === "ArrowDown") move(i + 1);
    else if (e.key === "ArrowUp") move(i - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(rows.length - 1);
    else if (e.key === "Enter") {
      e.preventDefault();
      if (S.current) view.focus();
    } else if ((e.key === "Delete" || e.key === "Backspace") && units.length && inGroupViewOrList()) {
      e.preventDefault();
      const paths = units.filter((x) => S.sel.has(x.key)).flatMap((x) => x.paths);
      if (paths.length) void deleteSheets(paths);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      treeEl.focus();
    }
  });
  const inGroupViewOrList = (): boolean => !S.hits && S.view.kind !== "trash";

  // Escape leaves the text and returns to the list.
  view.dom.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && (e.target as HTMLElement).classList.contains("cm-content") && !document.querySelector(".cm-panel")) {
      e.preventDefault();
      sheetsEl.focus();
    }
  });

  // -------- search
  let searchTimer = 0;
  searchEl.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = window.setTimeout(async () => {
      const q = searchEl.value.trim();
      if (!q) {
        S.hits = null;
        renderSheets();
        return;
      }
      await flushSave();
      try {
        S.hits = await api.search(q);
      } catch (e) {
        toast(msg(e));
        S.hits = [];
      }
      renderSheets();
    }, 180);
  });
  searchEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      searchEl.value = "";
      S.hits = null;
      renderSheets();
      searchEl.blur();
    }
  });

  // -------- buttons + shortcuts
  el("btnNewSheet").addEventListener("click", () => void newSheet());
  el("btnEmptyNew").addEventListener("click", () => void newSheet());
  el("btnNewGroup").addEventListener("click", () => void newGroup());
  el("btnSidebar").addEventListener("click", toggleSidebar);
  el("btnSidebar2").addEventListener("click", toggleSidebar);
  el("btnTypewriter").addEventListener("click", toggleTypewriter);
  el("btnTheme").addEventListener("click", cycleTheme);
  el("btnExport").addEventListener("click", () => void exportSheet());
  el("btnFocus").addEventListener("click", toggleFocus);

  window.addEventListener("keydown", (e) => {
    if (e.key === "F2" && S.current && !S.glue && !document.querySelector(".modal-ov")) {
      e.preventDefault();
      void renameSheet(S.current);
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey) return;
    const k = e.code;
    const run = (fn: () => void) => {
      e.preventDefault();
      fn();
    };
    if (k === "KeyN" && !e.shiftKey) run(() => void newSheet());
    else if (k === "KeyN" && e.shiftKey) run(() => void newGroup());
    else if (k === "KeyK" && !e.shiftKey) run(() => {
      if (document.body.classList.contains("focus")) toggleFocus();
      searchEl.focus();
      searchEl.select();
    });
    else if (k === "Backslash" && !e.shiftKey) run(toggleSidebar);
    else if (k === "KeyO" && !e.shiftKey) run(() => void quickOpen());
    else if (k === "KeyT" && e.shiftKey) run(toggleTypewriter);
    else if (k === "KeyD" && e.shiftKey) run(cycleTheme);
    else if (k === "KeyF" && e.shiftKey) run(toggleFocus);
    else if (k === "KeyE" && e.shiftKey) run(() => void exportSheet());
  });

  // context menus should not open the browser menu anywhere else in the app
  window.addEventListener("contextmenu", (e) => {
    if (!(e.target as HTMLElement).closest(".cm-editor, input")) e.preventDefault();
  });

  // -------- resizable panes
  function initSplit(id: string, varName: string, min: number, max: number): void {
    const bar = el(id);
    const saved = Number(ls(varName));
    if (saved >= min && saved <= max) document.documentElement.style.setProperty(varName, `${saved}px`);
    bar.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const start = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(varName));
      bar.classList.add("dragging");
      const move = (ev: MouseEvent) => {
        const w = Math.min(max, Math.max(min, start + ev.clientX - startX));
        document.documentElement.style.setProperty(varName, `${w}px`);
        lsSet(varName, String(Math.round(w)));
      };
      const up = () => {
        bar.classList.remove("dragging");
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    });
  }
  initSplit("split1", "--w-lib", 160, 420);
  initSplit("split2", "--w-list", 220, 560);

  // -------- start
  setHasNone(true);
  updateStats();
  const metaText = await api.readMeta().catch(() => "");
  S.meta = parseMeta(metaText);
  metaBase = parseMeta(metaText);
  await recoverDraft();
  void initLibraryButton();
  lastStamp = await api.stamp().catch(() => "");
  await refresh();
  // Open the most recent sheet so the app starts in your writing, not an empty room.
  if (S.sheets[0]) await openSheet(S.sheets[0].path);
}

main().catch((e) => {
  document.body.textContent = `Scriptorium couldn't start: ${msg(e)}`;
});
