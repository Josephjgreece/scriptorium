import { describe, expect, it } from "vitest";
import { emptyMeta, mergeMeta, parseMeta, remapMeta, dropFromMeta, type Meta } from "../src/meta";
import { countsTowardGoal, deadlineText, goalText, isExported, isMaterialPath, orderedSheets, progress, projectOf, projectSheets, roleOf, sectionOf, TEMPLATES } from "../src/projects";

const novel = (): Meta => ({
  ...emptyMeta(),
  projects: {
    Novel: { template: "novel", goal: 1000, deadline: "", sections: { "Novel/Front": "matter", "Novel/Notes": "material", "Novel/Chapters": "manuscript" } },
  },
});

describe("where a path sits in a project", () => {
  const m = novel();
  it("finds the project", () => {
    expect(projectOf(m, "Novel")).toBe("Novel");
    expect(projectOf(m, "Novel/Chapters/One.md")).toBe("Novel");
    expect(projectOf(m, "Novel2/x.md")).toBeNull();
    expect(projectOf(m, "Other/x.md")).toBeNull();
  });
  it("finds the section, including for deeper sheets and the section itself", () => {
    expect(sectionOf(m, "Novel/Chapters/One.md")).toBe("Novel/Chapters");
    expect(sectionOf(m, "Novel/Chapters/Act 1/One.md")).toBe("Novel/Chapters");
    expect(sectionOf(m, "Novel/Chapters")).toBe("Novel/Chapters");
    expect(sectionOf(m, "Novel/Loose.md")).toBeNull();
    expect(sectionOf(m, "Novel")).toBeNull();
    expect(sectionOf(m, "Elsewhere/x.md")).toBeNull();
  });
  it("gives sections without a role the manuscript role", () => {
    expect(roleOf(m, "Novel/Chapters/One.md")).toBe("manuscript");
    expect(roleOf(m, "Novel/Unlisted/x.md")).toBe("manuscript");
    expect(roleOf(m, "Novel/Front/Title.md")).toBe("matter");
    expect(roleOf(m, "Elsewhere/x.md")).toBe("manuscript");
  });
});

describe("what counts and what is exported", () => {
  const m = novel();
  m.material.push("Novel/Chapters/Scrap.md");
  it("manuscript counts and exports", () => {
    expect(countsTowardGoal(m, "Novel/Chapters/One.md")).toBe(true);
    expect(isExported(m, "Novel/Chapters/One.md")).toBe(true);
  });
  it("front and back matter export but do not count", () => {
    expect(countsTowardGoal(m, "Novel/Front/Title.md")).toBe(false);
    expect(isExported(m, "Novel/Front/Title.md")).toBe(true);
  });
  it("material sections neither count nor export", () => {
    expect(isMaterialPath(m, "Novel/Notes/Idea.md")).toBe(true);
    expect(countsTowardGoal(m, "Novel/Notes/Idea.md")).toBe(false);
    expect(isExported(m, "Novel/Notes/Idea.md")).toBe(false);
  });
  it("a sheet marked as material inside the manuscript is left out too", () => {
    expect(isMaterialPath(m, "Novel/Chapters/Scrap.md")).toBe(true);
    expect(isExported(m, "Novel/Chapters/Scrap.md")).toBe(false);
  });
  it("outside a project, only the sheet's own mark matters", () => {
    expect(isMaterialPath(m, "Loose.md")).toBe(false);
  });
});

describe("goal and deadline", () => {
  const at = (iso: string) => new Date(`${iso}T12:00:00`);
  const project = (goal: number, deadline: string) => ({ template: "", goal, deadline, sections: {} });

  it("percent is capped and zero without a goal", () => {
    expect(progress(project(1000, ""), 250).percent).toBe(25);
    expect(progress(project(1000, ""), 5000).percent).toBe(100);
    expect(progress(project(0, ""), 5000).percent).toBe(0);
  });
  it("paces the words still needed over the days left", () => {
    const p = progress(project(1000, "2026-03-11"), 200, at("2026-03-01"));
    expect(p.daysLeft).toBe(10);
    expect(p.perDay).toBe(80);
    expect(deadlineText(p)).toBe("10 days left · about 80 words a day");
  });
  it("handles today, overdue, no deadline, and a goal already met", () => {
    expect(deadlineText(progress(project(1000, "2026-03-01"), 0, at("2026-03-01")))).toBe("due today · about 1,000 words a day");
    expect(deadlineText(progress(project(1000, "2026-02-27"), 0, at("2026-03-01")))).toBe("2 days overdue");
    expect(deadlineText(progress(project(1000, "2026-02-28"), 0, at("2026-03-01")))).toBe("1 day overdue");
    expect(deadlineText(progress(project(1000, ""), 0))).toBe("");
    expect(deadlineText(progress(project(1000, "2026-03-02"), 1000, at("2026-03-01")))).toBe("1 day left");
    expect(deadlineText(progress(project(0, "2026-03-11"), 5, at("2026-03-01")))).toBe("10 days left");
  });
  it("words the progress", () => {
    expect(goalText(progress(project(80000, ""), 12300))).toBe("12,300 of 80,000 words · 15%");
    expect(goalText(progress(project(0, ""), 1))).toBe("1 word");
  });
});

