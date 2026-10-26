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
  await page.waitForSelector(".sheet-item");
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
