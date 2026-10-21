use std::fs;
use std::io;
use std::os::windows::fs::MetadataExt;
use std::path::Path;
use std::sync::Arc;

use super::extract::{self, ExtractReport, Job, ProgressSink};
use super::limits::{Limits, MAX_SUFFIX_ATTEMPTS};
use super::listing::{self, ArchiveListing, exceeds};
use super::{ArchiveError, ArchiveFormat, Cancel, folder_stem};
use crate::app::files::{is_cloud_only, is_forbidden_name};
use crate::app::operations::OperationManager;
use crate::app::wc_status::StatusCache;
use crate::app::workspace::{ScopedPath, Workspace, WorkspaceError, component_keys};

const FALLBACK_FOLDER: &str = "extraido";

#[derive(Debug, Clone, Copy, Default)]
pub struct ExtractOptions {
    pub allow_suspicious: bool,
}

struct Source {
    file: ScopedPath,
    format: ArchiveFormat,
    name: String,
}

#[derive(Clone)]
pub struct ArchiveService {
    workspace: Workspace,
    manager: Arc<OperationManager>,
    statuses: Arc<StatusCache>,
    limits: Limits,
}

impl ArchiveService {
    pub fn new(workspace: Workspace, manager: Arc<OperationManager>) -> Self {
        Self {
            workspace,
            manager,
            statuses: Arc::default(),
            limits: Limits::default(),
        }
    }

    pub fn with_limits(self, limits: Limits) -> Self {
        Self { limits, ..self }
    }

    pub fn with_statuses(self, statuses: Arc<StatusCache>) -> Self {
        Self { statuses, ..self }
    }

    pub fn list(&self, path: &Path, cancel: &Cancel) -> Result<ArchiveListing, ArchiveError> {
        let source = self.open_source(path)?;
        listing::list(source.file.as_path(), source.format, cancel, &self.limits)
    }

    pub fn extract(
        &self,
        path: &Path,
        options: ExtractOptions,
        cancel: &Cancel,
        on_progress: ProgressSink,
    ) -> Result<ExtractReport, ArchiveError> {
        let source = self.open_source(path)?;
        let listing = listing::list(source.file.as_path(), source.format, cancel, &self.limits)?;
        preflight(&listing, options, &self.limits)?;
        let destination = self.free_destination(&source)?;
        let _lease = self.manager.try_lock_for_write(destination.as_path())?;
        fs::create_dir(destination.as_path())?;
        let relative = self.workspace.relative_path(destination.as_path());
        let job = Job {
            archive: source.file.as_path(),
            format: source.format,
            destination: relative.clone(),
            total_bytes: listing.declared_bytes,
            limits: self.limits,
        };
        match extract::run(&self.workspace, &job, cancel, on_progress) {
            Ok(report) => Ok(self.finished(report, &destination, &relative)),
            Err(error) => Err(self.rolled_back(error, &destination, &relative)),
        }
    }

    fn finished(&self, report: ExtractReport, dir: &ScopedPath, relative: &Path) -> ExtractReport {
        self.statuses.invalidate(dir.as_path());
        ExtractReport {
            destination: relative.to_string_lossy().into_owned(),
            ..report
        }
    }

    fn rolled_back(&self, error: ArchiveError, dir: &ScopedPath, relative: &Path) -> ArchiveError {
        self.statuses.invalidate(dir.as_path());
        match self.discard(dir) {
            Ok(()) => error,
            Err(left) => ArchiveError::Io(io::Error::other(format!(
                "{error}; además no se pudo borrar lo extraído en «{}»: {left}",
                relative.display()
            ))),
        }
    }

    fn discard(&self, dir: &ScopedPath) -> io::Result<()> {
        self.workspace.revalidate(dir).map_err(io::Error::other)?;
        fs::remove_dir_all(dir.as_path())
    }

    fn open_source(&self, path: &Path) -> Result<Source, ArchiveError> {
        let file = self.workspace.resolve(path, true)?;
        let relative = self.workspace.relative_path(file.as_path());
        if component_keys(&relative)
            .iter()
            .any(|key| is_forbidden_name(key))
        {
            return Err(ArchiveError::UnsafeEntry(
                "ruta administrativa de Subversion".to_owned(),
            ));
        }
        let metadata = fs::symlink_metadata(file.as_path())?;
        if !metadata.is_file() || is_cloud_only(metadata.file_attributes()) {
            return Err(ArchiveError::Unsupported(
                "no es un archivo local disponible".to_owned(),
            ));
        }
        let name = file_name_of(file.as_path());
        let format = ArchiveFormat::of_file_name(&name)
            .ok_or_else(|| ArchiveError::Unsupported("extensión no reconocida".to_owned()))?;
        Ok(Source { file, format, name })
    }

