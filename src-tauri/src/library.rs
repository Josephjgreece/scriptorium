//! The library: a folder of Markdown files. Groups are folders, sheets are `.md` files.
//! Everything here is plain std so it can be tested without Tauri.

use serde::Serialize;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

pub type Res<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[derive(Serialize, Debug)]
pub struct Group {
    pub name: String,
    pub path: String,
    pub count: usize,
    pub children: Vec<Group>,
}

#[derive(Serialize, Debug)]
pub struct SheetInfo {
    pub path: String,
    pub title: String,
    pub preview: String,
    pub modified: u64,
    pub words: usize,
}

#[derive(Serialize, Debug)]
pub struct SearchHit {
    pub path: String,
    pub title: String,
    pub snippet: String,
}

// ---------- path helpers ----------

/// Resolve a library-relative path ("Group/Sheet.md") to a real path, refusing anything
/// that could escape the library root.
pub fn resolve(root: &Path, rel: &str) -> Res<PathBuf> {
    let mut out = root.to_path_buf();
    for c in Path::new(rel).components() {
        match c {
            Component::Normal(p) => out.push(p),
            Component::CurDir => {}
            _ => return Err("Invalid path".into()),
        }
    }
    Ok(out)
}

fn rel_of(root: &Path, p: &Path) -> String {
    p.strip_prefix(root)
        .map(|r| {
            r.components()
                .map(|c| c.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join("/")
        })
        .unwrap_or_default()
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

fn is_md(p: &Path) -> bool {
    p.extension()
        .map(|e| e.eq_ignore_ascii_case("md"))
        .unwrap_or(false)
}

fn modified_secs(p: &Path) -> u64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn sanitize_name(name: &str) -> Res<String> {
    let n = name.trim();
    if n.is_empty() {
        return Err("Name can't be empty".into());
    }
    if n.chars().count() > 100 {
        return Err("Name is too long".into());
    }
    if n.starts_with('.') {
        return Err("Name can't start with a dot".into());
    }
    if n.chars().any(|c| "/\\:*?\"<>|".contains(c) || c.is_control()) {
        return Err("Name contains characters that aren't allowed".into());
    }
    Ok(n.to_string())
}

fn unique_path(dir: &Path, stem: &str, ext: Option<&str>) -> PathBuf {
    let make = |s: &str| match ext {
        Some(e) => dir.join(format!("{s}.{e}")),
        None => dir.join(s),
    };
    let first = make(stem);
    if !first.exists() {
        return first;
    }
    let mut n = 2;
    loop {
        let cand = make(&format!("{stem} {n}"));
        if !cand.exists() {
            return cand;
        }
        n += 1;
    }
}

// ---------- text helpers ----------

fn clean_title_line(line: &str) -> String {
    line.trim()
        .trim_start_matches('#')
        .trim_start_matches('>')
        .trim()
        .replace(['*', '_', '`'], "")
        .trim()
        .to_string()
}

fn first_line_title(text: &str) -> String {
    text.lines()
        .map(|l| l.trim())
        .find(|l| !l.is_empty())
        .map(clean_title_line)
        .unwrap_or_default()
}

fn title_and_preview(text: &str, fallback: &str) -> (String, String) {
    let mut lines = text.lines().map(|l| l.trim()).filter(|l| !l.is_empty());
    let title = lines
        .next()
        .map(clean_title_line)
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| fallback.to_string());
    let preview: String = lines.next().map(|l| l.chars().take(140).collect()).unwrap_or_default();
    (title, preview)
}

fn slugify(title: &str) -> String {
    let kept: String = title
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '-' || *c == '_')
        .collect();
    let collapsed = kept.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.chars().take(60).collect::<String>().trim().to_string()
}

fn is_untitled(stem: &str) -> bool {
    stem == "Untitled"
        || stem
            .strip_prefix("Untitled ")
            .map(|r| !r.is_empty() && r.chars().all(|c| c.is_ascii_digit()))
            .unwrap_or(false)
}

fn stem_of(p: &Path) -> String {
    p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}

fn name_of(p: &Path) -> String {
    p.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}

// ---------- listing ----------

