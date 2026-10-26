import "./styles.css";
import { loadApi, type Api, type Group, type SearchHit, type SheetInfo } from "./api";
import { createEditor, makeState } from "./editor";
import { arrange, dropFromMeta, emptyMeta, glueOf, GLUE_JOIN, parseMeta, remapMeta, type Filter, type Meta } from "./meta";

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
  funnel: '<path d="M4 5h16l-6 7.5V19l-4-2v-4.5z"/>',
  torn: '<path d="M6 4h12v13l-2 2.2-2-2.2-2 2.2-2-2.2-2 2.2-2-2.2z"/><path d="M9 9h6M9 12.5h4"/>',
  glue: '<path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1"/><path d="M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1"/>',
  all: '<path d="M7 4h10a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M9 4v16"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  doc: '<path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10.5a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5z"/><path d="M9 12h6M9 15.5h6M9 8.5h3"/>',
  inbox: '<path d="M4 13l2.5-7h11L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M4 13h4.5l1 2h5l1-2H20"/>',
};
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

  type View = { kind: "all" } | { kind: "recent" } | { kind: "filter"; id: string } | { kind: "group"; path: string };
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
    /** keys (first path) of the selected list rows */
    sel: new Set<string>(),
    anchor: null as string | null,
    version: 0,
    savedVersion: 0,
    typewriter: ls("typewriter") === "1",
    theme: ls("theme") ?? "auto",
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
  const setDoc = (text: string, glued = false) => view.setState(makeState(text, hooks, glued));
  setDoc("");

  // -------- icons on static buttons
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
  function toggleFocus(): void {
    const on = document.body.classList.toggle("focus");
    el("btnFocus").classList.toggle("on", on);
    if (current()) view.focus();
  }
  applyTheme();
  applyTypewriter();

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
  let metaChain: Promise<void> = Promise.resolve();
  function persistMeta(): void {
    const json = JSON.stringify(S.meta);
    metaChain = metaChain.then(() => api.writeMeta(json)).catch((e) => toast(`Couldn't save structure: ${msg(e)}`));
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

  async function doSave(): Promise<void> {
    if (!S.current || S.version === S.savedVersion) return;
    const v = S.version;
    const text = view.state.doc.toString();
    const paths = S.glue ?? [S.current];
    const parts = S.glue ? text.split(GLUE_JOIN) : [text];
    if (parts.length !== paths.length) throw new Error("a divider between glued sheets was damaged");
    const renamed = new Map<string, string>();
    for (let i = 0; i < paths.length; i++) {
      if (parts[i] === S.savedParts[i]) continue;
      const np = await api.writeSheet(paths[i], parts[i]);
      S.savedParts[i] = parts[i];
      if (np !== paths[i]) renamed.set(paths[i], np);
    }
    S.savedVersion = v;
    // an Untitled sheet is renamed after its first line when it gets one
    if (renamed.size && S.current === paths[0]) applyRemap((p) => renamed.get(p) ?? p);
    setSave(S.version === v ? "Saved" : "Editing…");
    scheduleListRefresh();
  }

  function flushSave(): Promise<void> {
    clearTimeout(saveTimer);
    chain = chain.then(doSave).catch((e) => {
      setSave("Not saved");
      toast(`Couldn't save: ${msg(e)}`);
    });
    return chain;
  }

  function scheduleListRefresh(): void {
    clearTimeout(listTimer);
    listTimer = window.setTimeout(() => void refresh(), 350);
  }

  window.addEventListener("blur", () => void flushSave());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) void flushSave();
  });
  window.addEventListener("beforeunload", () => void flushSave());

  // -------- data refresh
  async function refresh(): Promise<void> {
    try {
      S.tree = await api.listTree();
      S.sheets = await loadSheets();
    } catch (e) {
      // The group we were looking at may be gone; fall back to the root.
      S.view = { kind: "group", path: "" };
      try {
        S.tree = await api.listTree();
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
    if (v.kind === "all") return api.listSheets("", true);
    if (v.kind === "recent") {
      const since = Date.now() / 1000 - RECENT_SECS;
      return (await api.listSheets("", true)).filter((x) => x.modified >= since);
    }
    // a saved filter: text, group and recency, all of which must match
    const f = S.meta.filters.find((x) => x.id === v.id);
    if (!f) return [];
    const since = f.days ? Date.now() / 1000 - f.days * 86400 : 0;
    let found = (await api.listSheets(f.group, true)).filter((x) => x.modified >= since);
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
    const smartRow = (kind: "all" | "recent", ico: string, label: string): HTMLElement =>
      h(
        "div",
        { class: "row" + (S.view.kind === kind ? " active" : ""), style: "padding-left:8px", onclick: () => void selectView({ kind }) },
        h("span", { class: "chev" }),
        icon(ico),
        h("span", { class: "name" }, label),
      );
    treeEl.append(h("div", { class: "tree-label" }, "Library"), smartRow("all", "all", "All"), smartRow("recent", "clock", "Last 7 Days"));

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
        { class: "row" + (S.view.kind === "filter" && S.view.id === f.id ? " active" : ""), style: "padding-left:8px", onclick: () => void selectView({ kind: "filter", id: f.id }) },
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

    const rowFor = (g: Group, depth: number, label: string, ico: string): HTMLElement => {
      const isRoot = g.path === "";
      const open = !S.collapsed.has(g.path);
      const active = S.view.kind === "group" && S.view.path === g.path;
      const chev = h("span", { class: "chev" + (open ? " open" : "") });
      if (!isRoot && g.children.length) {
        chev.append(icon("chev"));
        chev.addEventListener("click", (e) => {
          e.stopPropagation();
          if (S.collapsed.has(g.path)) S.collapsed.delete(g.path);
          else S.collapsed.add(g.path);
          lsSet("collapsed", JSON.stringify([...S.collapsed]));
          renderTree();
        });
      }
      const row = h(
        "div",
        { class: "row" + (active ? " active" : ""), style: `padding-left:${8 + depth * 16}px`, onclick: () => void selectView({ kind: "group", path: g.path }) },
        chev,
        icon(ico),
        h("span", { class: "name" }, label),
      );
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showMenu(e.clientX, e.clientY, groupMenu(g));
      });
      row.addEventListener("dragover", (e) => {
        if (e.dataTransfer?.types.includes("text/x-scriptorium")) {
          e.preventDefault();
          row.classList.add("drop");
        }
      });
      row.addEventListener("dragleave", () => row.classList.remove("drop"));
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        row.classList.remove("drop");
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
      treeEl.append(rowFor(g, depth, g.name, "doc"));
      if (!S.collapsed.has(g.path)) for (const c of g.children) addGroup(c, depth + 1);
    };
    for (const c of S.tree.children) addGroup(c, 0);
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
        { label: "Delete group", run: () => void deleteGroup(g), danger: true },
      );
    }
    return items;
  }

  async function selectView(v: View): Promise<void> {
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

  function renderSheets(): void {
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
    const name =
      v.kind === "all" ? "All" : v.kind === "recent" ? "Last 7 Days" : v.kind === "filter" ? (S.meta.filters.find((f) => f.id === v.id)?.name ?? "Filter") : v.path === "" ? "Inbox" : (v.path.split("/").pop() ?? "");
    const words = S.sheets.filter((x) => !isMaterial(x.path)).reduce((n, x) => n + x.words, 0);
    listTitle.append(
      h("span", { class: "lt-name" }, name),
      h("span", { class: "lt-count", title: "Material sheets are not counted" }, `${plural(S.sheets.length, "sheet")} · ${plural(words, "word")}`),
    );
    units = unitsOf(S.sheets);
    if (!units.length) {
      sheetsEl.append(h("div", { class: "none" }, v.kind === "recent" ? "Nothing written in the last 7 days." : v.kind === "filter" ? "No sheets match this filter." : "No sheets here yet."));
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
    const words = u.sheets.reduce((n, x) => n + x.words, 0);
    const meta = [
      whenText(Math.max(...u.sheets.map((x) => x.modified))),
      glued ? `${u.sheets.length} glued sheets · ${plural(words, "word")}` : plural(words, "word"),
      S.view.kind !== "group" ? groupOf(first.path) : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const badge = mat ? icon("torn") : glued ? icon("glue") : null;
    const row = h(
      "div",
      { class: "sheet-item" + (S.sel.has(u.key) ? " selected" : "") + (mat ? " material" : "") + (glued ? " glued" : ""), draggable: "true", "data-key": u.key },
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
      { class: "sheet-item" + (isOpen(hit.path) ? " selected" : ""), onclick: () => void openSheet(hit.path) },
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
    if (canGlue(targets)) items.push({ label: `Glue ${paths.length} sheets`, run: () => void glueUnits(targets) });
    if (targets.length === 1 && u.paths.length > 1) items.push({ label: "Unglue sheets", run: () => void unglue(u) });
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
  async function openSheet(path: string): Promise<void> {
    const g = glueOf(S.meta, path);
    const key = g?.[0] ?? path;
    if (isOpen(path)) {
      S.sel = new Set([key]);
      S.anchor = key;
      renderSheets();
      view.focus();
      return;
    }
    await flushSave();
    const paths = g ?? [path];
    try {
      const texts = await Promise.all(paths.map((p) => api.readSheet(p)));
      S.current = paths[0];
      S.glue = g;
      S.savedParts = texts;
      setDoc(texts.join(GLUE_JOIN), !!g);
      S.version = S.savedVersion = 0;
      S.sel = new Set([key]);
      S.anchor = key;
      setHasNone(false);
      setSave("");
      refreshCrumb();
      applyMaterialClass();
      renderSheets();
      view.focus();
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
      // a new sheet goes to the end of the group, after the others in their current order
      const others = arrange(S.meta, group, await api.listSheets(group, false)).map((x) => x.path).filter((x) => x !== p);
      S.meta.order[group] = [...others, p];
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

  /** Forget deleted paths: structure, selection, the open sheet and the current view. */
  function afterDelete(gone: (p: string) => boolean): void {
    dropFromMeta(S.meta, gone);
    persistMeta();
    S.sel = new Set([...S.sel].filter((k) => !gone(k)));
    if (S.view.kind === "group" && gone(S.view.path)) S.view = { kind: "group", path: "" };
    if (S.current && (gone(S.current) || S.glue?.some(gone))) closeEditor();
  }

  async function deleteGroup(g: Group): Promise<void> {
    const ok = await askConfirm(`Delete “${g.name}”?`, "The group and everything in it moves to the .trash folder inside your library, so it can be recovered.", "Delete");
    if (!ok) return;
    await flushSave();
    try {
      await api.deleteItem(g.path);
      afterDelete((p) => p === g.path || p.startsWith(g.path + "/"));
      await refresh();
      toast("Moved to .trash");
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
    toast("Moved to .trash");
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
  el("btnTypewriter").addEventListener("click", toggleTypewriter);
  el("btnTheme").addEventListener("click", cycleTheme);
  el("btnExport").addEventListener("click", () => void exportSheet());
  el("btnFocus").addEventListener("click", toggleFocus);

  window.addEventListener("keydown", (e) => {
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
  S.meta = parseMeta(await api.readMeta().catch(() => ""));
  await refresh();
  // Open the most recent sheet so the app starts in your writing, not an empty room.
  if (S.sheets[0]) await openSheet(S.sheets[0].path);
}

main().catch((e) => {
  document.body.textContent = `Scriptorium couldn't start: ${msg(e)}`;
});
