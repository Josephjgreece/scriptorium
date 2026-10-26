# Scriptorium roadmap

Goal: a calm, Ulysses-style writing app on top of a plain folder of Markdown files. Writing never depends on the app.

Effort is rough: **S** under a day, **M** a few days, **L** a week or more.

## Where we are

- Three panes (library, sheet list, editor), light and dark themes, typewriter and focus modes, autosave
- Library: All, Last 7 Days, Inbox, nested groups
- Manual sheet order, material sheets, glued sheets, filters (smart folders)
- Group and glued export through Pandoc, with material left out
- Structure that Markdown can't hold lives in `.scriptorium.json` in the library root

## Phase 0: Trustworthy and sync-safe

A writing app can't lose text, and a synced folder makes that harder.

| Item | Why | Effort |
|---|---|---|
| Build the desktop app in CI (Windows, macOS, Linux) | The Tauri side has never been compiled in this project's dev environment, so the Rust commands are unproven in the real shell | M |
| Unit tests for `meta.ts`; commit the browser end-to-end test | Order, glue and remap logic is easy to break | S |
| Atomic sheet writes (temp file, then rename) | A crash mid-save can corrupt a sheet | S |
| Save-failure recovery: keep unsaved text, retry, warn on quit | Today "Not saved" is only a toast | S |
| File watcher: reload when files change outside the app | Needed for any synced folder or external editor | M |
| "Choose library folder" setting | Replaces the `SCRIPTORIUM_LIBRARY` environment variable; one click to use Proton Drive, iCloud Drive, Dropbox or any synced folder | S |
| Conflicted-copy handling | Sync services create files like "Chapter 2 (conflicted copy)"; show them clearly instead of hiding or mixing them up | M |
| Safe `.scriptorium.json` under sync | One shared file means two devices can overwrite each other's order, glue and filters; merge per key or split the file | M |

## Phase 1: Library parity

- Trash view: browse, restore, empty `.trash` (S)
- Top toolbar across the window: sidebar toggle, search and new sheet left; export, goal, navigator, style right (M)
- Keyboard navigation in sidebar and list; Ctrl+O quick open; rename sheet (M)
- Sidebar polish: collapsible, drag to reorder groups, group icons (M)
- New sheet inserted after the selected sheet, not only at the end (S)

## Phase 2: Projects

Ulysses calls this layer **Projects** (introduced in Ulysses 29, extended since, with templates in version 41). A project is a self-contained work, such as a novel, with its own sections and settings.

- A project is a top-level folder flagged in `.scriptorium.json` (M)
- Project settings: goal, deadline, keywords, export defaults (M)
- Section rules: which sections count toward totals and exports, so Front Matter and Back Matter export while Notes and Characters behave like material (M)
- Project templates, starting with a "Novel" layout: Front Matter, Chapters, Back Matter, Notes, Characters (M)
- Sidebar "Projects" section that opens a focused view of just that project (M)
- Per-sheet status such as Draft, if the Ulysses behaviour is confirmed first (S)

Depends on Phase 1 (toolbar, sidebar) and uses goals and statistics from Phase 3.

## Phase 3: Writing depth

- Goals: word or character target per sheet, group or project, with a progress ring (M)
- Navigator: heading outline that jumps to a position, and between glued sheets (M)
- Editor: smart quotes and dashes, better list and quote continuation, images by drag and drop, footnotes, inline comments that stay out of exports, find and replace panel (L)
- Statistics panel: reading time, sentences, paragraphs, per selection (S)
- Appearance: font, size, line spacing, column width, a few themes beyond light and dark (M)

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
