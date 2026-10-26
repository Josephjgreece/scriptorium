import { describe, expect, it } from "vitest";
import { DEFAULTS, LINE_RANGE, parseAppearance, SIZE_RANGE } from "../src/appearance";
import { currentEntry, navEntries } from "../src/panels";

describe("parseAppearance", () => {
  it("falls back to the defaults for nothing, junk and the wrong shape", () => {
    expect(parseAppearance(null)).toEqual(DEFAULTS);
    expect(parseAppearance("")).toEqual(DEFAULTS);
    expect(parseAppearance("{nope")).toEqual(DEFAULTS);
    expect(parseAppearance("[1,2]")).toEqual(DEFAULTS);
    expect(parseAppearance('{"theme":"neon","font":"comic","width":"huge","size":"big","line":null,"typography":"yes"}')).toEqual(DEFAULTS);
  });
  it("keeps valid choices and clamps numbers into range", () => {
    const a = parseAppearance('{"theme":"midnight","font":"serif","width":"wide","size":99,"line":0.2,"typography":false}');
    expect(a).toEqual({ theme: "midnight", font: "serif", width: "wide", size: SIZE_RANGE.max, line: LINE_RANGE.min, typography: false });
    expect(parseAppearance('{"size":3}').size).toBe(SIZE_RANGE.min);
  });
  it("rounds line spacing to a tenth and size to a whole pixel", () => {
    const a = parseAppearance('{"size":20.6,"line":1.8499}');
    expect(a.size).toBe(21);
    expect(a.line).toBe(1.8);
  });
  it("reads the theme saved by earlier versions", () => {
    expect(parseAppearance(null, "dark").theme).toBe("dark");
    expect(parseAppearance(null, "bogus").theme).toBe("auto");
    expect(parseAppearance('{"theme":"sepia"}', "dark").theme).toBe("sepia");
  });
});

describe("navigator entries", () => {
  const heads = [
    { level: 1, text: "One", from: 0 },
    { level: 2, text: "Two", from: 50 },
    { level: 1, text: "Three", from: 120 },
  ];
  it("lists headings in order, and sheet markers when glued", () => {
    expect(navEntries(heads, []).map((e) => e.label)).toEqual(["One", "Two", "Three"]);
    const glued = navEntries(heads, [100]);
    expect(glued.map((e) => `${e.kind}:${e.label}`)).toEqual(["sheet:Sheet 1", "heading:One", "heading:Two", "sheet:Sheet 2", "heading:Three"]);
  });
  it("finds the heading the cursor is under", () => {
    const e = navEntries(heads, []);
    expect(currentEntry(e, 0)).toBe(0);
    expect(currentEntry(e, 49)).toBe(0);
    expect(currentEntry(e, 50)).toBe(1);
    expect(currentEntry(e, 9999)).toBe(2);
    expect(currentEntry(navEntries([{ level: 1, text: "A", from: 10 }], []), 3)).toBe(-1);
  });
});