fn build_group(dir: &Path, root: &Path) -> Group {
    let mut children = Vec::new();
    let mut count = 0;
    if let Ok(rd) = fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().into_owned();
            if is_hidden(&name) {
                continue;
            }
            if p.is_dir() {
                children.push(build_group(&p, root));
            } else if is_md(&p) {
                count += 1;
            }
        }
    }
    children.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    let name = if dir == root { "Library".to_string() } else { name_of(dir) };
    Group { name, path: rel_of(root, dir), count, children }
}

pub fn tree(root: &Path) -> Group {
    build_group(root, root)
}

fn collect_md(dir: &Path, recursive: bool, out: &mut Vec<PathBuf>) {
    if let Ok(rd) = fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().into_owned();
            if is_hidden(&name) {
                continue;
            }
            if p.is_dir() {
                if recursive {
                    collect_md(&p, true, out);
                }
            } else if is_md(&p) {
                out.push(p);
            }
        }
    }
}

pub fn sheets(root: &Path, group: &str, recursive: bool) -> Res<Vec<SheetInfo>> {
    let dir = resolve(root, group)?;
    if !dir.is_dir() {
        return Err("Group not found".into());
    }
    let mut files = Vec::new();
    collect_md(&dir, recursive, &mut files);
    let mut out: Vec<SheetInfo> = files
        .iter()
        .map(|p| {
            let text = fs::read_to_string(p).unwrap_or_default();
            let (title, preview) = title_and_preview(&text, &stem_of(p));
            SheetInfo {
                path: rel_of(root, p),
                title,
                preview,
                modified: modified_secs(p),
                words: text.split_whitespace().count(),
            }
        })
        .collect();
    out.sort_by(|a, b| b.modified.cmp(&a.modified).then_with(|| a.title.cmp(&b.title)));
    Ok(out)
}

// ---------- sheets ----------

pub fn read_sheet(root: &Path, rel: &str) -> Res<String> {
    let p = resolve(root, rel)?;
    fs::read_to_string(p).map_err(err)
}

/// Write a sheet. A brand-new "Untitled" sheet is renamed after its first line once it has
/// one. Returns the (possibly new) library-relative path.
pub fn write_sheet(root: &Path, rel: &str, content: &str) -> Res<String> {
    let p = resolve(root, rel)?;
    if !is_md(&p) {
        return Err("Not a sheet".into());
    }
    fs::write(&p, content).map_err(err)?;
    if is_untitled(&stem_of(&p)) {
        let slug = slugify(&first_line_title(content));
        if !slug.is_empty() {
            let dir = p.parent().ok_or("Sheet has no folder")?;
            let target = unique_path(dir, &slug, Some("md"));
            if target != p {
                fs::rename(&p, &target).map_err(err)?;
                return Ok(rel_of(root, &target));
            }
        }
    }
    Ok(rel_of(root, &p))
}

pub fn create_sheet(root: &Path, group: &str) -> Res<String> {
    let dir = resolve(root, group)?;
    if !dir.is_dir() {
        return Err("Group not found".into());
    }
    let p = unique_path(&dir, "Untitled", Some("md"));
    fs::write(&p, "").map_err(err)?;
    Ok(rel_of(root, &p))
}

// ---------- groups & items ----------

pub fn create_group(root: &Path, parent: &str, name: &str) -> Res<String> {
    let name = sanitize_name(name)?;
    let dir = resolve(root, parent)?;
    let p = dir.join(&name);
    if p.exists() {
        return Err("Something with that name already exists".into());
    }
    fs::create_dir(&p).map_err(err)?;
    Ok(rel_of(root, &p))
}

pub fn rename_item(root: &Path, rel: &str, new_name: &str) -> Res<String> {
    let src = resolve(root, rel)?;
    if src == root {
        return Err("The library itself can't be renamed".into());
    }
    let mut name = sanitize_name(new_name)?;
    if src.is_file() && !name.to_lowercase().ends_with(".md") {
        name.push_str(".md");
    }
    let target = src.parent().ok_or("No parent folder")?.join(&name);
    if target == src {
        return Ok(rel_of(root, &src));
    }
    if target.exists() {
        return Err("Something with that name already exists".into());
    }
    fs::rename(&src, &target).map_err(err)?;
    Ok(rel_of(root, &target))
}

