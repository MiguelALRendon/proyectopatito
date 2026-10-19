use std::fs;
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
            Err(error) => {
                self.discard(&destination);
                Err(error)
            }
        }
    }

    fn finished(&self, report: ExtractReport, dir: &ScopedPath, relative: &Path) -> ExtractReport {
        self.statuses.invalidate(dir.as_path());
        ExtractReport {
            destination: relative.to_string_lossy().into_owned(),
            ..report
        }
    }

    fn discard(&self, dir: &ScopedPath) {
        if self.workspace.revalidate(dir).is_ok() {
            fs::remove_dir_all(dir.as_path()).ok();
        }
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
