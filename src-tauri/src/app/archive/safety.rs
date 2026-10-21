use std::ffi::OsStr;

use crate::app::archive::limits::{MAX_COMPONENT_LEN, MAX_ENTRY_DEPTH};
use crate::app::archive::{Entry, EntryKind};
use crate::app::workspace::is_reserved_device_name;

const ADMIN_FOLDERS: [&str; 2] = [".svn", "_svn"];
const INVALID_CHARACTERS: [char; 5] = ['<', '>', '"', '|', '?'];
const WILDCARD: char = '*';
const FIRST_PRINTABLE: char = ' ';
const DRIVE_SEPARATOR: char = ':';

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unsafe {
    Empty,
    Absolute,
    Drive,
    ParentDir,
    AdminFolder,
    Colon,
    Reserved,
    TrailingDotOrSpace,
    InvalidCharacter,
    ComponentTooLong,
    TooDeep,
}

impl Unsafe {
    pub fn reason(self) -> &'static str {
        match self {
            Self::Empty => "ruta vacía o con componentes vacíos",
            Self::Absolute => "ruta absoluta, UNC o de dispositivo",
            Self::Drive => "letra de unidad",
            Self::ParentDir => "sube de carpeta con «..»",
            Self::AdminFolder => "carpeta administrativa de Subversion",
            Self::Colon => "contiene «:» (flujo alterno de datos)",
            Self::Reserved => "nombre reservado de Windows",
            Self::TrailingDotOrSpace => "termina en punto o en espacio",
            Self::InvalidCharacter => "carácter no válido en Windows",
            Self::ComponentTooLong => "un nombre es demasiado largo",
            Self::TooDeep => "demasiadas carpetas anidadas",
        }
    }
}

fn is_drive_prefix(component: &str) -> bool {
    let mut chars = component.chars();
    matches!(
        (chars.next(), chars.next()),
        (Some(letter), Some(DRIVE_SEPARATOR)) if letter.is_ascii_alphabetic()
    )
}

fn has_invalid_character(component: &str) -> bool {
    component
        .chars()
        .any(|ch| ch < FIRST_PRINTABLE || ch == WILDCARD || INVALID_CHARACTERS.contains(&ch))
}

fn check_component(component: &str) -> Result<(), Unsafe> {
    if component.is_empty() {
        return Err(Unsafe::Empty);
    }
    if component == ".." {
        return Err(Unsafe::ParentDir);
    }
    if ADMIN_FOLDERS
        .iter()
        .any(|name| component.eq_ignore_ascii_case(name))
    {
        return Err(Unsafe::AdminFolder);
    }
    if has_invalid_character(component) {
        return Err(Unsafe::InvalidCharacter);
    }
    if component.contains(DRIVE_SEPARATOR) {
        return Err(Unsafe::Colon);
    }
    if component.ends_with(['.', ' ']) {
        return Err(Unsafe::TrailingDotOrSpace);
    }
    if is_reserved_device_name(OsStr::new(component)) {
        return Err(Unsafe::Reserved);
    }
    if component.encode_utf16().count() > MAX_COMPONENT_LEN {
        return Err(Unsafe::ComponentTooLong);
    }
    Ok(())
}

pub fn skip_reason(entry: &Entry) -> Option<String> {
    match entry.kind {
        EntryKind::Link => Some("enlace: no se extraen enlaces".to_owned()),
        EntryKind::Device => Some("archivo especial: no se extrae".to_owned()),
        EntryKind::File | EntryKind::Directory => sanitize(&entry.name)
            .err()
            .map(|why| why.reason().to_owned()),
    }
}

