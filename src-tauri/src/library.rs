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
    /// Looks like a copy a sync service made when two devices edited the same sheet.
    pub conflict: bool,
    /// For a conflicted copy: the sheet it was copied from, when that still exists.
    pub original: Option<String>,
}

/// What the app can see at the library path. On Android the folder can be invisible to the app
/// until "All files access" is granted, which looks like a missing or empty folder.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    /// the folder was found (or could not be ruled out: a denied folder may well exist)
    pub exists: bool,
    pub readable: bool,
    pub denied: bool,
    pub sheets: usize,
}

/// Something in the trash: a sheet, or a whole group with its sheets.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrashItem {
    /// the entry's name inside `.trash`; what the other trash functions take
    pub id: String,
    pub name: String,
    pub title: String,
    pub preview: String,
    pub is_group: bool,
    /// where it was before it was deleted ("" when unknown)
    pub original: String,
    pub deleted: u64,
    pub sheets: usize,
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

/// `<!-- ... -->` comments are annotations: they stay out of counts and exports. An unterminated
/// one is left alone, so a half-typed comment never swallows the rest of the sheet.
pub fn strip_comments(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("<!--") {
        match rest[start + 4..].find("-->") {
            Some(end) => {
                out.push_str(&rest[..start]);
                out.push(' ');
                rest = &rest[start + 4 + end + 3..];
            }
            None => break,
        }
    }
    out.push_str(rest);
    out
}

/// A word is a run of non-space characters with at least one letter or digit, so Markdown
/// marks on their own ("#", "-", ">", "---") are not words. Comments don't count.
pub fn count_words(text: &str) -> usize {
    strip_comments(text)
        .split_whitespace()
        .filter(|w| w.chars().any(|c| c.is_alphanumeric()))
        .count()
}

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
    strip_comments(text)
        .lines()
        .map(|l| l.trim())
        .find(|l| !l.is_empty())
        .map(clean_title_line)
        .unwrap_or_default()
}

fn title_and_preview(text: &str, fallback: &str) -> (String, String) {
    // comments are for you: they never show up as a title or a preview
    let clean = strip_comments(text);
    let mut lines = clean.lines().map(|l| l.trim()).filter(|l| !l.is_empty());
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
                words: count_words(&text),
                conflict: conflict_original_stem(&stem_of(p)).is_some(),
                original: original_path(p).map(|o| rel_of(root, &o)),
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
    write_atomic(&p, content)?;
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

/// Write to a hidden temp file in the same folder, then rename over the target, so a crash or a
/// sync client reading mid-write never sees half a sheet.
pub fn write_atomic(target: &Path, content: &str) -> Res<()> {
    let dir = target.parent().ok_or("Sheet has no folder")?;
    let tmp = dir.join(format!(".{}.tmp", name_of(target)));
    fs::write(&tmp, content).map_err(err)?;
    fs::rename(&tmp, target).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        err(e)
    })
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
    fs::rename(&src, &dest).map_err(err)?;
    // remember where it came from so it can be put back
    let _ = fs::write(trash.join(format!("{}.origin", name_of(&dest))), rel_of(root, &src));
    Ok(())
}

// ---------- trash ----------

const TRASH: &str = ".trash";
const ORIGIN_EXT: &str = ".origin";

/// A trash entry by id, refusing anything that isn't a plain entry name inside `.trash`.
fn trash_entry(root: &Path, id: &str) -> Res<PathBuf> {
    if id.is_empty() || id.contains(['/', '\\']) || id.starts_with('.') || id.ends_with(ORIGIN_EXT) {
        return Err("Not in the trash".into());
    }
    let p = root.join(TRASH).join(id);
    if p.exists() {
        Ok(p)
    } else {
        Err("Not in the trash".into())
    }
}

fn origin_file(root: &Path, id: &str) -> PathBuf {
    root.join(TRASH).join(format!("{id}{ORIGIN_EXT}"))
}

/// "1760000000000-Chapter.md" -> (1760000000, "Chapter.md")
fn split_trash_id(id: &str) -> (u64, String) {
    match id.split_once('-') {
        Some((ms, name)) if !ms.is_empty() && ms.bytes().all(|b| b.is_ascii_digit()) => (ms.parse::<u64>().unwrap_or(0) / 1000, name.to_string()),
        _ => (0, id.to_string()),
    }
}

