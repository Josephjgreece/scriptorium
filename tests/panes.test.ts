import { describe, expect, it } from "vitest";
import { isForward, paneFromState, previousPane, setupNotice, stepsTo } from "../src/panes";

describe("phone panes", () => {
  it("back goes one pane to the left, and stops at the library", () => {
    expect(previousPane("ed")).toBe("list");
    expect(previousPane("list")).toBe("lib");
    expect(previousPane("lib")).toBeNull();
  });
  it("only a step to the right is forward", () => {
    expect(isForward("lib", "list")).toBe(true);
    expect(isForward("lib", "ed")).toBe(true);
    expect(isForward("ed", "list")).toBe(false);
    expect(isForward("list", "list")).toBe(false);
  });
  it("a jump forward passes through the panes in between, so Back retraces them", () => {
    expect(stepsTo("lib", "ed")).toEqual(["list", "ed"]);
    expect(stepsTo("lib", "list")).toEqual(["list"]);
    expect(stepsTo("list", "ed")).toEqual(["ed"]);
    expect(stepsTo("ed", "lib")).toEqual([]);
    expect(stepsTo("list", "list")).toEqual([]);
  });
  it("reads a history entry safely", () => {
    expect(paneFromState({ pane: "ed" })).toBe("ed");
    expect(paneFromState({ pane: "nope" })).toBe("lib");
    expect(paneFromState(null)).toBe("lib");
    expect(paneFromState("ed")).toBe("lib");
    expect(paneFromState(undefined)).toBe("lib");
  });
});

describe("what to say when the library can't be shown", () => {
  const base = { path: "/storage/emulated/0/Documents/Scriptorium", readable: true, denied: false, sheets: 3, readOnly: true };
  it("says nothing when there is something to read", () => {
    expect(setupNotice(base)).toBeNull();
  });
  it("explains the permission when access was refused", () => {
    const n = setupNotice({ ...base, readable: false, denied: true, sheets: 0 })!;
    expect(n.title).toContain("allowed");
    expect(n.lines.join(" ")).toContain("Allow management of all files");
    expect(n.lines.join(" ")).toContain(base.path);
  });
  it("says it can't find the folder when it is simply missing", () => {
    expect(setupNotice({ ...base, readable: false, denied: false, sheets: 0 })!.title).toContain("can't find");
  });
  it("tells an empty read-only library to get its sheets there, but leaves an empty writable one alone", () => {
    expect(setupNotice({ ...base, sheets: 0 })!.title).toContain("empty");
    expect(setupNotice({ ...base, sheets: 0, readOnly: false })).toBeNull();
  });
});
