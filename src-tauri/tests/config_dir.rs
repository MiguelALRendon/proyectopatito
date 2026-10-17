use std::ffi::OsString;
use std::path::PathBuf;

use dakedaduck_svn_lib::config::resolve_config_dir;

fn default_dir() -> PathBuf {
    std::env::temp_dir().join("config-dir-default")
}

fn override_dir() -> PathBuf {
    std::env::temp_dir().join("config-dir-override")
}

#[test]
fn valid_override_is_ignored_when_not_allowed() {
    let resolved = resolve_config_dir(Some(override_dir().into_os_string()), default_dir(), false);
    assert_eq!(resolved, default_dir());
}

#[test]
fn empty_override_falls_back_to_default() {
    let resolved = resolve_config_dir(Some(OsString::new()), default_dir(), true);
    assert_eq!(resolved, default_dir());
}

#[test]
fn relative_override_falls_back_to_default() {
    let resolved = resolve_config_dir(Some(OsString::from("rel/dir")), default_dir(), true);
    assert_eq!(resolved, default_dir());
}

#[test]
fn missing_override_falls_back_to_default() {
    assert_eq!(resolve_config_dir(None, default_dir(), true), default_dir());
}

#[test]
fn absolute_override_is_used_when_allowed() {
    let resolved = resolve_config_dir(Some(override_dir().into_os_string()), default_dir(), true);
    assert_eq!(resolved, override_dir());
}
