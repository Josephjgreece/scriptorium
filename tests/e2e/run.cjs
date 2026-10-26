// End-to-end checks against the browser build (a localStorage-backed stand-in for the disk).
// Needs Playwright (with a Chromium) available to Node, e.g. `npm i -g playwright && npx playwright install chromium`,
// then `npm run test:e2e`. It starts its own dev server (E2E_PORT, default 5199).
const { spawn } = require("node:child_process");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const PORT = process.env.E2E_PORT || "5199";
const URL = `http://localhost:${PORT}`;
const T = 1500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const test = async (name, fn) => {
  try {
    await fn();
    results.push([name, true]);
    console.log(`  ok   ${name}`);
  } catch (e) {
    results.push([name, false]);
    console.log(`  FAIL ${name}\n       ${String(e.message).split("\n").join("\n       ")}`);
  }
};

async function waitFor(fn, what, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(150);
  }
}

function startVite() {
  const proc = spawn("npx", ["vite", "--port", PORT, "--strictPort"], { stdio: ["ignore", "pipe", "pipe"], detached: true });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("vite did not start")), 30000);
    proc.stdout.on("data", (d) => {
      if (String(d).includes("Local")) {
        clearTimeout(t);
        resolve(proc);
      }
    });
    proc.on("exit", (c) => reject(new Error(`vite exited (${c})`)));
  });
}

// Each scenario gets a fresh browser page and a "library on disk" it can also change from behind the app's back.
async function freshPage(browser, files, dirs = [], meta = null) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 960 } });
  page.on("pageerror", (e) => console.log("       PAGEERROR", e.message));
  const now = Date.now();
  const seeded = Object.fromEntries(Object.entries(files).map(([k, [content, ageSecs]]) => [k, { content, modified: now - ageSecs * 1000 }]));
  await page.addInitScript(
    ([f, d, m]) => {
      if (localStorage.getItem("seeded")) return;
      localStorage.setItem("seeded", "1");
      localStorage.setItem("scriptorium-web-library", JSON.stringify({ files: f, dirs: d }));
      if (m) localStorage.setItem("scriptorium-web-meta", JSON.stringify(m));
    },
    [seeded, dirs, meta],
  );
  await page.goto(URL);
  await page.waitForSelector(".row");
  await sleep(250); // let the first sheet open
  const disk = {
    files: () => page.evaluate(() => JSON.parse(localStorage.getItem("scriptorium-web-library")).files),
    meta: () => page.evaluate(() => JSON.parse(localStorage.getItem("scriptorium-web-meta") || "{}")),
    // what another program or device does to the folder
    outside: (fn, arg) =>
      page.evaluate(
        ([src, a]) => {
          const lib = JSON.parse(localStorage.getItem("scriptorium-web-library"));
          const res = new Function("lib", "arg", src)(lib, a);
          localStorage.setItem("scriptorium-web-library", JSON.stringify(lib));
          return res;
        },
        [`return (${fn.toString()})(lib, arg)`, arg],
      ),
    outsideMeta: (obj) => page.evaluate((m) => localStorage.setItem("scriptorium-web-meta", JSON.stringify(m)), obj),
  };
  return { page, disk };
}

const titles = (page) => page.$$eval(".sheet-item .si-title", (els) => els.map((e) => e.textContent));
const row = (page, text) => page.locator(".sheet-item", { hasText: text }).first();

