import { describe, expect, it } from "vitest";
import { arrange, dropFromMeta, emptyMeta, glueOf, mergeMeta, parseMeta, remapMeta, tidy, type Meta } from "../src/meta";

const meta = (m: Partial<Meta> = {}): Meta => ({ ...emptyMeta(), ...m });
const sheets = (...paths: string[]) => paths.map((path) => ({ path }));
const paths = (xs: { path: string }[]) => xs.map((x) => x.path);

describe("parseMeta", () => {
  it("survives empty, broken and wrong-shaped input", () => {
    expect(parseMeta("")).toEqual(emptyMeta());
    expect(parseMeta("{nope")).toEqual(emptyMeta());
    expect(parseMeta("[1,2]")).toEqual(emptyMeta());
    expect(parseMeta('{"order":{"a":[1,"x.md"]},"material":"x","glue":[["a.md"],["a.md","b.md"]],"filters":[{"id":1}]}')).toEqual(
      meta({ order: { a: ["x.md"] }, glue: [["a.md", "b.md"]] }),
    );
  });

  it("round-trips filters", () => {
    const m = meta({ filters: [{ id: "f1", name: "Drafts", query: "draft", days: 7, group: "Book" }] });
    expect(parseMeta(JSON.stringify(m))).toEqual(m);
  });
});

describe("remapMeta / dropFromMeta", () => {
  it("follows a renamed group everywhere", () => {
    const m = meta({
      order: { Book: ["Book/a.md", "Book/b.md"] },
      material: ["Book/b.md"],
      glue: [["Book/a.md", "Book/b.md"]],
      filters: [{ id: "f", name: "x", query: "", days: 0, group: "Book" }],
    });
    remapMeta(m, (p) => (p === "Book" || p.startsWith("Book/") ? "Novel" + p.slice(4) : p));
    expect(m.order).toEqual({ Novel: ["Novel/a.md", "Novel/b.md"] });
    expect(m.material).toEqual(["Novel/b.md"]);
    expect(m.glue).toEqual([["Novel/a.md", "Novel/b.md"]]);
    expect(m.filters[0].group).toBe("Novel");
  });

  it("a sheet moved out of its group leaves the order list and breaks the glue", () => {
    const m = meta({ order: { "": ["a.md", "b.md"] }, glue: [["a.md", "b.md"]] });
    remapMeta(m, (p) => (p === "b.md" ? "G/b.md" : p));
    expect(m.order).toEqual({ "": ["a.md"] });
    expect(m.glue).toEqual([]);
  });

  it("deleting drops paths, empty orders and one-sheet glue", () => {
    const m = meta({ order: { "": ["a.md", "b.md"] }, material: ["a.md"], glue: [["a.md", "b.md"]], filters: [{ id: "f", name: "x", query: "q", days: 0, group: "G" }] });
    dropFromMeta(m, (p) => p === "a.md" || p === "G");
    expect(m).toEqual(meta({ order: { "": ["b.md"] }, filters: [{ id: "f", name: "x", query: "q", days: 0, group: "" }] }));
  });
});

describe("tidy", () => {
  it("keeps a sheet in only one glue set and only siblings together", () => {
    const m = meta({ glue: [["a.md", "b.md"], ["b.md", "c.md"], ["G/x.md", "y.md", "G/z.md"]] });
    tidy(m);
    // b.md stays with a.md only; the third set keeps just the siblings of its first sheet
    expect(m.glue).toEqual([["a.md", "b.md"], ["G/x.md", "G/z.md"]]);
  });
  it("de-duplicates the order list", () => {
    const m = meta({ order: { "": ["a.md", "a.md", "b.md"] } });
    tidy(m);
    expect(m.order[""]).toEqual(["a.md", "b.md"]);
  });
});

