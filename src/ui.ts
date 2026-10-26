// Small shared UI helpers: element builder, icons, toast, modals, context menu.
// (Split out of main.ts so feature modules can use them.)

export type Kid = Node | string | null | undefined;

export function h<K extends keyof HTMLElementTagNameMap>(
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

export function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`#${id} missing`);
  return found as T;
}

export function ls(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export const ICONS: Record<string, string> = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  folderPlus: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/>',
  type: '<path d="M4 7V5h16v2M12 5v14M9 19h6"/>',
  theme: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  export: '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>',
  focus: '<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  outline: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  aa: '<path d="M3.5 18L8 6.5 12.5 18M5.2 14h5.6M14.5 18l3-8 3 8M15.7 16h4.6"/>',
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
export const GROUP_ICONS = ["doc", "book", "star", "heart", "flag", "bookmark", "bolt", "bulb", "leaf", "pen"];
export const GROUP_COLORS: Record<string, string> = { blue: "#3b78d8", teal: "#2f93c0", green: "#3a9a5b", orange: "#d9822b", red: "#c8453b", purple: "#8a58c8" };

export function icon(name: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICONS[name];
  return svg;
}

export const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

let toastTimer = 0;
export function toast(text: string): void {
  const t = el("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove("show"), 3200);
}

export function whenText(secs: number): string {
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

export function modal(build: (close: (v: string | null) => void, ov: HTMLElement) => HTMLElement): Promise<string | null> {
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

export function askText(title: string, initial = "", okLabel = "OK"): Promise<string | null> {
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

export async function askConfirm(title: string, body: string, okLabel: string): Promise<boolean> {
  const r = await modal((close) => {
    const okBtn = h("button", { class: "btn primary", onclick: () => close("yes") }, okLabel);
    queueMicrotask(() => okBtn.focus());
    return h("div", { class: "modal" }, h("h3", {}, title), h("p", {}, body), h("div", { class: "actions" }, h("button", { class: "btn", onclick: () => close(null) }, "Cancel"), okBtn));
  });
  return r === "yes";
}

export interface MenuItem {
  label: string;
  run: () => void;
  danger?: boolean;
  sep?: boolean;
}
export function showMenu(x: number, y: number, items: MenuItem[]): void {
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


// ------------------------------------------------------------------ popovers

let openPop: { close: () => void; owner: HTMLElement } | null = null;

export function closePopover(): void {
  openPop?.close();
}

/** A small panel attached to a button. Clicking the button again, clicking away or Escape closes it. */
export function togglePopover(anchor: HTMLElement, content: HTMLElement, opts: { align?: "left" | "right"; above?: boolean } = {}): void {
  if (openPop?.owner === anchor) {
    openPop.close();
    return;
  }
  openPop?.close();
  const pop = h("div", { class: "popover", role: "dialog" }, content);
  document.body.append(pop);
  const a = anchor.getBoundingClientRect();
  const r = pop.getBoundingClientRect();
  const x = Math.max(8, Math.min(opts.align === "right" ? a.right - r.width : a.left, innerWidth - r.width - 8));
  const y = opts.above ? a.top - r.height - 8 : a.bottom + 8;
  pop.style.left = `${x}px`;
  pop.style.top = `${Math.max(8, Math.min(y, innerHeight - r.height - 8))}px`;
  const away = (e: Event) => {
    if (!pop.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  const esc = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  const close = () => {
    pop.remove();
    window.removeEventListener("mousedown", away, true);
    window.removeEventListener("keydown", esc, true);
    if (openPop?.close === close) openPop = null;
  };
  window.addEventListener("mousedown", away, true);
  window.addEventListener("keydown", esc, true);
  openPop = { close, owner: anchor };
}
