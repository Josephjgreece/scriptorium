import "./styles.css";
import { loadApi, type Api, type Group, type SearchHit, type SheetInfo } from "./api";
import { createEditor, makeState } from "./editor";

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

  type View = { kind: "all" } | { kind: "group"; path: string };
  const S = {
    tree: null as Group | null,
    view: { kind: "group", path: "" } as View,
    sheets: [] as SheetInfo[],
    hits: null as SearchHit[] | null,
    current: null as string | null,
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
  const setDoc = (text: string) => view.setState(makeState(text, hooks));
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
    const text = view.state.doc.toString();
    const words = (text.match(/\S+/g) ?? []).length;
    el("stWords").textContent = `${words.toLocaleString()} ${words === 1 ? "word" : "words"}`;
    el("stChars").textContent = `${text.length.toLocaleString()} characters`;
    el("stRead").textContent = `${Math.max(words ? 1 : 0, Math.ceil(words / 220))} min read`;
  }
  function setSave(text: string): void {
    el("stSave").textContent = text;
  }
  function setHasNone(none: boolean): void {
    document.body.classList.toggle("has-none", none);
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
    const path = S.current;
    const np = await api.writeSheet(path, view.state.doc.toString());
    S.savedVersion = v;
    if (S.current === path && np !== path) {
      S.current = np;
      crumb.textContent = crumbFor(np);
    }
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
      S.sheets = await api.listSheets(S.view.kind === "all" ? "" : S.view.path, S.view.kind === "all");
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

  const totalCount = (g: Group): number => g.count + g.children.reduce((n, c) => n + totalCount(c), 0);
  const viewGroupPath = (): string => (S.view.kind === "group" ? S.view.path : "");

  // -------- library tree
  function renderTree(): void {
    treeEl.replaceChildren();
    if (!S.tree) return;
    const allActive = S.view.kind === "all";
    treeEl.append(
      h(
        "div",
        { class: "row" + (allActive ? " active" : ""), style: "padding-left:6px", onclick: () => void selectView({ kind: "all" }) },
        h("span", { class: "chev" }),
        h("span", { class: "name" }, "All sheets"),
        h("span", { class: "count" }, String(totalCount(S.tree))),
      ),
      h("div", { class: "tree-sep" }),
    );
    const addGroup = (g: Group, depth: number): void => {
      const isRoot = g.path === "";
      const open = isRoot || !S.collapsed.has(g.path);
      const active = S.view.kind === "group" && S.view.path === g.path;
      const chev = h("span", { class: "chev" + (open ? " open" : "") });
      if (g.children.length) {
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
        { class: "row" + (active ? " active" : ""), style: `padding-left:${6 + depth * 14}px`, onclick: () => void selectView({ kind: "group", path: g.path }) },
        chev,
        h("span", { class: "name" }, g.name),
        h("span", { class: "count" }, String(g.count)),
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
        const src = e.dataTransfer?.getData("text/x-scriptorium");
        if (src) void moveTo(src, g.path);
      });
      treeEl.append(row);
      if (open) for (const c of g.children) addGroup(c, depth + 1);
    };
    addGroup(S.tree, 0);
  }

  function groupMenu(g: Group): MenuItem[] {
    const items: MenuItem[] = [
      { label: "New sheet here", run: () => void newSheetIn(g.path) },
      { label: "New group inside…", run: () => void newGroup(g.path) },
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
  function renderSheets(): void {
    sheetsEl.replaceChildren();
    if (S.hits) {
      listTitle.textContent = `${S.hits.length} ${S.hits.length === 1 ? "result" : "results"}`;
      if (!S.hits.length) sheetsEl.append(h("div", { class: "none" }, "Nothing found."));
      for (const hit of S.hits) {
        sheetsEl.append(sheetRow(hit.path, hit.title, hit.snippet, groupOf(hit.path)));
      }
      return;
    }
    listTitle.textContent = S.view.kind === "all" ? "All sheets" : S.view.path === "" ? "Library" : S.view.path.split("/").pop() ?? "";
    if (!S.sheets.length) {
      sheetsEl.append(h("div", { class: "none" }, "No sheets here yet."));
      return;
    }
    for (const s of S.sheets) {
      const meta = [whenText(s.modified), `${s.words.toLocaleString()} ${s.words === 1 ? "word" : "words"}`, S.view.kind === "all" ? groupOf(s.path) : ""]
        .filter(Boolean)
        .join(" · ");
      sheetsEl.append(sheetRow(s.path, s.title, s.preview, meta));
    }
  }

  function crumbFor(path: string): string {
    return groupOf(path) + "  ›  " + (path.split("/").pop() ?? "").replace(/\.md$/i, "");
  }

  function groupOf(path: string): string {
    const i = path.lastIndexOf("/");
    return i < 0 ? "Library" : path.slice(0, i);
  }

  function sheetRow(path: string, title: string, preview: string, meta: string): HTMLElement {
    const row = h(
      "div",
      { class: "sheet-item" + (path === S.current ? " active" : ""), draggable: "true", "data-path": path, onclick: () => void openSheet(path) },
      h("div", { class: "si-title" }, title || "Untitled"),
      h("div", { class: "si-prev" }, preview),
      meta ? h("div", { class: "si-meta" }, meta) : null,
    );
    row.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/x-scriptorium", path);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showMenu(e.clientX, e.clientY, [
        { label: "Open", run: () => void openSheet(path) },
        { label: "Export…", run: () => void exportSheet(path) },
        { label: "Move to library root", run: () => void moveTo(path, "") },
        { label: "Delete sheet", run: () => void deleteSheet(path), danger: true, sep: true },
      ]);
    });
    return row;
  }

  // -------- opening / closing sheets
  async function openSheet(path: string): Promise<void> {
    if (path === S.current) {
      view.focus();
      return;
    }
    await flushSave();
    try {
      const text = await api.readSheet(path);
      S.current = path;
      setDoc(text);
      S.version = S.savedVersion = 0;
      setHasNone(false);
      updateStats();
      setSave("");
      crumb.textContent = crumbFor(path);
      renderSheets();
      view.focus();
    } catch (e) {
      toast(`Couldn't open that sheet: ${msg(e)}`);
      await refresh();
    }
  }

  function closeEditor(): void {
    S.current = null;
    setDoc("");
    S.version = S.savedVersion = 0;
    setHasNone(true);
    crumb.textContent = "";
    updateStats();
  }

  // -------- actions
  async function newSheetIn(group: string): Promise<void> {
    await flushSave();
    try {
      searchEl.value = "";
      S.hits = null;
      const p = await api.createSheet(group);
      if (S.view.kind === "group" && S.view.path !== group) S.view = { kind: "group", path: group };
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
      const remap = (p: string) => (p === g.path || p.startsWith(g.path + "/") ? np + p.slice(g.path.length) : p);
      if (S.view.kind === "group") S.view = { kind: "group", path: remap(S.view.path) };
      if (S.current) {
        S.current = remap(S.current);
        crumb.textContent = crumbFor(S.current);
      }
      S.collapsed = new Set([...S.collapsed].map(remap));
      lsSet("collapsed", JSON.stringify([...S.collapsed]));
      await refresh();
    } catch (e) {
      toast(msg(e));
    }
  }

  async function deleteGroup(g: Group): Promise<void> {
    const ok = await askConfirm(`Delete “${g.name}”?`, "The group and everything in it moves to the .trash folder inside your library, so it can be recovered.", "Delete");
    if (!ok) return;
    await flushSave();
    try {
      await api.deleteItem(g.path);
      const inside = (p: string) => p === g.path || p.startsWith(g.path + "/");
      if (S.view.kind === "group" && inside(S.view.path)) S.view = { kind: "group", path: "" };
      if (S.current && inside(S.current)) closeEditor();
      await refresh();
      toast("Moved to .trash");
    } catch (e) {
      toast(msg(e));
    }
  }

  async function deleteSheet(path: string): Promise<void> {
    await flushSave();
    try {
      await api.deleteItem(path);
      if (S.current === path) closeEditor();
      if (S.hits) S.hits = S.hits.filter((h2) => h2.path !== path);
      await refresh();
      toast("Moved to .trash");
    } catch (e) {
      toast(msg(e));
    }
  }

  async function moveTo(path: string, group: string): Promise<void> {
    await flushSave();
    try {
      const np = await api.moveItem(path, group);
      if (S.current === path) {
        S.current = np;
        crumb.textContent = crumbFor(np);
      }
      await refresh();
    } catch (e) {
      toast(msg(e));
    }
  }

  async function exportSheet(path = S.current ?? ""): Promise<void> {
    if (!path) return;
    await flushSave();
    const title = S.sheets.find((s) => s.path === path)?.title ?? (path.split("/").pop() ?? "Sheet").replace(/\.md$/i, "");
    try {
      const out = await api.exportSheet(path, title);
      if (out) toast(`Exported to ${out}`);
    } catch (e) {
      toast(msg(e));
    }
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
  await refresh();
  // Open the most recent sheet so the app starts in your writing, not an empty room.
  if (S.sheets[0]) await openSheet(S.sheets[0].path);
}

main().catch((e) => {
  document.body.textContent = `Scriptorium couldn't start: ${msg(e)}`;
});