describe("arrange", () => {
  it("puts arranged sheets first in their order and new ones after, as given", () => {
    const m = meta({ order: { "": ["b.md", "a.md"] } });
    expect(paths(arrange(m, "", sheets("new1.md", "a.md", "b.md", "new2.md")))).toEqual(["b.md", "a.md", "new1.md", "new2.md"]);
  });
  it("leaves the given order alone when nothing is arranged", () => {
    expect(paths(arrange(meta(), "", sheets("z.md", "a.md")))).toEqual(["z.md", "a.md"]);
  });
  it("keeps glued sheets together, in reading order, at the first one's place", () => {
    const m = meta({ order: { "": ["a.md", "x.md", "c.md", "b.md"] }, glue: [["b.md", "a.md"]] });
    expect(paths(arrange(m, "", sheets("c.md", "b.md", "x.md", "a.md")))).toEqual(["b.md", "a.md", "x.md", "c.md"]);
  });
  it("ignores glue whose members aren't all in the list", () => {
    const m = meta({ glue: [["a.md", "gone.md"]] });
    expect(paths(arrange(m, "", sheets("a.md", "b.md")))).toEqual(["a.md", "b.md"]);
  });
});

describe("glueOf", () => {
  it("finds the set a sheet belongs to", () => {
    const m = meta({ glue: [["a.md", "b.md"]] });
    expect(glueOf(m, "b.md")).toEqual(["a.md", "b.md"]);
    expect(glueOf(m, "c.md")).toBeNull();
  });
});

describe("mergeMeta (two devices, one synced folder)", () => {
  const base = meta({ order: { "": ["a.md", "b.md", "c.md"] }, material: ["m.md"], filters: [{ id: "f1", name: "One", query: "x", days: 0, group: "" }] });
  const clone = (m: Meta): Meta => JSON.parse(JSON.stringify(m));

  it("takes the other side's change when only they changed", () => {
    const theirs = clone(base);
    theirs.order[""] = ["c.md", "a.md", "b.md"];
    expect(mergeMeta(base, clone(base), theirs).order[""]).toEqual(["c.md", "a.md", "b.md"]);
  });

  it("keeps my change when only I changed", () => {
    const mine = clone(base);
    mine.material.push("n.md");
    expect(mergeMeta(base, mine, clone(base)).material.sort()).toEqual(["m.md", "n.md"]);
  });

  it("keeps both sides' changes to different things", () => {
    const mine = clone(base);
    mine.material.push("mine.md");
    mine.filters.push({ id: "f2", name: "Mine", query: "q", days: 0, group: "" });
    const theirs = clone(base);
    theirs.material.push("theirs.md");
    theirs.glue = [["a.md", "b.md"]];
    const out = mergeMeta(base, mine, theirs);
    expect(out.material.sort()).toEqual(["m.md", "mine.md", "theirs.md"]);
    expect(out.glue).toEqual([["a.md", "b.md"]]);
    expect(out.filters.map((f) => f.id)).toEqual(["f1", "f2"]);
  });

  it("applies my removal on top of their other changes", () => {
    const mine = clone(base);
    mine.material = [];
    const theirs = clone(base);
    theirs.material.push("theirs.md");
    expect(mergeMeta(base, mine, theirs).material).toEqual(["theirs.md"]);
  });

  it("when both reordered the same group, keeps their order and adds my new sheets", () => {
    const mine = clone(base);
    mine.order[""] = ["a.md", "b.md", "c.md", "mine.md"];
    const theirs = clone(base);
    theirs.order[""] = ["c.md", "b.md", "a.md"];
    expect(mergeMeta(base, mine, theirs).order[""]).toEqual(["c.md", "b.md", "a.md", "mine.md"]);
  });

  it("filters: my edit wins, their delete of an untouched filter wins, my delete wins", () => {
    const mine = clone(base);
    mine.filters[0].name = "Renamed";
    expect(mergeMeta(base, mine, clone(base)).filters[0].name).toBe("Renamed");

    const theirsDeleted = clone(base);
    theirsDeleted.filters = [];
    expect(mergeMeta(base, clone(base), theirsDeleted).filters).toEqual([]);
    expect(mergeMeta(base, mine, theirsDeleted).filters[0].name).toBe("Renamed");

    const mineDeleted = clone(base);
    mineDeleted.filters = [];
    expect(mergeMeta(base, mineDeleted, clone(base)).filters).toEqual([]);
  });

  it("is a no-op when nobody changed anything", () => {
    expect(mergeMeta(base, clone(base), clone(base))).toEqual(base);
  });
});