pub fn list_trash(root: &Path) -> Vec<TrashItem> {
    let mut out = Vec::new();
    let Ok(rd) = fs::read_dir(root.join(TRASH)) else {
        return out;
    };
    for e in rd.flatten() {
        let id = e.file_name().to_string_lossy().into_owned();
        if id.starts_with('.') || id.ends_with(ORIGIN_EXT) {
            continue;
        }
        let p = e.path();
        let (deleted, name) = split_trash_id(&id);
        let original = fs::read_to_string(origin_file(root, &id)).unwrap_or_default().trim().to_string();
        if p.is_dir() {
            let mut files = Vec::new();
            collect_md(&p, true, &mut files);
            let words = files.iter().map(|f| count_words(&fs::read_to_string(f).unwrap_or_default())).sum();
            out.push(TrashItem {
                id,
                title: name.clone(),
                name,
                preview: format!("{} {}", files.len(), if files.len() == 1 { "sheet" } else { "sheets" }),
                is_group: true,
                original,
                deleted,
                sheets: files.len(),
                words,
            });
        } else if is_md(&p) {
            let text = fs::read_to_string(&p).unwrap_or_default();
            let (title, preview) = title_and_preview(&text, &stem_of(&p));
            out.push(TrashItem {
                id,
                name,
                title,
                preview,
                is_group: false,
                original,
                deleted,
                sheets: 1,
                words: count_words(&text),
            });
        }
    }
    out.sort_by(|a, b| b.deleted.cmp(&a.deleted).then_with(|| a.title.cmp(&b.title)));
    out
}

pub fn read_trash_sheet(root: &Path, id: &str) -> Res<String> {
    let p = trash_entry(root, id)?;
    if !p.is_file() {
        return Err("That is a group, not a sheet".into());
    }
    fs::read_to_string(p).map_err(err)
}

/// Put an item back where it was deleted from (recreating the group if that's gone). A name
/// clash gets a number rather than replacing anything. Returns the new library path.
pub fn restore_trash(root: &Path, id: &str) -> Res<String> {
    let item = trash_entry(root, id)?;
    let original = fs::read_to_string(origin_file(root, id)).unwrap_or_default();
    let original = original.trim();
    let (parent, name) = match original.rsplit_once('/') {
        Some((parent, name)) => (parent.to_string(), name.to_string()),
        None if !original.is_empty() => (String::new(), original.to_string()),
        None => (String::new(), split_trash_id(id).1),
    };
    let dir = resolve(root, &parent)?;
    fs::create_dir_all(&dir).map_err(err)?;
    let target = if item.is_dir() {
        unique_path(&dir, &name, None)
    } else {
        unique_path(&dir, name.strip_suffix(".md").unwrap_or(&name), Some("md"))
    };
    fs::rename(&item, &target).map_err(err)?;
    let _ = fs::remove_file(origin_file(root, id));
    Ok(rel_of(root, &target))
}

/// Delete one trash entry for good.
pub fn purge_trash(root: &Path, id: &str) -> Res<()> {
    let p = trash_entry(root, id)?;
    if p.is_dir() {
        fs::remove_dir_all(&p).map_err(err)?;
    } else {
        fs::remove_file(&p).map_err(err)?;
    }
    let _ = fs::remove_file(origin_file(root, id));
    Ok(())
}

pub fn empty_trash(root: &Path) -> Res<usize> {
    let mut n = 0;
    for item in list_trash(root) {
        purge_trash(root, &item.id)?;
        n += 1;
    }
    Ok(n)
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
    run_pandoc(&src, dest)
}

/// Export text that isn't a single file on disk (glued sheets joined together).
pub fn export_text(content: &str, dest: &str) -> Res<()> {
    let tmp = std::env::temp_dir().join(format!("scriptorium-export-{}.md", std::process::id()));
    fs::write(&tmp, content).map_err(err)?;
    let r = run_pandoc(&tmp, dest);
    let _ = fs::remove_file(&tmp);
    r
}

