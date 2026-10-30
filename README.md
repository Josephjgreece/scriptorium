# Scriptorium

A calm, three-pane Markdown writing app for Windows (and macOS/Linux): **library → sheet list → editor**.

Your library is a plain folder of `.md` files. Groups are folders, sheets are files, so your writing never depends on this app. The only extra is `.scriptorium.json` in the library folder (sheet order, material marks, glue, filters); delete it and your writing is untouched.
Default location: `Documents/Scriptorium`. Change it from the sidebar, or fix it with the `SCRIPTORIUM_LIBRARY` environment variable (which takes priority).

## What's in this first version

- A toolbar across the top and three panes with draggable dividers (the sidebar can be hidden); light, dark or follow-the-system theme
- Groups (nested, drag to reorder, pick an icon and colour), sheet list with title, preview, word count and date; "All sheets" view
- Markdown editor (CodeMirror 6): headings sized as prose, marks tinted, centred column, spellcheck, find and replace, curly quotes and dashes as you type, comments, footnotes, a heading navigator and a statistics panel; five themes and adjustable font, size, spacing and width
- Typewriter mode (cursor stays centred), focus mode (hides the side panes)
- Autosave; a new sheet is named after its first line
- Search across the whole library
- Drag a sheet onto a group to move it; right-click for rename / delete / export
- **Manual order**: drag sheets up and down inside a group; new sheets go to the end
- **Material sheets** (right-click → Mark as material): research and notes, tinted, with a torn-page icon, left out of group word counts and group exports
- **Glued sheets**: select neighbouring sheets (Ctrl/Cmd or Shift-click), right-click → Glue. They edit as one continuous text but stay separate files; Unglue any time
- **Filters** (smart folders): saved searches by text, group and recency, listed in the sidebar; search the library and press "Save as filter"
- **Projects**: a novel or article with its own goal and sections. Start one from a template (Novel, Short story collection, Article or essay) or right-click a group → Make this a project. Sections are Manuscript, Front/back matter or Material; only the manuscript counts toward the word goal, and Export project leaves material out. Set a deadline and it shows the words a day you still need
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
| O | Quick open: find a sheet in any group |
| \ | Show or hide the sidebar |
| Shift+O | Navigator: jump between headings |
| , | Appearance: theme, font, size, spacing, width |
| H | Find and replace (also F) |
| Shift+M | Add a comment (`<!-- … -->`), kept out of counts and exports |
| Shift+Y | Insert a footnote |
| F2 | Rename the current sheet's file |

In the lists: arrows move (Left/Right fold groups in the sidebar), Shift+arrows select a run of sheets, Enter goes to the text, Esc comes back, Delete sends to the Trash.

## Run it

Prerequisites: [Node.js 20+](https://nodejs.org), [Rust](https://rustup.rs), and on Windows the Visual Studio C++ Build Tools (WebView2 is already part of Windows 10/11). See the [Tauri prerequisites](https://tauri.app/start/prerequisites/) if anything is missing.

```bash
npm install
npm run tauri dev      # run the desktop app
npm run tauri build    # make an installer (src-tauri/target/release/bundle)
```

Checks: `npm test` (unit), `cd src-tauri && cargo test --lib` (Rust), `npm run test:e2e` (browser; needs Playwright with Chromium available to Node).

`npm run dev` on its own runs the UI in a browser against a throwaway localStorage library, which is handy for working on the interface.

## Android (reading only)

The Android app is a reader: it shows your sheets, projects, navigator, search and statistics, and lets you change the appearance, but it never writes anything. Your library stays plain Markdown in a folder, so the phone reads the same folder your computer writes.

**Get the app.** In GitHub, Actions, "Android app", run the workflow and download `Scriptorium-android-arm64.apk` from the run. Copy it to the phone and open it (Android will ask to allow installing from that source). Phones from the last several years are arm64. To keep updates installing over each other, give the workflow a signing key once: create a keystore with `keytool`, then add these repository secrets: `ANDROID_KEYSTORE_BASE64` (the file, base64-encoded), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Without them each build uses a throwaway key, and a newer APK must be installed after removing the old one.

**Let it see your library.** Android hides most folders from apps. The first time, Scriptorium shows a screen that says so. Allow it under Settings, Apps, Scriptorium, Permissions, Files and media, "Allow management of all files" (also under Special app access, All files access), then tap Check again. It looks in `Documents/Scriptorium` on the phone's shared storage; "Use a different folder…" lets you type another path.

**Get your sheets there.** Keep your library folder in `Documents/Scriptorium` on the phone with a folder-sync app (Syncthing is one that syncs a plain folder; copying the folder over USB also works). The app notices changes within a few seconds. Cloud drive apps that don't expose a plain folder won't do.

**What is not on the phone:** editing, export (it needs Pandoc), the Trash and conflicts views, and everything else that changes files.

**Build it yourself.** Install Android Studio (SDK and NDK), set `ANDROID_HOME` and `NDK_HOME`, run `rustup target add aarch64-linux-android`, then `npm install` and `npm run tauri android build -- --apk --target aarch64`. To sign it, put `storeFile`, `storePassword`, `keyAlias` and `keyPassword` in `src-tauri/gen/android/app/keystore.properties` (git ignores that file). The Android project is in `src-tauri/gen/android`.

On a computer, `SCRIPTORIUM_READONLY=1` starts the desktop app in the same read-only mode, and adding `?readonly` to the address of `npm run dev` shows it in a browser (add `?denied` to see the "can't see your files" screen). Narrow the window under about 820 px to see the one-pane phone layout.

## Layout

```
src/main.ts           the UI: panes, menus, saving, shortcuts
src/editor.ts         CodeMirror setup and the prose styling
src/meta.ts           order / material / glue / filter / project model
src/projects.ts       project logic: sections, goal, deadline, templates
src/projectsUi.ts     the new-project and project-settings dialogs
src/ui.ts             shared UI helpers (modals, menus, icons)
src/api.ts            bridge to Rust (plus the browser stand-in)
src-tauri/src/library.rs   all file handling (unit-tested, no Tauri dependency)
src-tauri/src/lib.rs       thin Tauri command wrappers
```

## Not built yet

Keywords/filters, per-sheet notes and goals, image attachments, footnotes and citations, version history. The folder-of-Markdown design means sync (OneDrive, Dropbox, Git) already works by pointing `SCRIPTORIUM_LIBRARY` at a synced folder.