    fn free_destination(&self, source: &Source) -> Result<ScopedPath, ArchiveError> {
        let relative = self.workspace.relative_path(source.file.as_path());
        let parent = relative.parent().unwrap_or_else(|| Path::new(""));
        let stem = match folder_stem(&source.name) {
            stem if stem.is_empty() => FALLBACK_FOLDER.to_owned(),
            stem => stem,
        };
        for attempt in 1..=MAX_SUFFIX_ATTEMPTS {
            let name = if attempt == 1 {
                stem.clone()
            } else {
                format!("{stem}-{attempt}")
            };
            match self.workspace.resolve(&parent.join(name), false) {
                Err(WorkspaceError::DestinationExists) => {}
                other => return Ok(other?),
            }
        }
        Err(ArchiveError::Limit(
            "demasiadas carpetas de destino repetidas".to_owned(),
        ))
    }
}

fn file_name_of(path: &Path) -> String {
    path.file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}

fn preflight(
    listing: &ArchiveListing,
    options: ExtractOptions,
    limits: &Limits,
) -> Result<(), ArchiveError> {
    if listing.encrypted {
        return Err(ArchiveError::Encrypted);
    }
    if exceeds(listing.declared_bytes, listing.largest_entry_bytes, limits) {
        return Err(ArchiveError::Limit(
            "declara más datos de los permitidos".to_owned(),
        ));
    }
    if !listing.suspicions.is_empty() && !options.allow_suspicious {
        return Err(ArchiveError::NeedsConfirmation(listing.suspicions.clone()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::windows::fs::OpenOptionsExt;
    use std::process::Command;

    #[test]
    fn a_destination_that_left_the_workspace_is_not_deleted() {
        let dir = tempfile::tempdir().unwrap();
        let (root, outside) = (dir.path().join("raiz"), dir.path().join("fuera"));
        fs::create_dir(&root).unwrap();
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("a.txt"), b"x").unwrap();
        let workspace = Workspace::new(&root).unwrap();
        let service = ArchiveService::new(workspace.clone(), Arc::default());
        let target = workspace.resolve(Path::new("d"), false).unwrap();
        let link = Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(target.as_path())
            .arg(&outside)
            .status()
            .unwrap();
        assert!(link.success());
        assert!(service.discard(&target).is_err());
        assert!(outside.join("a.txt").exists());
    }

    #[test]
    fn a_rollback_that_cannot_delete_everything_says_what_is_left() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::new(dir.path()).unwrap();
        let service = ArchiveService::new(workspace.clone(), Arc::default());
        let target = workspace.resolve(Path::new("d"), false).unwrap();
        fs::create_dir(target.as_path()).unwrap();
        let held = target.as_path().join("abierto.bin");
        let _lock = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .share_mode(0)
            .open(&held)
            .unwrap();
        let outcome = service.rolled_back(ArchiveError::Cancelled, &target, Path::new("d"));
        let ArchiveError::Io(why) = outcome else {
            panic!("debía avisar de lo que quedó: {outcome:?}");
        };
        assert!(why.to_string().contains("operación cancelada"));
        assert!(why.to_string().contains("«d»"));
        assert!(held.exists());
    }

    #[test]
    fn a_clean_rollback_keeps_the_original_error() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::new(dir.path()).unwrap();
        let service = ArchiveService::new(workspace.clone(), Arc::default());
        let target = workspace.resolve(Path::new("d"), false).unwrap();
        fs::create_dir(target.as_path()).unwrap();
        let outcome = service.rolled_back(ArchiveError::Cancelled, &target, Path::new("d"));
        assert!(matches!(outcome, ArchiveError::Cancelled));
    }

    #[test]
    fn a_destination_inside_the_workspace_is_deleted() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::new(dir.path()).unwrap();
        let service = ArchiveService::new(workspace.clone(), Arc::default());
        let target = workspace.resolve(Path::new("d"), false).unwrap();
        fs::create_dir(target.as_path()).unwrap();
        fs::write(target.as_path().join("a.txt"), b"x").unwrap();
        assert!(service.discard(&target).is_ok());
        assert!(!target.as_path().exists());
    }
}