describe("reading order", () => {
  it("loose sheets first, then sections in their arranged order, sheets in theirs", () => {
    const m = novel();
    m.groups.Novel = ["Novel/Chapters", "Novel/Front"];
    m.order["Novel/Chapters"] = ["Novel/Chapters/b.md", "Novel/Chapters/a.md"];
    const tree = { path: "Novel", children: [{ path: "Novel/Front", children: [] }, { path: "Novel/Chapters", children: [] }, { path: "Novel/Notes", children: [] }] };
    const all = ["Novel/Chapters/a.md", "Novel/Front/t.md", "Novel/Loose.md", "Novel/Chapters/b.md", "Novel/Notes/n.md", "Elsewhere/z.md"].map((path) => ({ path }));
    expect(projectSheets(m, tree, all).map((s) => s.path)).toEqual(["Novel/Loose.md", "Novel/Chapters/b.md", "Novel/Chapters/a.md", "Novel/Front/t.md", "Novel/Notes/n.md"]);
  });
});

describe("reading order of sheets nobody has arranged", () => {
  const sheets = (...p: string[]) => p.map((path) => ({ path }));
  it("inside a project they read in natural name order, not newest first", () => {
    const m = novel();
    expect(orderedSheets(m, "Novel/Chapters", sheets("Novel/Chapters/Chapter 10.md", "Novel/Chapters/Chapter 2.md", "Novel/Chapters/Chapter 1.md")).map((s) => s.path)).toEqual([
      "Novel/Chapters/Chapter 1.md",
      "Novel/Chapters/Chapter 2.md",
      "Novel/Chapters/Chapter 10.md",
    ]);
  });
  it("outside a project they stay as given (newest first)", () => {
    expect(orderedSheets(novel(), "Blog", sheets("Blog/z.md", "Blog/a.md")).map((s) => s.path)).toEqual(["Blog/z.md", "Blog/a.md"]);
  });
  it("a saved order still wins inside a project", () => {
    const m = novel();
    m.order["Novel/Chapters"] = ["Novel/Chapters/b.md", "Novel/Chapters/a.md"];
    expect(orderedSheets(m, "Novel/Chapters", sheets("Novel/Chapters/a.md", "Novel/Chapters/b.md", "Novel/Chapters/c.md")).map((s) => s.path)).toEqual(["Novel/Chapters/b.md", "Novel/Chapters/a.md", "Novel/Chapters/c.md"]);
  });
});

describe("templates", () => {
  it("have unique ids, names and section names, and every sheet starts with a heading", () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    for (const t of TEMPLATES) {
      expect(new Set(t.sections.map((s) => s.name)).size).toBe(t.sections.length);
      for (const s of t.sections) for (const sheet of s.sheets) expect(sheet.startsWith("# ")).toBe(true);
    }
  });
  it("the novel keeps notes and characters out of the count and the export", () => {
    const novelT = TEMPLATES.find((t) => t.id === "novel")!;
    const roles = Object.fromEntries(novelT.sections.map((s) => [s.name, s.role]));
    expect(roles).toEqual({ "Front Matter": "matter", Chapters: "manuscript", "Back Matter": "matter", Notes: "material", Characters: "material" });
  });
});

describe("projects in the structure file", () => {
  it("round-trips and drops malformed data", () => {
    const m = parseMeta(JSON.stringify(novel()));
    expect(m.projects.Novel.sections["Novel/Notes"]).toBe("material");
    const bad = parseMeta('{"projects":{"A":{"goal":-5,"deadline":"tomorrow","sections":{"A/x":"bogus","A/y":"matter"}},"B":7}}');
    expect(bad.projects).toEqual({ A: { template: "", goal: 0, deadline: "", sections: { "A/y": "matter" } } });
  });
  it("follows a renamed project, its sections, and a renamed section", () => {
    const m = novel();
    remapMeta(m, (p) => (p === "Novel" || p.startsWith("Novel/") ? "Book" + p.slice(5) : p));
    expect(Object.keys(m.projects)).toEqual(["Book"]);
    expect(m.projects.Book.sections["Book/Notes"]).toBe("material");
    remapMeta(m, (p) => (p === "Book/Notes" ? "Book/Research" : p));
    expect(m.projects.Book.sections["Book/Research"]).toBe("material");
    expect(m.projects.Book.sections["Book/Notes"]).toBeUndefined();
  });
  it("forgets deleted projects and sections; a section moved out stops being one", () => {
    const m = novel();
    dropFromMeta(m, (p) => p === "Novel/Notes");
    expect(m.projects.Novel.sections["Novel/Notes"]).toBeUndefined();
    remapMeta(m, (p) => (p === "Novel/Front" ? "Elsewhere/Front" : p));
    expect(m.projects.Novel.sections).toEqual({ "Novel/Chapters": "manuscript" });
    dropFromMeta(m, (p) => p === "Novel" || p.startsWith("Novel/"));
    expect(m.projects).toEqual({});
  });
  it("a project can't sit inside another project", () => {
    const m = novel();
    m.projects["Novel/Chapters"] = { template: "", goal: 0, deadline: "", sections: {} };
    remapMeta(m, (p) => p);
    expect(Object.keys(m.projects)).toEqual(["Novel"]);
  });
  it("merges project edits from two devices by project", () => {
    const base = novel();
    const mine = JSON.parse(JSON.stringify(base)) as Meta;
    mine.projects.Novel.goal = 2000;
    const theirs = JSON.parse(JSON.stringify(base)) as Meta;
    theirs.projects.Essay = { template: "essay", goal: 500, deadline: "", sections: {} };
    const out = mergeMeta(base, mine, theirs);
    expect(out.projects.Novel.goal).toBe(2000);
    expect(out.projects.Essay.goal).toBe(500);
    const gone = JSON.parse(JSON.stringify(base)) as Meta;
    gone.projects = {};
    expect(mergeMeta(base, JSON.parse(JSON.stringify(base)), gone).projects).toEqual({});
  });
});
