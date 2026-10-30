// On a phone the three panes (library, sheets, text) show one at a time, left to right.

export type Pane = "lib" | "list" | "ed";

const ORDER: Pane[] = ["lib", "list", "ed"];

/** Narrower than this, one pane at a time. Tablets and computers keep all three. */
export const NARROW_QUERY = "(max-width: 820px)";

/** The pane "back" returns to, or null on the first pane. */
export const previousPane = (p: Pane): Pane | null => ORDER[ORDER.indexOf(p) - 1] ?? null;

/** Going to a pane further right is a step forward; it gets a history entry so the Android back button returns. */
export const isForward = (from: Pane, to: Pane): boolean => ORDER.indexOf(to) > ORDER.indexOf(from);

/** The panes passed through on the way forward from one to another, ending at the destination. */
export const stepsTo = (from: Pane, to: Pane): Pane[] => (isForward(from, to) ? ORDER.slice(ORDER.indexOf(from) + 1, ORDER.indexOf(to) + 1) : []);

/** Read a pane back out of a history entry, whatever it holds. */
export function paneFromState(state: unknown): Pane {
  const p = state && typeof state === "object" ? (state as { pane?: unknown }).pane : undefined;
  return p === "list" || p === "ed" || p === "lib" ? p : "lib";
}

export interface SetupNotice {
  title: string;
  lines: string[];
}

/** What to tell someone whose library can't be shown yet, from what the app could see. */
export function setupNotice(s: { path: string; readable: boolean; denied: boolean; sheets: number; readOnly: boolean }): SetupNotice | null {
  if (!s.readable) {
    return {
      title: s.denied ? "Scriptorium isn't allowed to see your files yet" : "Scriptorium can't find your library",
      lines: [
        `It looks for your sheets in ${s.path}.`,
        "Allow it to read files: Settings, Apps, Scriptorium, Permissions, Files and media, then “Allow management of all files”. It can also be under Settings, Apps, Special app access, All files access.",
        "Then make sure your library folder is in that place, for instance synced there by a folder-sync app, and tap Check again.",
      ],
    };
  }
  if (s.readOnly && s.sheets === 0) {
    return {
      title: "Your library folder is empty",
      lines: [`Scriptorium reads your sheets from ${s.path}, and there are none there yet.`, "Put your library folder in that place, for instance synced there by a folder-sync app, and tap Check again."],
    };
  }
  return null;
}