(async () => {
  const vite = await startVite();
  const browser = await chromium.launch();
  try {
    console.log("Structure");
    await test("glue, split-saving, protected dividers, material, reorder, filters, reload", async () => {
      const files = {
        "Chapter One.md": ["# Chapter One\n\nOnce upon a draft.", 40],
        "Chapter Two.md": ["# Chapter Two\n\nThe middle.", 30],
        "Chapter Three.md": ["# Chapter Three\n\nThe end.", 20],
        "Research.md": ["# Research\n\nNotes about herons.", 10],
        "Book/Prologue.md": ["# Prologue\n\nIn the beginning.", 90 * 86400],
      };
      const { page, disk } = await freshPage(browser, files, ["Book"]);
      assert.deepEqual(await titles(page), ["Research", "Chapter Three", "Chapter Two", "Chapter One"]);

      await row(page, "Chapter Two").click();
      await row(page, "Chapter Three").click({ modifiers: ["Shift"] });
      await row(page, "Chapter Three").click({ button: "right" });
      await page.click('.menu-item:has-text("Glue 2 sheets")');
      await waitFor(() => page.$(".glue-join"), "join divider");
      assert.deepEqual(await titles(page), ["Research", "Chapter Three", "Chapter One"]);

      await page.click(".cm-content");
      await page.keyboard.press("Control+End");
      await page.keyboard.type(" EDITED-END");
      await page.keyboard.press("Control+Home");
      await page.keyboard.type("X");
      await waitFor(async () => (await disk.files())["Chapter Two.md"].content.endsWith("EDITED-END"), "split save");
      const f = await disk.files();
      assert.ok(f["Chapter Three.md"].content.startsWith("X"));
      assert.ok(!f["Chapter Two.md"].content.includes("scriptorium") && !f["Chapter Three.md"].content.includes("scriptorium"));

      await page.keyboard.press("Control+a");
      await page.keyboard.press("Delete");
      await sleep(T);
      const g = await disk.files();
      assert.equal(g["Chapter Two.md"].content, "");
      assert.equal(g["Chapter Three.md"].content, "", "divider survived select-all + delete, so both sheets still exist");
      await page.keyboard.press("Control+z");
      await sleep(T);

      await row(page, "Research").click({ button: "right" });
      await page.click('.menu-item:has-text("Mark as material")');
      await row(page, "Research").click();
      await waitFor(() => page.$("body.is-material"), "material editor tint");

      await row(page, "Chapter One").dragTo(row(page, "Research"), { targetPosition: { x: 50, y: 4 } });
      await waitFor(async () => (await titles(page))[0] === "Chapter One", "reorder");

      await page.click('button[title="New filter"]');
      await page.fill('.modal input[placeholder^="Sheet contains"]', "draft");
      await page.click(".modal .btn.primary");
      await waitFor(async () => (await titles(page)).join() === "Chapter One", "filter results");

      await page.reload();
      await page.waitForSelector(".sheet-item");
      await page.click('.row:has-text("Inbox")');
      assert.equal(await page.$$eval(".sheet-item.glued", (e) => e.length), 1);
      assert.equal(await page.$$eval(".sheet-item.material", (e) => e.length), 1);

      await page.locator(".sheet-item.glued").first().dragTo(page.locator('.row:has-text("Book")'));
      await page.click('.row:has-text("Book")');
      await waitFor(async () => (await page.$$eval(".sheet-item.glued", (e) => e.length)) === 1, "glued unit moved intact");
      await page.locator('.row:has-text("Book")').click({ button: "right" });
      await page.click('.menu-item:has-text("Rename")');
      await page.fill(".modal input", "Novel");
      await page.click(".modal .btn.primary");
      await waitFor(async () => JSON.stringify((await disk.meta()).glue).includes("Novel/Chapter Two.md"), "glue follows rename");
      await page.close();
    });

    console.log("Outside changes");
    await test("an edit made outside the app shows up in the open sheet", async () => {
      const { page, disk } = await freshPage(browser, { "Note.md": ["# Note\n\nfirst version", 5] });
      await row(page, "Note").click();
      await page.waitForSelector(".cm-content");
      await disk.outside((lib) => (lib.files["Note.md"] = { content: "# Note\n\nchanged by another device", modified: Date.now() }));
      await waitFor(async () => (await page.$eval(".cm-content", (e) => e.innerText)).includes("another device"), "reloaded text", 9000);
      assert.equal(await page.textContent("#stSave"), "", "no phantom save");
      await page.close();
    });

    await test("unsaved typing never overwrites an outside edit: it becomes a conflicted copy", async () => {
      const { page, disk } = await freshPage(browser, { "Note.md": ["# Note\n\nfirst version", 5] });
      await row(page, "Note").click();
      await page.click(".cm-content");
      await page.keyboard.press("Control+End");
      await page.keyboard.type(" MY-WORDS");
      await disk.outside((lib) => (lib.files["Note.md"] = { content: "# Note\n\nTHEIR VERSION", modified: Date.now() }));
      await waitFor(async () => Object.keys(await disk.files()).some((k) => k.includes("conflicted copy")), "conflicted copy");
      const f = await disk.files();
      assert.equal(f["Note.md"].content, "# Note\n\nTHEIR VERSION", "their version stays as the sheet");
      const copy = Object.entries(f).find(([k]) => k.includes("conflicted copy"))[1];
      assert.ok(copy.content.includes("MY-WORDS"), "my words are kept");
      await waitFor(async () => (await page.$eval(".cm-content", (e) => e.innerText)).includes("THEIR VERSION"), "editor shows theirs");
      await page.close();
    });

    console.log("Conflicts");
    await test("conflicted copies are flagged, listed, and can be kept or discarded", async () => {
      const { page, disk } = await freshPage(browser, { "Chapter.md": ["# Chapter\n\nmine", 50] });
      assert.equal(await page.$(".row.warn"), null, "no Conflicts row without conflicts");
      await disk.outside((lib) => {
        lib.files["Chapter (Joe's conflicted copy 2026-01-01).md"] = { content: "# Chapter\n\ntheirs", modified: Date.now() };
        lib.files["Other (conflicted copy).md"] = { content: "# Other\n\nlonely copy", modified: Date.now() };
      });
      await waitFor(() => page.$(".row.warn"), "Conflicts row", 9000);
      assert.equal(await page.textContent(".row.warn .count"), "2");
      await page.click(".row.warn");
      await waitFor(async () => (await titles(page)).length === 2, "conflicts listed");
      assert.equal(await page.$$eval(".sheet-item.conflict", (e) => e.length), 2);
      const joe = page.locator(".sheet-item", { hasText: "theirs" });
      await joe.click({ button: "right" });
      assert.ok((await page.$$eval(".menu-item", (e) => e.map((x) => x.textContent))).includes("Keep this version (replaces the original)"));
      await page.click('.menu-item:has-text("Keep this version")');
      await waitFor(async () => (await disk.files())["Chapter.md"]?.content.includes("theirs"), "copy replaced original");
      assert.equal(Object.keys(await disk.files()).filter((k) => k.includes("Joe")).length, 0);
      assert.equal(await page.textContent(".row.warn .count"), "1");
      await page.close();
    });

    console.log("Trash");
    await test("deleted sheets go to the Trash, preview read-only, and restore to where they were", async () => {
      const files = { "Book/Chapter.md": ["# Chapter\n\nImportant words.", 30], "Note.md": ["# Note\n\nhi", 20] };
      const { page, disk } = await freshPage(browser, files, ["Book"]);
      assert.equal(await page.textContent('.row:has-text("Trash")'), "Trash");
      await page.click('.row:has-text("Book")');
      await row(page, "Chapter").click({ button: "right" });
      await page.click('.menu-item:has-text("Delete sheet")');
      await waitFor(async () => (await titles(page)).length === 0, "sheet leaves the group");
      assert.equal(await page.textContent('.row:has-text("Trash") .count'), "1");
      assert.ok(!("Book/Chapter.md" in (await disk.files())), "gone from the library");

      await page.click('.row:has-text("Trash")');
      await waitFor(async () => (await titles(page)).join() === "Chapter", "trash lists it");
      assert.ok((await page.textContent(".sheet-item.trash .si-meta")).includes("from Book"));
      await row(page, "Chapter").click();
      await waitFor(() => page.$("body.previewing-trash"), "trash bar");
      assert.ok((await page.$eval(".cm-content", (e) => e.innerText)).includes("Important words."));
      await page.click(".cm-content");
      await page.keyboard.type("SHOULD NOT APPEAR");
      await sleep(1000);
      assert.ok(!(await page.$eval(".cm-content", (e) => e.innerText)).includes("SHOULD NOT APPEAR"), "read-only");
      assert.equal(Object.keys(await disk.files()).length, 1, "preview wrote nothing");

      await page.click("#btnTrashRestore");
      await waitFor(async () => "Book/Chapter.md" in (await disk.files()), "restored on disk");
      await waitFor(async () => (await titles(page)).join() === "Chapter", "shown in its group again");
      assert.equal(await page.$("body.previewing-trash"), null);
      assert.ok((await page.$eval(".cm-content", (e) => e.innerText)).includes("Important words."), "opened for editing");
      assert.equal(await page.$('.row:has-text("Trash") .count'), null, "trash count cleared");
      await page.close();
    });

    await test("a deleted group comes back whole; permanent delete and Empty Trash ask first", async () => {
      const files = { "Book/One.md": ["# One\n\na", 30], "Book/Two.md": ["# Two\n\nb", 20], "Keep.md": ["# Keep", 10], "X.md": ["# X", 9], "Y.md": ["# Y", 8] };
      const { page, disk } = await freshPage(browser, files, ["Book"]);
      await page.locator('.row:has-text("Book")').click({ button: "right" });
      await page.click('.menu-item:has-text("Delete group")');
      await page.click(".modal .btn.primary");
      await waitFor(async () => !("Book/One.md" in (await disk.files())), "group removed");
      await page.click('.row:has-text("Trash")');
      await waitFor(async () => (await titles(page)).join() === "Book", "group in trash");
      assert.ok((await page.textContent(".sheet-item.trash .si-prev")).includes("2 sheets"));
      await row(page, "Book").click({ button: "right" });
      await page.click('.menu-item:has-text("Restore")');
      await waitFor(async () => "Book/One.md" in (await disk.files()) && "Book/Two.md" in (await disk.files()), "group restored with its sheets");
      assert.deepEqual((await titles(page)).sort(), ["One", "Two"]);

      // permanent delete: cancel keeps it, confirm removes it
      for (const f of ["X", "Y"]) {
        await page.click('.row:has-text("Inbox")');
        await row(page, f).click({ button: "right" });
        await page.click('.menu-item:has-text("Delete sheet")');
      }
      await page.click('.row:has-text("Trash")');
      await waitFor(async () => (await titles(page)).length === 2, "two in trash");
      await row(page, "X").click({ button: "right" });
      await page.click('.menu-item:has-text("Delete permanently")');
      await page.click(".modal .btn:not(.primary)");
      assert.equal((await titles(page)).length, 2, "cancel keeps it");
      await row(page, "X").click({ button: "right" });
      await page.click('.menu-item:has-text("Delete permanently")');
      await page.click(".modal .btn.primary");
      await waitFor(async () => (await titles(page)).join() === "Y", "X gone for good");

      await page.click(".lt-btn.danger");
      await page.click(".modal .btn.primary");
      await waitFor(async () => (await titles(page)).length === 0, "trash emptied");
      assert.ok((await page.textContent(".sheets")).includes("The Trash is empty."));
      assert.ok("Keep.md" in (await disk.files()), "the library is untouched");
      await page.close();
    });

    console.log("Toolbar and keyboard");
    await test("the sidebar can be hidden from the toolbar or Ctrl+\\, and stays hidden after a reload", async () => {
      const { page } = await freshPage(browser, { "A.md": ["# A", 5] });
      const libWidth = () => page.$eval("#libPane", (e) => e.getBoundingClientRect().width);
      assert.ok((await libWidth()) > 100);
      await page.click("#btnSidebar");
      await waitFor(() => page.$("body.no-lib"), "sidebar hidden");
      assert.equal(await libWidth(), 0);
      assert.ok(await page.isVisible("#btnSidebar2"), "a button to bring it back is in the toolbar");
      await page.reload();
      await page.waitForSelector(".sheet-item");
      assert.ok(await page.$("body.no-lib"), "remembered");
      await page.click("#btnSidebar2");
      assert.ok((await libWidth()) > 100);
      await page.keyboard.press("Control+Backslash");
      assert.ok(await page.$("body.no-lib"));
      await page.keyboard.press("Control+Backslash");
      assert.equal(await page.$("body.no-lib"), null);
      await page.close();
    });

    await test("arrow keys move through the list, Enter goes to the text, Escape comes back", async () => {
      const files = { "One.md": ["# One\n\nfirst", 30], "Two.md": ["# Two\n\nsecond", 20], "Three.md": ["# Three\n\nthird", 10] };
      const { page } = await freshPage(browser, files);
      const text = () => page.$eval(".cm-content", (e) => e.innerText);
      const inList = () => page.evaluate(() => document.activeElement && document.activeElement.id === "sheets");
      await page.focus("#sheets");
      assert.deepEqual(await titles(page), ["Three", "Two", "One"]);
      await waitFor(async () => (await text()).includes("third"), "starts on the newest sheet");
      await page.keyboard.press("ArrowDown");
      await waitFor(async () => (await text()).includes("second"), "next sheet opens");
      assert.ok(await inList(), "focus stays in the list");
      await page.keyboard.press("ArrowDown");
      await waitFor(async () => (await text()).includes("first"), "and the next");
      await page.keyboard.press("ArrowDown");
      assert.ok((await text()).includes("first"), "stops at the end");
      await page.keyboard.press("ArrowUp");
      await waitFor(async () => (await text()).includes("second"), "back up");
      await page.keyboard.press("Enter");
      await waitFor(async () => !(await inList()) && (await page.evaluate(() => !!document.activeElement.closest(".cm-editor"))), "Enter focuses the text");
      await page.keyboard.press("Escape");
      await waitFor(inList, "Escape returns to the list");
      // Shift+arrows select a run, which can then be glued
      await page.keyboard.press("Home");
      await page.keyboard.press("Shift+ArrowDown");
      assert.equal(await page.$$eval(".sheet-item.selected", (e) => e.length), 2);
      await page.close();
    });

    await test("the sidebar is keyboard-navigable too", async () => {
      const { page } = await freshPage(browser, { "Book/A.md": ["# A", 5], "Notes.md": ["# Notes", 10] }, ["Book"]);
      await page.focus("#tree");
      await page.click('.row:has-text("All")');
      await page.focus("#tree");
      await page.keyboard.press("ArrowDown");
      await waitFor(async () => (await page.textContent(".list-title .lt-name")) === "Last 7 Days", "moves down a row");
      await page.keyboard.press("ArrowDown");
      await waitFor(async () => (await page.textContent(".list-title .lt-name")) === "Trash", "and another");
      await page.keyboard.press("End");
      await waitFor(async () => (await page.textContent(".list-title .lt-name")) === "Book", "End goes to the last row");
      await page.keyboard.press("Enter");
      assert.ok(await page.evaluate(() => document.activeElement.id === "sheets"), "Enter moves to the list");
      await page.close();
    });

    await test("quick open finds a sheet in any group and opens it there", async () => {
      const files = { "Book/Chapter Two.md": ["# Chapter Two\n\nburied words", 30], "Notes.md": ["# Notes\n\nother", 10] };
      const { page } = await freshPage(browser, files, ["Book"]);
      await page.keyboard.press("Control+o");
      await page.waitForSelector(".qo input");
      assert.equal((await page.$$(".qo-item")).length, 2, "recent sheets are offered first");
      await page.keyboard.type("chap");
      await waitFor(async () => (await page.$$(".qo-item")).length === 1, "filters as you type");
      await page.keyboard.press("Enter");
      await waitFor(async () => (await page.$eval(".cm-content", (e) => e.innerText)).includes("buried words"), "opened");
      assert.equal(await page.textContent(".list-title .lt-name"), "Book", "and the list moved to its group");
      assert.equal(await page.$(".modal-ov"), null);
      await page.keyboard.press("Control+o");
      await page.keyboard.type("zzzz");
      assert.ok((await page.textContent(".qo-list")).includes("No sheet found"));
      await page.keyboard.press("Escape");
      assert.equal(await page.$(".modal-ov"), null);
      await page.close();
    });

    console.log("Library parity");
    await test("rename a file; a new sheet goes after the one you're on", async () => {
      const files = { "A.md": ["# A\n\nx", 30], "B.md": ["# B\n\nx", 20], "C.md": ["# C\n\nx", 10] };
      const { page, disk } = await freshPage(browser, files, [], { order: { "": ["A.md", "B.md", "C.md"] }, material: [], glue: [], filters: [] });
      assert.deepEqual(await titles(page), ["A", "B", "C"]);
      await row(page, "B").click();
      await page.keyboard.press("Control+n");
      await waitFor(async () => (await titles(page)).length === 4, "new sheet");
      assert.deepEqual(await titles(page), ["A", "B", "Untitled", "C"]);

      await row(page, "A").click({ button: "right" });
      await page.click('.menu-item:has-text("Rename file")');
      await page.fill(".modal input", "Opening");
      await page.click(".modal .btn.primary");
      await waitFor(async () => "Opening.md" in (await disk.files()) && !("A.md" in (await disk.files())), "renamed on disk");
      await waitFor(async () => (await page.$$eval(".sheet-item", (e) => e.length)) === 4, "list refreshed");
      assert.ok((await disk.meta()).order[""].includes("Opening.md"), "its place in the order followed");
      await page.close();
    });

    await test("groups: drag to reorder, drag inside another, pick an icon and colour", async () => {
      const { page, disk } = await freshPage(browser, { "Alpha/a.md": ["# a", 5], "Beta/b.md": ["# b", 6], "Gamma/c.md": ["# c", 7] }, ["Alpha", "Beta", "Gamma"]);
      const names = () => page.$$eval('.row[data-nav="group"] .name', (els) => els.map((e) => e.textContent));
      assert.deepEqual(await names(), ["Inbox", "Alpha", "Beta", "Gamma"]);
      const grow = (n) => page.locator(`.row[data-nav="group"]:has-text("${n}")`);

      await grow("Gamma").dragTo(grow("Alpha"), { targetPosition: { x: 60, y: 2 } });
      await waitFor(async () => (await names()).join() === "Inbox,Gamma,Alpha,Beta", "Gamma dropped above Alpha");
      assert.deepEqual((await disk.meta()).groups[""], ["Gamma", "Alpha", "Beta"]);

      await grow("Beta").dragTo(grow("Alpha"), { targetPosition: { x: 60, y: 15 } });
      await waitFor(async () => "Alpha/Beta/b.md" in (await disk.files()), "Beta moved inside Alpha");
      await waitFor(async () => (await names()).join() === "Inbox,Gamma,Alpha,Beta", "shown nested");
      assert.ok(await page.$('.row[data-gpath="Alpha"] .chev svg'), "Alpha now has a fold arrow");

      await grow("Gamma").click({ button: "right" });
      await page.click('.menu-item:has-text("Icon")');
      await page.click('.pick[data-icon="star"]');
      await page.click('.pick[data-color="red"]');
      await page.click(".modal .btn.primary");
      await waitFor(async () => (await disk.meta()).style?.Gamma === "star:red", "style saved");
      const stroke = await page.$eval('.row[data-gpath="Gamma"] > svg', (e) => e.style.stroke);
      assert.ok(stroke.includes("200") || stroke.includes("c8453b"), `icon coloured (${stroke})`);

      await page.reload();
      await page.waitForSelector(".row");
      assert.deepEqual(await names(), ["Inbox", "Gamma", "Alpha", "Beta"], "order survives a reload");
      await page.close();
    });

    console.log("Two devices, one structure file");
    await test("structure changes made on two devices are merged, not overwritten", async () => {
      const files = { "A.md": ["# A\n\ndraft", 40], "Research.md": ["# Research\n\nherons", 30], "Notes.md": ["# Notes\n\nbits", 20] };
      const { page, disk } = await freshPage(browser, files);
      // another device marks Research as material and saves the structure file...
      await disk.outsideMeta({ order: {}, material: ["Research.md"], glue: [], filters: [] });
      // ...before this device (which hasn't noticed yet) adds a filter
      await page.click('button[title="New filter"]');
      await page.fill('.modal input[placeholder^="Sheet contains"]', "draft");
      await page.click(".modal .btn.primary");
      await waitFor(async () => (await disk.meta()).filters?.length === 1, "filter saved");
      const m = await disk.meta();
      assert.deepEqual(m.material, ["Research.md"], "their material mark survived my write");
      await page.click('.row:has-text("Inbox")');
      await waitFor(async () => (await page.$$eval(".sheet-item.material", (e) => e.length)) === 1, "their change visible here");
      // and the other direction: they change while I sit idle
      await disk.outsideMeta({ ...m, material: ["Research.md", "Notes.md"] });
      await waitFor(async () => (await page.$$eval(".sheet-item.material", (e) => e.length)) === 2, "idle device picks up their change", 9000);
      assert.equal((await disk.meta()).filters.length, 1);
      await page.close();
    });
  } finally {
    await browser.close();
    try {
      process.kill(-vite.pid);
    } catch {
      /* already gone */
    }
  }
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
