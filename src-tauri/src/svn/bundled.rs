use std::collections::HashSet;
use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::svn::locator::SVN_EXE;

pub const MANIFEST_JSON: &str = include_str!("../../../third_party/svn.manifest.json");
pub const BUNDLE_DIR: &str = "svn";

#[derive(Deserialize)]
struct Manifest {
    files: Vec<Entry>,
}

#[derive(Deserialize)]
struct Entry {
    name: String,
    bytes: u64,
    sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum BundleProblem {
    #[error("el manifiesto del svn incluido no se pudo leer")]
    BadManifest,
    #[error("falta {0}")]
    Missing(String),
    #[error("{0} no coincide con el manifiesto")]
    Changed(String),
    #[error("{0} no figura en el manifiesto")]
    Unexpected(String),
    #[error("no arranca")]
    Unusable,
}

fn hash_of(path: &Path) -> io::Result<String> {
    let mut hasher = Sha256::new();
    io::copy(&mut File::open(path)?, &mut hasher)?;
    Ok(format!("{:x}", hasher.finalize()))
}

fn check_entry(dir: &Path, entry: &Entry) -> Result<(), BundleProblem> {
    let path = dir.join(&entry.name);
    let metadata = fs::metadata(&path).map_err(|_| BundleProblem::Missing(entry.name.clone()))?;
    let is_intact = metadata.is_file()
        && metadata.len() == entry.bytes
        && hash_of(&path).is_ok_and(|hash| hash.eq_ignore_ascii_case(&entry.sha256));
    if is_intact {
        Ok(())
    } else {
        Err(BundleProblem::Changed(entry.name.clone()))
    }
}

fn check_no_strangers(dir: &Path, manifest: &Manifest) -> Result<(), BundleProblem> {
    let known: HashSet<String> = manifest
        .files
        .iter()
        .map(|entry| entry.name.to_ascii_lowercase())
        .collect();
    let entries = fs::read_dir(dir).map_err(|_| BundleProblem::Missing(SVN_EXE.to_owned()))?;
    for item in entries.flatten() {
        let name = item.file_name().to_string_lossy().to_ascii_lowercase();
        let is_file = item.file_type().is_ok_and(|kind| !kind.is_dir());
        if is_file && !known.contains(&name) {
            return Err(BundleProblem::Unexpected(name));
        }
    }
    Ok(())
}

pub fn verify(dir: &Path, manifest_json: &str) -> Result<PathBuf, BundleProblem> {
    let manifest: Manifest =
        serde_json::from_str(manifest_json).map_err(|_| BundleProblem::BadManifest)?;
    if !manifest
        .files
        .iter()
        .any(|entry| entry.name.eq_ignore_ascii_case(SVN_EXE))
    {
        return Err(BundleProblem::Missing(SVN_EXE.to_owned()));
    }
    for entry in &manifest.files {
        check_entry(dir, entry)?;
    }
    check_no_strangers(dir, &manifest)?;
    Ok(dir.join(SVN_EXE))
}