/// Moves to `<library>/.trash/` so nothing is ever lost.
pub fn delete_item(root: &Path, rel: &str) -> Res<()> {
    let src = resolve(root, rel)?;
    if src == root {
        return Err("The library itself can't be deleted".into());
    }
    if !src.exists() {
        return Err("Not found".into());
    }
    let trash = root.join(".trash");
    fs::create_dir_all(&trash).map_err(err)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let dest = trash.join(format!("{stamp}-{}", name_of(&src)));
    fs::rename(&src, &dest).map_err(err)
}

pub fn move_item(root: &Path, rel: &str, dest_group: &str) -> Res<String> {
    let src = resolve(root, rel)?;
    let dest_dir = resolve(root, dest_group)?;
    if src == root || !src.exists() {
        return Err("Nothing to move".into());
    }
    if !dest_dir.is_dir() {
        return Err("Destination not found".into());
    }
    if src.is_dir() && dest_dir.starts_with(&src) {
        return Err("A group can't be moved into itself".into());
    }
    if src.parent() == Some(dest_dir.as_path()) {
        return Ok(rel_of(root, &src));
    }
    let target = if src.is_dir() {
        unique_path(&dest_dir, &name_of(&src), None)
    } else {
        unique_path(&dest_dir, &stem_of(&src), Some("md"))
    };
    fs::rename(&src, &target).map_err(err)?;
    Ok(rel_of(root, &target))
}

// ---------- search ----------

pub fn search(root: &Path, query: &str) -> Vec<SearchHit> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Vec::new();
    }
    let mut files = Vec::new();
    collect_md(root, true, &mut files);
    let mut hits = Vec::new();
    for p in files {
        let text = fs::read_to_string(&p).unwrap_or_default();
        let (title, _) = title_and_preview(&text, &stem_of(&p));
        let line = text.lines().find(|l| l.to_lowercase().contains(&q));
        if line.is_some() || title.to_lowercase().contains(&q) {
            let snippet = line
                .map(|l| l.trim().chars().take(140).collect::<String>())
                .unwrap_or_default();
            hits.push(SearchHit { path: rel_of(root, &p), title, snippet });
            if hits.len() >= 100 {
                break;
            }
        }
    }
    hits
}

// ---------- export (needs pandoc on the PATH) ----------

pub fn export(root: &Path, rel: &str, dest: &str) -> Res<()> {
    let src = resolve(root, rel)?;
    let out = Command::new("pandoc")
        .arg(&src)
        .arg("-f")
        .arg("markdown")
        .arg("-o")
        .arg(dest)
        .output();
    match out {
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            Err("Pandoc isn't installed. Install it from pandoc.org to export.".into())
        }
        Err(e) => Err(e.to_string()),
        Ok(o) if o.status.success() => Ok(()),
        Ok(o) => Err(String::from_utf8_lossy(&o.stderr).trim().to_string()),
    }
}

// ---------- first run ----------

const WELCOME: &str = "# Welcome to Scriptorium\n\n\
Your library is just a folder of Markdown files. Groups are folders, sheets are .md files, \
so your writing never depends on this app.\n\n\
## Shortcuts\n\n\
- Ctrl/Cmd+N: new sheet\n\
- Ctrl/Cmd+Shift+N: new group\n\
- Ctrl/Cmd+K: search the whole library\n\
- Ctrl/Cmd+Shift+T: typewriter mode\n\
- Ctrl/Cmd+Shift+F: focus mode\n\
- Ctrl/Cmd+Shift+D: switch theme\n\
- Ctrl/Cmd+Shift+E: export this sheet (needs Pandoc)\n";

