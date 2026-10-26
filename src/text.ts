// Pure text analysis: word counts (the same rules as the Rust side), statistics, headings.

/** `<!-- ... -->` comments are annotations: out of counts and exports. An unterminated one is plain text. */
export function stripComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, " ");
}

const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** A word is a run of non-space characters with a letter or digit in it, so "#", "-" and ">" alone are not words. */
export function countWords(text: string): number {
  let n = 0;
  for (const w of stripComments(text).split(/\s+/)) if (w && HAS_LETTER_OR_DIGIT.test(w)) n++;
  return n;
}

export const READING_WPM = 220;

export interface TextStats {
  words: number;
  characters: number;
  charactersNoSpaces: number;
  sentences: number;
  paragraphs: number;
  /** whole minutes, at least 1 when there is text */
  readingMinutes: number;
}

export function textStats(raw: string): TextStats {
  const text = stripComments(raw);
  const words = countWords(raw);
  const noSpaces = text.replace(/\s/g, "").length;
  // sentences: a run of text ending in . ! ? … (then space or the end), plus a trailing fragment with words
  const plain = text.replace(/^\s{0,3}#{1,6}\s+/gm, "").replace(/[*_`>]/g, "");
  let sentences = 0;
  for (const block of plain.split(/\n\s*\n/)) {
    const parts = block.replace(/\s+/g, " ").trim().split(/(?<=[.!?…]["'”’)\]]*)\s+/);
    for (const part of parts) if (HAS_LETTER_OR_DIGIT.test(part)) sentences++;
  }
  const paragraphs = text.split(/\n\s*\n/).filter((b) => HAS_LETTER_OR_DIGIT.test(b)).length;
  return {
    words,
    characters: text.replace(/\s+$/, "").length,
    charactersNoSpaces: noSpaces,
    sentences,
    paragraphs,
    readingMinutes: words ? Math.max(1, Math.ceil(words / READING_WPM)) : 0,
  };
}

export interface Heading {
  level: number;
  text: string;
  /** character offset of the start of the heading line */
  from: number;
}

/** ATX headings ("# Title") outside fenced code blocks and comments, with their offsets. */
export function parseHeadings(doc: string): Heading[] {
  const out: Heading[] = [];
  let fence: string | null = null;
  let inComment = false;
  let pos = 0;
  for (const line of doc.split("\n")) {
    const start = pos;
    pos += line.length + 1;
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      continue;
    }
    if (inComment) {
      if (line.includes("-->")) inComment = false;
      continue;
    }
    if (line.includes("<!--") && !line.includes("-->", line.indexOf("<!--"))) {
      inComment = true;
      continue;
    }
    const m = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/.exec(line);
    if (!m) continue;
    const text = m[2].replace(/<!--[\s\S]*?-->/g, "").replace(/[*_`]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim();
    if (text) out.push({ level: m[1].length, text, from: start });
  }
  return out;
}
