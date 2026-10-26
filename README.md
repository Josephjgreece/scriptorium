# Scriptorium

A calm, three-pane Markdown writing app for Windows (and macOS/Linux): **library → sheet list → editor**.

Your library is a plain folder of `.md` files. Groups are folders, sheets are files, so your writing never depends on this app. The only extra is `.scriptorium.json` in the library folder (sheet order, material marks, glue, filters); delete it and your writing is untouched.
Default location: `Documents/Scriptorium`. Change it from the sidebar, or fix it with the `SCRIPTORIUM_LIBRARY` environment variable (which takes priority).

## What's in this first version

- Three panes with draggable dividers; light, dark or follow-the-system theme
- Groups (nested), sheet list with title, preview, word count and date; "All sheets" view
- Markdown editor (CodeMirror 6): headings sized as prose, marks dimmed, centred column, spellcheck, find (Ctrl+F)
- Typewriter mode (cursor stays centred), focus mode (hides the side panes)
- Autosave; a new sheet is named after its first line
- Search across the whole library
- Drag a sheet onto a group to move it; right-click for rename / delete / export
- **Manual order**: drag sheets up and down inside a group; new sheets go to the end
- **Material sheets** (right-click → Mark as material): research and notes, tinted, with a torn-page icon, left out of group word counts and group exports
- **Glued sheets**: select neighbouring sheets (Ctrl/Cmd or Shift-click), right-click → Glue. They edit as one continuous text but stay separate files; Unglue any time
- **Filters** (smart folders): saved searches by text, group and recency, listed in the sidebar; search the library and press "Save as filter"
- Right-click a group → Export group… joins its sheets in your order, skipping material
- **Sync-safe**: put the library in any synced folder (Dropbox, iCloud Drive, Proton Drive, ...). Changes made elsewhere appear within seconds, the structure file is merged between devices, and conflicted copies are flagged under Conflicts. Text you typed is never allowed to overwrite a version changed elsewhere: it is kept as a conflicted copy
- Choose the library folder from the button at the bottom of the sidebar
- Delete moves things to the **Trash** (a `.trash` folder inside the library). Browse it from the sidebar, preview read-only, restore to the original group, delete permanently or empty it; nothing is removed for good without asking
- Export to DOCX / PDF / HTML / ODT / EPUB through [Pandoc](https://pandoc.org) (install it separately; PDF also needs a LaTeX engine)

| Shortcut (Ctrl, or Cmd on Mac) | Action |
| --- | --- |
| N | New sheet |
| Shift+N | New group |
| K | Search the library |
| Shift+T | Typewriter mode |
| Shift+F | Focus mode |
| Shift+D | Cycle theme |
| Shift+E | Export current sheet |

## Run it

Prerequisites: [Node.js 20+](https://nodejs.org), [Rust](https://rustup.rs), and on Windows the Visual Studio C++ Build Tools (WebView2 is already part of Windows 10/11). See the [Tauri prerequisites](https://tauri.app/start/prerequisites/) if anything is missing.

```bash
npm install
npm run tauri dev      # run the desktop app
npm run tauri build    # make an installer (src-tauri/target/release/bundle)
```

Checks: `npm test` (unit), `cd src-tauri && cargo test --lib` (Rust), `npm run test:e2e` (browser; needs Playwright with Chromium available to Node).

`npm run dev` on its own runs the UI in a browser against a throwaway localStorage library, which is handy for working on the interface.

## Layout

```
src/main.ts           the UI: panes, menus, saving, shortcuts
src/editor.ts         CodeMirror setup and the prose styling
src/meta.ts           order / material / glue / filter model
src/api.ts            bridge to Rust (plus the browser stand-in)
src-tauri/src/library.rs   all file handling (unit-tested, no Tauri dependency)
src-tauri/src/lib.rs       thin Tauri command wrappers
```

## Not built yet

Keywords/filters, per-sheet notes and goals, image attachments, footnotes and citations, version history. The folder-of-Markdown design means sync (OneDrive, Dropbox, Git) already works by pointing `SCRIPTORIUM_LIBRARY` at a synced folder.