fn run_pandoc(src: &Path, dest: &str) -> Res<()> {
    let out = Command::new("pandoc")
        .arg(src)
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

// ---------- structure metadata ----------

const META_FILE: &str = ".scriptorium.json";

/// Sheet order, material flags, glued sheets and saved filters live in one hidden JSON file in
/// the library root, so the Markdown files themselves stay clean. The UI owns the schema.
pub fn read_meta(root: &Path) -> String {
    fs::read_to_string(root.join(META_FILE)).unwrap_or_default()
}

pub fn write_meta(root: &Path, json: &str) -> Res<()> {
    write_atomic(&root.join(META_FILE), json)
}

// ---------- change detection (for sync folders and outside edits) ----------

/// A cheap fingerprint of everything visible in the library: folders, sheets and the structure
/// file, by name, size and modification time. It changes whenever something changes on disk.
pub fn stamp(root: &Path) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    fn walk(dir: &Path, h: &mut DefaultHasher) {
        let mut entries: Vec<_> = fs::read_dir(dir).map(|rd| rd.flatten().collect()).unwrap_or_default();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let name = e.file_name().to_string_lossy().into_owned();
            let path = e.path();
            if path.is_dir() {
                if !is_hidden(&name) {
                    name.hash(h);
                    walk(&path, h);
                }
            } else if is_md(&path) && !is_hidden(&name) || name == META_FILE {
                let m = fs::metadata(&path).ok();
                name.hash(h);
                m.as_ref().map(|m| m.len()).hash(h);
                m.and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_nanos())
                    .hash(h);
            }
        }
    }
    let mut h = DefaultHasher::new();
    walk(root, &mut h);
    format!("{:016x}", h.finish())
}

// ---------- first look at a library folder ----------

pub fn probe(root: &Path) -> Probe {
    match fs::read_dir(root) {
        Ok(_) => {
            let mut files = Vec::new();
            collect_md(root, true, &mut files);
            Probe { exists: true, readable: true, denied: false, sheets: files.len() }
        }
        Err(e) => Probe {
            exists: e.kind() != io::ErrorKind::NotFound,
            readable: false,
            denied: e.kind() == io::ErrorKind::PermissionDenied,
            sheets: 0,
        },
    }
}

// ---------- sync conflicts ----------

/// If a sheet's name looks like a sync service's conflicted copy, the name it was copied from.
/// Recognised: Dropbox ("Name (Joe's conflicted copy 2026-01-01)") and Syncthing
/// ("Name.sync-conflict-20260101-120000-ABCDEFG").
fn conflict_original_stem(stem: &str) -> Option<String> {
    let lower = stem.to_ascii_lowercase();
    let original = if let Some(i) = lower.find("conflicted copy") {
        // must be the parenthesised form, so a title that merely says it isn't flagged
        let open = stem[..i].rfind('(')?;
        let close = stem[i..].find(')').map(|c| i + c + 1).unwrap_or(stem.len());
        format!("{}{}", stem[..open].trim_end(), &stem[close..])
    } else if let Some(i) = lower.find(".sync-conflict-") {
        stem[..i].to_string()
    } else {
        return None;
    };
    let original = original.trim().to_string();
    if original.is_empty() {
        None
    } else {
        Some(original)
    }
}

fn original_path(copy: &Path) -> Option<PathBuf> {
    let stem = conflict_original_stem(&stem_of(copy))?;
    let candidate = copy.parent()?.join(format!("{stem}.md"));
    candidate.is_file().then_some(candidate)
}

/// Settle a conflicted copy. `keep_copy` makes the copy the sheet (the old one goes to the
/// trash); otherwise the copy goes to the trash. Returns the path of the surviving sheet.
pub fn resolve_conflict(root: &Path, rel: &str, keep_copy: bool) -> Res<String> {
    let copy = resolve(root, rel)?;
    let original = original_path(&copy).ok_or("The original sheet isn't there any more")?;
    if keep_copy {
        delete_item(root, &rel_of(root, &original))?;
        fs::rename(&copy, &original).map_err(err)?;
    } else {
        delete_item(root, rel)?;
    }
    Ok(rel_of(root, &original))
}

/// Keep text that must not be lost beside the sheet it came from, named like a conflicted copy.
pub fn save_conflict_copy(root: &Path, rel: &str, content: &str) -> Res<String> {
    let p = resolve(root, rel)?;
    let dir = p.parent().ok_or("Sheet has no folder")?;
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let target = unique_path(dir, &format!("{} (conflicted copy {})", stem_of(&p), utc_stamp(secs)), Some("md"));
    write_atomic(&target, content)?;
    Ok(rel_of(root, &target))
}

