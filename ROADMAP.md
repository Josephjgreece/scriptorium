# Scriptorium roadmap

Goal: a calm, Ulysses-style writing app on top of a plain folder of Markdown files. Writing never depends on the app.

Effort is rough: **S** under a day, **M** a few days, **L** a week or more.

## Where we are

- Three panes (library, sheet list, editor), light and dark themes, typewriter and focus modes, autosave
- Library: All, Last 7 Days, Inbox, nested groups
- Manual sheet order, material sheets, glued sheets, filters (smart folders)
- Group and glued export through Pandoc, with material left out
- Structure that Markdown can't hold lives in `.scriptorium.json` in the library root

## Phase 0: Trustworthy and sync-safe: done

A writing app can't lose text, and a synced folder makes that harder.

| Item | Status |
|---|---|
| Desktop app built in CI | Windows x64 + ARM64 installers (`windows-build.yml`); Linux and macOS compile, test and run the browser tests (`ci.yml`). macOS and Linux installers come with Phase 6 |
| Tests | 70 unit tests (structure model, merge, projects, text, typing, appearance) (`npm test`), 23 Rust tests, 26 browser end-to-end scenarios (`npm run test:e2e`) |
| Atomic sheet writes | Done: temp file, then rename |
| Save-failure recovery | Done: retries every 5 s, text stashed and recovered as a copy on next start, warning before closing with unsaved text |
| File watcher | Done: reloads the open sheet and the lists when files change outside the app (polling a cheap fingerprint every 2.5 s and on window focus) |
| Choose library folder | Done: button at the bottom of the sidebar; remembered between runs |
| Conflicted copies | Done: Dropbox and Syncthing style copies are flagged, listed under Conflicts, and can be kept or discarded; unsaved typing that would overwrite an outside edit is kept as a conflicted copy instead |
| Safe `.scriptorium.json` under sync | Done: three-way merge on every write and whenever another device changes it |

Known gaps: the save-retry path is covered by reasoning and Rust tests, not an automated end-to-end test; conflicted-copy detection knows Dropbox and Syncthing names only (iCloud, OneDrive and Google Drive use other patterns); the file watcher polls rather than using OS notifications, which is plenty for a writing app but not instant.

## Phase 1: Library parity: done

- **Trash view**: a Trash row in the sidebar; deleted sheets and groups remember where they came from, preview read-only, restore to their original group (recreated if gone), delete permanently or empty, each with a confirmation. Material marks and manual position are not remembered across a delete
- **Top toolbar**: one bar across the window; sidebar toggle (also Ctrl/Cmd+\), new group, search, new sheet, and the writing tools. The sidebar collapses completely and stays that way
- **Keyboard navigation**: arrows in the sidebar (Left/Right fold groups) and in the sheet list (Shift+arrows select a run, Delete sends to the Trash); Enter moves to the text, Escape returns to the list; Ctrl/Cmd+O quick open across all groups; F2 renames a sheet's file. The selection is blue in the pane you are in and grey elsewhere
- **Sidebar polish**: drag groups to reorder them, or onto the middle of another group to nest them; pick an icon and colour per group (ten icons, six colours). Order and looks live in `.scriptorium.json` and merge between devices
- **New sheet** goes after the one you are on

Not done from the original list: the toolbar's right-hand buttons are still the writing tools, not goal, navigator or style (those arrive with Phase 3).

## Phase 2: Projects: done

Ulysses calls this layer **Projects** (introduced in Ulysses 29, extended since, with templates in version 41). A project is a self-contained work, such as a novel, with its own sections and settings.

- **Projects section** in the sidebar. Opening one focuses the sidebar on just that project (with a way back to the Library): its progress, "Whole project", and its sections. A project is a group flagged in `.scriptorium.json`; its sheets stay plain files in plain folders
- **Templates**: Novel (Front Matter, Chapters, Back Matter, Notes, Characters), Short story collection, Article or essay, Blank. Any existing group can also be made a project, and stop being one without touching its files
- **Section types**: Manuscript (counts toward the goal, exported), Front/back matter (exported, not counted), Material (neither). Set from a section's right-click menu or the project settings. Material sections tint their sheets like single material sheets
- **Goal and deadline**: a word goal with a progress bar, and a deadline with days left and the words a day still needed. Only manuscript counts, so notes and front matter never inflate the total
- **Whole project view** reads front to back: sheets loose in the project, then each section in the order you arranged. Sheets nobody has arranged read in natural name order inside a project (Chapter 2 before Chapter 10), not newest first
- **New sheets** in a project go to its first manuscript section; **Export project** joins everything that isn't material, in reading order
- Quick open and the keyboard take you into the right project
- **Not done**: per-sheet status labels such as "Draft" (I could not confirm Ulysses does this, so I left it out); character goals (word goals only); project keywords and export defaults, which belong with Phase 4 (keywords) and Phase 5 (export)

