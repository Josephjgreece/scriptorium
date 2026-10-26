import { describe, expect, it } from "vitest";
import { countWords, parseHeadings, stripComments, textStats } from "../src/text";
import { inSyntax, smartReplace } from "../src/typography";

describe("countWords", () => {
  it("ignores Markdown marks that stand alone", () => {
    expect(countWords("# Title\n\n- item one\n---\n> quoted words\n\n* * *")).toBe(5);
  });
  it("ignores comments, even across lines, but not an unterminated one", () => {
    expect(countWords("a <!-- hidden words here --> b")).toBe(2);
    expect(countWords("a <!-- multi\nline\ncomment --> b <!-- another --> c")).toBe(3);
    expect(countWords("half <!-- typed comment with no end and more words")).toBe(9);
  });
  it("counts numbers, accents and curly punctuation sensibly", () => {
    expect(countWords("It's 2026 — “quoted”, fine.")).toBe(4);
    expect(countWords("naïve café 日本語")).toBe(3);
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\n  ")).toBe(0);
  });
  it("agrees with the Rust side on the same sample", () => {
    expect(countWords("# One\n\n- two <!-- three -->")).toBe(2);
  });
});

describe("textStats", () => {
  it("counts sentences, paragraphs and reading time", () => {
    const s = textStats("# A title\n\nOne sentence. Two sentences! Three?\n\nA second paragraph without a full stop");
    expect(s.words).toBe(14);
    expect(s.sentences).toBe(5); // title, three, and the trailing fragment
    expect(s.paragraphs).toBe(3);
    expect(s.readingMinutes).toBe(1);
  });
  it("keeps abbreviations-with-quotes and ellipses from over-counting", () => {
    expect(textStats('He said "Stop." Then left.').sentences).toBe(2);
    expect(textStats("Wait… what?").sentences).toBe(2);
  });
  it("leaves comments out of every figure", () => {
    const s = textStats("Real words. <!-- note to self: rewrite all of this -->");
    expect(s.words).toBe(2);
    expect(s.charactersNoSpaces).toBe("Realwords.".length);
  });
  it("is all zeros for nothing, and reading time rounds up", () => {
    expect(textStats("")).toEqual({ words: 0, characters: 0, charactersNoSpaces: 0, sentences: 0, paragraphs: 0, readingMinutes: 0 });
    expect(textStats("word ".repeat(221)).readingMinutes).toBe(2);
  });
});

describe("parseHeadings", () => {
  it("finds headings with levels and offsets, tidying inline marks", () => {
    const doc = "# One\n\ntext\n\n## **Two** and `code` [link](http://x)\n\n###### Six ##\n";
    const h = parseHeadings(doc);
    expect(h.map((x) => [x.level, x.text])).toEqual([
      [1, "One"],
      [2, "Two and code link"],
      [6, "Six"],
    ]);
    expect(doc.slice(h[1].from, h[1].from + 2)).toBe("##");
  });
  it("skips fenced code and comments, and things that aren't headings", () => {
    const doc = "# Real\n\n```\n# not a heading\n```\n\n<!--\n# also not\n-->\n\n#hashtag\n####### seven\n    # indented code\n## Second";
    expect(parseHeadings(doc).map((x) => x.text)).toEqual(["Real", "Second"]);
  });
  it("copes with an unterminated fence and empty headings", () => {
    expect(parseHeadings("# A\n```\n# B").map((x) => x.text)).toEqual(["A"]);
    expect(parseHeadings("#  \n# X")).toEqual([{ level: 1, text: "X", from: 4 }]);
  });
});

describe("stripComments", () => {
  it("removes comments only", () => {
    expect(stripComments("a<!-- x -->b").replace(/\s+/g, "")).toBe("ab");
    expect(stripComments("a <!-- open")).toBe("a <!-- open");
  });
});

describe("smartReplace", () => {
  const r = (before: string, typed: string) => smartReplace(before, typed);
  it("opens and closes double quotes by context", () => {
    expect(r("", '"')).toEqual({ deleteBefore: 0, insert: "“" });
    expect(r("He said ", '"')).toEqual({ deleteBefore: 0, insert: "“" });
    expect(r("He said (", '"')).toEqual({ deleteBefore: 0, insert: "“" });
    expect(r("He said “Hi", '"')).toEqual({ deleteBefore: 0, insert: "”" });
    expect(r("end.", '"')).toEqual({ deleteBefore: 0, insert: "”" });
    expect(r("word—", '"')).toEqual({ deleteBefore: 0, insert: "“" });
  });
  it("handles single quotes and apostrophes", () => {
    expect(r("don", "'")).toEqual({ deleteBefore: 0, insert: "’" });
    expect(r("She said ", "'")).toEqual({ deleteBefore: 0, insert: "‘" });
    expect(r("“", "'")).toEqual({ deleteBefore: 0, insert: "‘" });
    expect(r("it’s the dogs", "'")).toEqual({ deleteBefore: 0, insert: "’" });
  });
  it("turns three dots into an ellipsis, only once", () => {
    expect(r("wait..", ".")).toEqual({ deleteBefore: 2, insert: "…" });
    expect(r("wait.", ".")).toBeNull();
    expect(r("wait…", ".")).toBeNull();
  });
  it("turns -- into an en dash and --- into an em dash, but leaves rules and list markers alone", () => {
    expect(r("1939-", "-")).toEqual({ deleteBefore: 1, insert: "–" });
    expect(r("1939–", "-")).toEqual({ deleteBefore: 1, insert: "—" });
    expect(r("-", "-")).toBeNull();
    expect(r("  -", "-")).toBeNull();
    expect(r("--", "-")).toBeNull();
    expect(r("a", "-")).toBeNull();
  });
  it("leaves everything else alone", () => {
    expect(r("abc", "d")).toBeNull();
    expect(r("abc ", " ")).toBeNull();
  });
  it("never touches quotes inside HTML tags or link destinations", () => {
    expect(r('<a href=', '"')).toBeNull();
    expect(r('<img src="x" alt=', '"')).toBeNull();
    expect(r("[a](http://x ", '"')).toBeNull();
    expect(r("a < b and ", '"')).toEqual({ deleteBefore: 0, insert: "“" });
    expect(inSyntax("<p>done</p> and ")).toBe(false);
  });
});