fn utc_stamp(secs: u64) -> String {
    // days since 1970-01-01 to a civil date (Howard Hinnant's algorithm)
    let z = (secs / 86400) as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    let minutes = (secs % 86400) / 60;
    format!("{year:04}-{month:02}-{day:02} {:02}{:02}", minutes / 60, minutes % 60)
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
        assert_eq!(all[0].words, 4);
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
    fn meta_round_trips_and_stays_hidden() {
        let root = tmp("meta");
        assert_eq!(read_meta(&root), "");
        write_meta(&root, "{\"material\":[]}").unwrap();
        assert_eq!(read_meta(&root), "{\"material\":[]}");
        assert!(sheets(&root, "", true).unwrap().is_empty());
        assert!(!tree(&root).children.iter().any(|g| g.name.starts_with('.')));
    }

    #[test]
    fn atomic_write_leaves_no_temp_file() {
        let root = tmp("atomic");
        let p = create_sheet(&root, "").unwrap();
        let p = write_sheet(&root, &p, "hello").unwrap();
        assert_eq!(read_sheet(&root, &p).unwrap(), "hello");
        let names: Vec<_> = fs::read_dir(&root).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        assert!(names.iter().all(|n| !n.ends_with(".tmp")), "{names:?}");
    }

    #[test]
    fn conflict_names_are_recognised() {
        assert_eq!(conflict_original_stem("Chapter (Joe's conflicted copy 2026-01-01)").as_deref(), Some("Chapter"));
        assert_eq!(conflict_original_stem("Chapter (Conflicted Copy)").as_deref(), Some("Chapter"));
        assert_eq!(conflict_original_stem("Chapter.sync-conflict-20260101-120000-ABCDEFG").as_deref(), Some("Chapter"));
        assert_eq!(conflict_original_stem("Chapter 2"), None);
        assert_eq!(conflict_original_stem("A story about a conflicted copy editor"), None);
        assert_eq!(conflict_original_stem("(conflicted copy)"), None);
    }

    #[test]
    fn conflicts_are_flagged_and_resolvable() {
        let root = tmp("conflict");
        fs::write(root.join("Chapter.md"), "mine").unwrap();
        fs::write(root.join("Chapter (Joe's conflicted copy 2026-01-01).md"), "theirs").unwrap();
        let list = sheets(&root, "", false).unwrap();
        let copy = list.iter().find(|s| s.conflict).expect("copy flagged");
        assert_eq!(copy.original.as_deref(), Some("Chapter.md"));
        assert!(list.iter().filter(|s| !s.conflict).all(|s| s.original.is_none()));

        // keep the copy: it replaces the original, the old text survives in the trash
        let kept = resolve_conflict(&root, &copy.path, true).unwrap();
        assert_eq!(kept, "Chapter.md");
        assert_eq!(read_sheet(&root, "Chapter.md").unwrap(), "theirs");
        assert_eq!(sheets(&root, "", false).unwrap().len(), 1);
        assert!(root.join(".trash").read_dir().unwrap().count() >= 1);

        // discard a copy
        fs::write(root.join("Chapter.sync-conflict-20260101-120000-ABC.md"), "other").unwrap();
        resolve_conflict(&root, "Chapter.sync-conflict-20260101-120000-ABC.md", false).unwrap();
        assert_eq!(read_sheet(&root, "Chapter.md").unwrap(), "theirs");
        assert_eq!(sheets(&root, "", false).unwrap().len(), 1);
    }

    #[test]
    fn conflict_copy_keeps_text_beside_the_sheet() {
        let root = tmp("copy");
        fs::write(root.join("Chapter.md"), "disk").unwrap();
        let rel = save_conflict_copy(&root, "Chapter.md", "my unsaved words").unwrap();
        assert!(rel.starts_with("Chapter (conflicted copy "), "{rel}");
        assert_eq!(read_sheet(&root, &rel).unwrap(), "my unsaved words");
        let list = sheets(&root, "", false).unwrap();
        assert_eq!(list.iter().find(|s| s.path == rel).unwrap().original.as_deref(), Some("Chapter.md"));
    }

    #[test]
    fn utc_stamp_is_correct() {
        assert_eq!(utc_stamp(0), "1970-01-01 0000");
        assert_eq!(utc_stamp(1_767_225_600 + 3600 * 13 + 60 * 7), "2026-01-01 1307");
        assert_eq!(utc_stamp(951_782_400), "2000-02-29 0000");
    }

    #[test]
    fn stamp_changes_when_anything_visible_changes() {
        let root = tmp("stamp");
        let a = stamp(&root);
        assert_eq!(a, stamp(&root));
        let p = create_sheet(&root, "").unwrap();
        let b = stamp(&root);
        assert_ne!(a, b);
        write_sheet(&root, &p, "some words").unwrap();
        let c = stamp(&root);
        assert_ne!(b, c);
        write_meta(&root, "{}").unwrap();
        let d = stamp(&root);
        assert_ne!(c, d);
        create_group(&root, "", "Book").unwrap();
        assert_ne!(d, stamp(&root));
        // hidden files and the trash are ignored
        let e = stamp(&root);
        fs::write(root.join(".scratch"), "x").unwrap();
        fs::create_dir_all(root.join(".trash")).unwrap();
        fs::write(root.join(".trash/x.md"), "x").unwrap();
        assert_eq!(e, stamp(&root));
    }

    #[test]
    fn trash_lists_restores_and_purges() {
        let root = tmp("trash");
        fs::create_dir_all(root.join("Book")).unwrap();
        fs::write(root.join("Book/Chapter.md"), "# Chapter\n\nSome words here").unwrap();
        fs::write(root.join("Note.md"), "# Note\n\nhi").unwrap();
        delete_item(&root, "Book/Chapter.md").unwrap();
        delete_item(&root, "Note.md").unwrap();

        let items = list_trash(&root);
        assert_eq!(items.len(), 2);
        let ch = items.iter().find(|i| i.title == "Chapter").unwrap();
        assert_eq!((ch.original.as_str(), ch.is_group, ch.words), ("Book/Chapter.md", false, 4));
        assert_eq!(read_trash_sheet(&root, &ch.id).unwrap(), "# Chapter\n\nSome words here");
        assert!(sheets(&root, "", true).unwrap().is_empty(), "trashed sheets are out of the library");

        // back where it came from
        assert_eq!(restore_trash(&root, &ch.id).unwrap(), "Book/Chapter.md");
        assert_eq!(read_sheet(&root, "Book/Chapter.md").unwrap(), "# Chapter\n\nSome words here");
        assert_eq!(list_trash(&root).len(), 1);
        assert!(!root.join(".trash").read_dir().unwrap().flatten().any(|e| e.file_name().to_string_lossy().contains("Chapter")), "origin note is cleaned up");

        // a name clash is numbered, never overwritten
        let note = list_trash(&root).remove(0);
        fs::write(root.join("Note.md"), "# Note\n\nnew one").unwrap();
        assert_eq!(restore_trash(&root, &note.id).unwrap(), "Note 2.md");
        assert_eq!(read_sheet(&root, "Note.md").unwrap(), "# Note\n\nnew one");

        // forever
        delete_item(&root, "Note 2.md").unwrap();
        let id = list_trash(&root).remove(0).id;
        purge_trash(&root, &id).unwrap();
        assert!(list_trash(&root).is_empty());
        assert_eq!(root.join(".trash").read_dir().unwrap().count(), 0);
    }

    #[test]
    fn trashed_groups_come_back_whole_and_missing_parents_are_recreated() {
        let root = tmp("trashgroup");
        fs::create_dir_all(root.join("A/B")).unwrap();
        fs::write(root.join("A/B/one.md"), "# one").unwrap();
        fs::write(root.join("A/B/two.md"), "# two\n\nwords words").unwrap();
        delete_item(&root, "A/B").unwrap();
        delete_item(&root, "A").unwrap();
        let items = list_trash(&root);
        let b = items.iter().find(|i| i.name == "B").unwrap();
        assert_eq!((b.is_group, b.sheets, b.words), (true, 2, 4));
        assert_eq!(b.preview, "2 sheets");
        // "A" is in the trash too, so restoring B has to recreate A
        assert_eq!(restore_trash(&root, &b.id).unwrap(), "A/B");
        assert_eq!(read_sheet(&root, "A/B/two.md").unwrap(), "# two\n\nwords words");
        assert!(read_trash_sheet(&root, &items.iter().find(|i| i.name == "A").unwrap().id).is_err(), "a group has no text");
    }

    #[test]
    fn trash_ids_cannot_escape() {
        let root = tmp("trashescape");
        fs::write(root.join("secret.md"), "keep").unwrap();
        fs::create_dir_all(root.join(".trash")).unwrap();
        for id in ["../secret.md", "..", ".", "", "a/b", ".hidden", "x.origin"] {
            assert!(purge_trash(&root, id).is_err(), "{id}");
            assert!(restore_trash(&root, id).is_err(), "{id}");
            assert!(read_trash_sheet(&root, id).is_err(), "{id}");
        }
        assert_eq!(read_sheet(&root, "secret.md").unwrap(), "keep");
    }

    #[test]
    fn empty_trash_only_touches_the_trash() {
        let root = tmp("emptytrash");
        fs::write(root.join("keep.md"), "# keep").unwrap();
        fs::write(root.join("a.md"), "# a").unwrap();
        fs::write(root.join("b.md"), "# b").unwrap();
        delete_item(&root, "a.md").unwrap();
        delete_item(&root, "b.md").unwrap();
        assert_eq!(empty_trash(&root).unwrap(), 2);
        assert_eq!(sheets(&root, "", true).unwrap().len(), 1);
        assert_eq!(empty_trash(&root).unwrap(), 0);
    }

    #[test]
    fn items_trashed_before_origins_were_recorded_go_to_the_root() {
        let root = tmp("legacytrash");
        fs::create_dir_all(root.join(".trash")).unwrap();
        fs::write(root.join(".trash/1760000000000-Old.md"), "# Old").unwrap();
        let item = list_trash(&root).remove(0);
        assert_eq!((item.original.as_str(), item.deleted), ("", 1_760_000_000));
        assert_eq!(restore_trash(&root, &item.id).unwrap(), "Old.md");
    }

    #[test]
    fn probe_tells_missing_empty_and_full_apart() {
        let root = tmp("probe");
        assert_eq!(probe(&root), Probe { exists: true, readable: true, denied: false, sheets: 0 });
        fs::create_dir_all(root.join("Book")).unwrap();
        fs::write(root.join("a.md"), "# a").unwrap();
        fs::write(root.join("Book/b.md"), "# b").unwrap();
        fs::write(root.join("notes.txt"), "not a sheet").unwrap();
        assert_eq!(probe(&root).sheets, 2);
        let missing = probe(&root.join("nope"));
        assert_eq!((missing.exists, missing.readable, missing.denied), (false, false, false));
        // a file where a folder should be is "there" but not readable as a library
        let file = probe(&root.join("a.md"));
        assert!(!file.readable);
    }

    #[test]
    fn a_comment_on_the_first_line_does_not_name_the_file() {
        let root = tmp("commentname");
        let p = create_sheet(&root, "").unwrap();
        let p = write_sheet(&root, &p, "<!-- todo: fix opening -->\n# The Real Name\n\ntext").unwrap();
        assert_eq!(p, "The Real Name.md");
        let q = create_sheet(&root, "").unwrap();
        assert_eq!(write_sheet(&root, &q, "<!-- only a note -->").unwrap(), q, "stays Untitled until there is real text");
    }

    #[test]
    fn titles_and_previews_skip_comments() {
        let (t, p) = title_and_preview("<!-- draft note -->\n# Real title\n\nFirst <!-- aside --> line", "x");
        assert_eq!((t.as_str(), p.as_str()), ("Real title", "First   line"));
        let (t2, _) = title_and_preview("<!-- only a comment -->", "fallback");
        assert_eq!(t2, "fallback");
    }

    #[test]
    fn words_ignore_markdown_marks_and_comments() {
        assert_eq!(count_words("# Title\n\n- item one\n---\n> quoted words\n\n* * *"), 5);
        assert_eq!(count_words("a <!-- hidden words here --> b"), 2);
        assert_eq!(count_words("a <!-- multi\nline\ncomment --> b <!-- another --> c"), 3);
        assert_eq!(count_words("half <!-- typed comment with no end and more words"), 9, "an unterminated comment is just text, so it never swallows the sheet");
        assert_eq!(count_words("It's 2026 — “quoted”, fine."), 4);
        assert_eq!(count_words(""), 0);
        let root = tmp("wordcount");
        fs::write(root.join("a.md"), "# One\n\n- two <!-- three -->").unwrap();
        assert_eq!(sheets(&root, "", false).unwrap()[0].words, 2);
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