/// Create a welcome sheet when the library has nothing visible in it.
pub fn seed(root: &Path) {
    let empty = fs::read_dir(root)
        .map(|rd| rd.flatten().all(|e| is_hidden(&e.file_name().to_string_lossy())))
        .unwrap_or(true);
    if empty {
        let _ = fs::write(root.join("Welcome.md"), WELCOME);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let n = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let p = std::env::temp_dir().join(format!("scriptorium-test-{tag}-{n}"));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn resolve_blocks_escape() {
        let r = tmp("resolve");
        assert!(resolve(&r, "../x").is_err());
        assert!(resolve(&r, "a/../../x").is_err());
        assert!(resolve(&r, "/etc/passwd").is_err());
        assert_eq!(resolve(&r, "a/b.md").unwrap(), r.join("a").join("b.md"));
    }

    #[test]
    fn untitled_sheet_is_named_after_first_line() {
        let r = tmp("untitled");
        let p = create_sheet(&r, "").unwrap();
        assert_eq!(p, "Untitled.md");
        let np = write_sheet(&r, &p, "# My First Essay\n\nHello there").unwrap();
        assert_eq!(np, "My First Essay.md");
        assert!(r.join("My First Essay.md").exists());
        assert!(!r.join("Untitled.md").exists());
        // later edits keep the name even if the first line changes
        let np2 = write_sheet(&r, &np, "# Changed\n\nHello").unwrap();
        assert_eq!(np2, "My First Essay.md");
    }

    #[test]
    fn untitled_collision_gets_suffix() {
        let r = tmp("collision");
        fs::write(r.join("Notes.md"), "x").unwrap();
        let p = create_sheet(&r, "").unwrap();
        let np = write_sheet(&r, &p, "Notes").unwrap();
        assert_eq!(np, "Notes 2.md");
    }

    #[test]
    fn empty_untitled_stays_untitled() {
        let r = tmp("empty");
        let p = create_sheet(&r, "").unwrap();
        assert_eq!(write_sheet(&r, &p, "").unwrap(), "Untitled.md");
        assert_eq!(create_sheet(&r, "").unwrap(), "Untitled 2.md");
    }

    #[test]
    fn groups_tree_and_sheets() {
        let r = tmp("tree");
        let g = create_group(&r, "", "Thesis").unwrap();
        let sub = create_group(&r, &g, "Chapter 1").unwrap();
        assert_eq!(sub, "Thesis/Chapter 1");
        assert!(create_group(&r, "", "Thesis").is_err());
        assert!(create_group(&r, "", "../evil").is_err());
        let s = create_sheet(&r, &sub).unwrap();
        write_sheet(&r, &s, "# Intro\n\nSome words here").unwrap();
        let t = tree(&r);
        assert_eq!(t.name, "Library");
        assert_eq!(t.children.len(), 1);
        assert_eq!(t.children[0].children[0].count, 1);
        let all = sheets(&r, "", true).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].title, "Intro");
        assert_eq!(all[0].preview, "Some words here");
        assert_eq!(all[0].words, 5);
        assert!(sheets(&r, "", false).unwrap().is_empty());
    }

    #[test]
    fn rename_move_delete() {
        let r = tmp("ops");
        let a = create_group(&r, "", "A").unwrap();
        let b = create_group(&r, "", "B").unwrap();
        let s = create_sheet(&r, &a).unwrap();
        let s = write_sheet(&r, &s, "Piece").unwrap();
        let moved = move_item(&r, &s, &b).unwrap();
        assert_eq!(moved, "B/Piece.md");
        assert!(move_item(&r, &a, &format!("{a}/inner")).is_err());
        let renamed = rename_item(&r, &moved, "Renamed").unwrap();
        assert_eq!(renamed, "B/Renamed.md");
        let g2 = rename_item(&r, &a, "A2").unwrap();
        assert_eq!(g2, "A2");
        delete_item(&r, &renamed).unwrap();
        assert!(!r.join("B/Renamed.md").exists());
        assert!(r.join(".trash").exists());
        assert!(delete_item(&r, "").is_err());
        // trash is hidden from listings
        assert!(sheets(&r, "", true).unwrap().is_empty());
    }

    #[test]
    fn search_finds_lines_and_titles() {
        let r = tmp("search");
        fs::write(r.join("One.md"), "# Alpha\n\nthe Quick brown fox").unwrap();
        fs::write(r.join("Two.md"), "# Beta\n\nnothing here").unwrap();
        let h = search(&r, "quick");
        assert_eq!(h.len(), 1);
        assert_eq!(h[0].title, "Alpha");
        assert!(h[0].snippet.contains("Quick"));
        assert_eq!(search(&r, "beta").len(), 1);
        assert!(search(&r, "  ").is_empty());
    }

    #[test]
    fn seed_only_when_empty() {
        let r = tmp("seed");
        seed(&r);
        assert!(r.join("Welcome.md").exists());
        let r2 = tmp("seed2");
        fs::write(r2.join("Mine.md"), "x").unwrap();
        seed(&r2);
        assert!(!r2.join("Welcome.md").exists());
    }
}