pub fn sanitize(raw: &str) -> Result<Vec<String>, Unsafe> {
    let normalized = raw.replace('\\', "/");
    if normalized.starts_with('/') {
        return Err(Unsafe::Absolute);
    }
    let trimmed = normalized.strip_suffix('/').unwrap_or(&normalized);
    let first = trimmed.split('/').next().unwrap_or_default();
    if is_drive_prefix(first) {
        return Err(Unsafe::Drive);
    }
    let mut components = Vec::new();
    for component in trimmed.split('/') {
        if component == "." {
            continue;
        }
        check_component(component)?;
        components.push(component.to_owned());
    }
    if components.is_empty() {
        return Err(Unsafe::Empty);
    }
    if components.len() > MAX_ENTRY_DEPTH {
        return Err(Unsafe::TooDeep);
    }
    Ok(components)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parts(raw: &str) -> Vec<String> {
        sanitize(raw).unwrap()
    }

    #[test]
    fn plain_relative_paths_are_split_and_normalized() {
        assert_eq!(parts("a/b/c.txt"), ["a", "b", "c.txt"]);
        assert_eq!(parts(r"a\b\c.txt"), ["a", "b", "c.txt"]);
        assert_eq!(parts("./a/./b/"), ["a", "b"]);
        assert_eq!(parts("dir/"), ["dir"]);
    }

    #[test]
    fn every_unsafe_shape_names_its_rule() {
        let cases = [
            ("", Unsafe::Empty),
            ("a//b", Unsafe::Empty),
            (".", Unsafe::Empty),
            ("./", Unsafe::Empty),
            ("././", Unsafe::Empty),
            ("/etc/passwd", Unsafe::Absolute),
            (r"\\srv\share\x", Unsafe::Absolute),
            (r"\\?\C:\x", Unsafe::Absolute),
            ("C:/x", Unsafe::Drive),
            ("c:x", Unsafe::Drive),
            ("../x", Unsafe::ParentDir),
            ("a/../../x", Unsafe::ParentDir),
            ("a/.SVN/x", Unsafe::AdminFolder),
            ("_Svn", Unsafe::AdminFolder),
            ("a/b:stream", Unsafe::Colon),
            ("con", Unsafe::Reserved),
            ("a/NUL.txt", Unsafe::Reserved),
            ("lpt9.x", Unsafe::Reserved),
            ("CONIN$", Unsafe::Reserved),
            ("name.", Unsafe::TrailingDotOrSpace),
            ("name ", Unsafe::TrailingDotOrSpace),
            ("a<b", Unsafe::InvalidCharacter),
            ("a|b", Unsafe::InvalidCharacter),
            ("a*b", Unsafe::InvalidCharacter),
            ("a\u{1}b", Unsafe::InvalidCharacter),
        ];
        for (raw, rule) in cases {
            assert_eq!(sanitize(raw), Err(rule), "{raw:?}");
        }
    }

    #[test]
    fn a_component_is_limited_in_utf16_units_at_its_exact_edge() {
        assert!(sanitize(&"a".repeat(MAX_COMPONENT_LEN)).is_ok());
        assert_eq!(
            sanitize(&"a".repeat(MAX_COMPONENT_LEN + 1)),
            Err(Unsafe::ComponentTooLong)
        );
        let astral = "😀".repeat(MAX_COMPONENT_LEN / 2);
        assert_eq!(sanitize(&astral), Ok(vec![astral.clone()]));
        assert_eq!(
            sanitize(&format!("{astral}😀")),
            Err(Unsafe::ComponentTooLong)
        );
    }

    #[test]
    fn the_depth_is_limited_at_its_exact_edge() {
        assert!(sanitize(&vec!["d"; MAX_ENTRY_DEPTH].join("/")).is_ok());
        assert_eq!(
            sanitize(&vec!["d"; MAX_ENTRY_DEPTH + 1].join("/")),
            Err(Unsafe::TooDeep)
        );
    }

    fn entry(name: &str, kind: EntryKind) -> Entry {
        Entry {
            name: name.to_owned(),
            kind,
            size: 0,
            packed: None,
            is_encrypted: false,
        }
    }

    #[test]
    fn links_and_devices_are_skipped_whatever_their_name() {
        assert!(skip_reason(&entry("ok", EntryKind::Link)).is_some());
        assert!(skip_reason(&entry("ok", EntryKind::Device)).is_some());
        assert!(skip_reason(&entry("ok", EntryKind::File)).is_none());
        assert!(skip_reason(&entry("../x", EntryKind::Directory)).is_some());
    }
}

#[cfg(test)]
mod reason_tests {
    use super::*;

    #[test]
    fn every_rule_explains_itself_differently() {
        let all = [
            Unsafe::Empty,
            Unsafe::Absolute,
            Unsafe::Drive,
            Unsafe::ParentDir,
            Unsafe::AdminFolder,
            Unsafe::Colon,
            Unsafe::Reserved,
            Unsafe::TrailingDotOrSpace,
            Unsafe::InvalidCharacter,
            Unsafe::ComponentTooLong,
            Unsafe::TooDeep,
        ];
        let reasons: std::collections::BTreeSet<_> = all.iter().map(|rule| rule.reason()).collect();
        assert_eq!(reasons.len(), all.len());
        assert!(reasons.iter().all(|reason| reason.len() > 8));
    }
}