## Phase 3: Writing depth: done, with two items left out

- **Navigator** (toolbar, Ctrl/Cmd+Shift+O): the headings of the open text, the one you are under marked, click to jump; a glued text also shows where each sheet begins
- **Statistics**: click the word count in the status bar for words, characters, sentences, paragraphs and reading time, with a second column for the selection. The status bar shows "3 of 46 words" while you select. Counting is now the same everywhere (status bar, sheet list, project goal): Markdown marks on their own ("#", "-", ">") are not words, and comments are not counted
- **Typing**: curly quotes, en and em dashes and ellipses as you type; never inside code, HTML tags or link addresses, and a line of hyphens stays a rule. Can be switched off. Lists and quotes continue on Enter (numbered lists count up) and end on an empty item
- **Comments** (Ctrl/Cmd+Shift+M): `<!-- note -->` annotations, shown muted and highlighted; wraps the selection if there is one. They stay out of word counts, titles, previews and every export
- **Footnotes** (Ctrl/Cmd+Shift+Y): inserts `[^1]` at the cursor and the matching definition at the end, numbering itself; references and definitions are styled
- **Find and replace** (Ctrl/Cmd+F, or Ctrl/Cmd+H): the same bar, restyled, with replace, replace all, match case, regexp and whole word
- **Appearance** (toolbar "Aa", Ctrl/Cmd+,): five themes (Auto, Light, Dark, Sepia, Midnight), font (sans, serif, mono), text size, line spacing and column width, saved on this device. The toolbar theme button cycles through all five

**Left out**
- **Word goals per sheet or group**: dropped on request. The project word goal from Phase 2 stays
- **Images by drag and drop**: needs the desktop app to serve image files from the library folder (Tauri's asset protocol and its permissions), which cannot be tried until the Windows build has been run. It belongs after real desktop testing

## Phase 4: Organisation power

- Keywords (tags) shown as chips in the list, with filters that can match them (M)
- Filter builder with AND/OR rules, including a material rule (M)
- Sheet notes and attachments panel: notes, images, PDFs (L)
- Favourites and pinned sheets (S)
- Revisions: automatic snapshots with diff and restore, the safety net for glue and bulk edits (L)

## Phase 5: Export and publishing

- Export dialog with live preview and templates for DOCX, PDF, EPUB, HTML (L)
- Pandoc bundled or auto-detected; a PDF route without LaTeX (M)
- Export metadata: title, author, cover, table of contents (M)
- Copy as rich text; publishing targets later (M)

## Phase 6: Ship it

- Signed installers, auto-update, `.md` file association (M)
- Onboarding: a welcome library in the style of the Ulysses "First Steps" sheets (S)
- Accessibility and localisation pass (M)

## Sync

Scriptorium syncs by living in a synced folder, so any service that syncs a local folder works (iCloud Drive, Dropbox, Proton Drive on Windows and macOS, and others). Phase 0 makes that safe.

**Watch item: native Proton Drive integration.** Proton's Drive SDK is not yet ready for third-party production use, and its authentication modules for standalone integrations were not supported as of January 2026. There is an official Proton Drive command-line tool (released June 2026) whose capabilities have not been verified. There is no confirmed official Linux desktop sync client. Re-check the SDK's status before starting any native integration, and treat it as its own phase.

## Recommended order

1. Phase 0 in full
2. Trash view and keyboard navigation, then the toolbar (Phase 1)
3. Projects (Phase 2), then goals and navigator (Phase 3)
4. Keywords with filters, then revisions (Phase 4)
5. Phases 5 and 6 as release approaches

Most of Phase 1 can be built and checked in the browser build. The CI item and the file watcher in Phase 0 need the desktop build.

## Open decisions

1. **Platforms:** Windows only first, or all three desktop platforms from the start?
2. **Sync:** is "works in any synced folder" enough, or is built-in sync wanted? Built-in sync would add a phase.
3. **Audience:** personal tool or shipped to others? That decides how much of Phase 6 matters.
4. **Mobile:** ever in scope? It affects how stable the file layout and sidecar format must stay.
