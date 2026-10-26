// Typographic typing: curly quotes, en/em dashes and ellipses as you type. Pure rules; the
// editor decides when to apply them (never inside code, links or HTML tags).

export interface Replacement {
  /** how many characters before the cursor are replaced */
  deleteBefore: number;
  insert: string;
}

const OPENS = /[\s(\[{<“‘–—/]/;

/** True where typing a quote would corrupt Markdown or HTML: inside a tag or a link destination. */
export function inSyntax(before: string): boolean {
  if (before.lastIndexOf("<") > before.lastIndexOf(">") && /<[A-Za-z/!]/.test(before.slice(before.lastIndexOf("<")))) return true;
  return /\]\([^)]*$/.test(before);
}

/**
 * What typing `typed` after `before` (the line so far) should become, or null to type it as is.
 * "before" is the text of the current line up to the cursor.
 */
export function smartReplace(before: string, typed: string): Replacement | null {
  const prev = before.slice(-1);
  if (typed === '"') {
    if (inSyntax(before)) return null;
    return { deleteBefore: 0, insert: before === "" || OPENS.test(prev) ? "“" : "”" };
  }
  if (typed === "'") {
    if (inSyntax(before)) return null;
    if (/[\p{L}\p{N}]/u.test(prev)) return { deleteBefore: 0, insert: "’" }; // apostrophe or closing
    return { deleteBefore: 0, insert: before === "" || OPENS.test(prev) ? "‘" : "’" };
  }
  if (typed === "." && before.endsWith("..") && !before.endsWith("...")) return { deleteBefore: 2, insert: "…" };
  if (typed === "-") {
    if (before.endsWith("–")) return { deleteBefore: 1, insert: "—" };
    // "--" becomes an en dash, but a line that is only hyphens is a rule or a list marker: leave it
    if (before.endsWith("-") && !before.endsWith("--") && !/^\s*-+$/.test(before)) return { deleteBefore: 1, insert: "–" };
  }
  return null;
}
