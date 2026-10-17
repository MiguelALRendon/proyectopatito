use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use serde::Serialize;
use thiserror::Error;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};
use tokio::sync::{Notify, OwnedMutexGuard};
use tokio::task::JoinHandle;

use crate::app::workspace::{ScopedPath, Workspace, WorkspaceError};
use crate::svn::client::{SvnClient, SvnClientError};
use crate::svn::commands::{
    CheckoutRequest, CleanupRequest, CommitRequest, InfoRequest, UpdateRequest,
    is_safe_checkout_url,
};
use crate::svn::error::{Captured, SvnError, SvnErrorKind};
use crate::svn::progress::{ProgressEvent, parse_progress_line};
use crate::svn::runner::{Password, RunOptions};

pub const OPERATION_TIMEOUT: Duration = Duration::from_secs(60 * 60);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
pub struct OperationId(pub u64);

pub type ProgressSink = Arc<dyn Fn(OperationId, ProgressEvent) + Send + Sync>;

#[derive(Clone)]
pub struct OperationContext {
    pub id: OperationId,
    pub progress: Option<ProgressSink>,
    pub password: Option<Password>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CommitOutcome {
    pub revision: Option<u64>,
}

#[derive(Debug, Error)]
pub enum OperationError {
    #[error(transparent)]
    Workspace(#[from] WorkspaceError),
    #[error(transparent)]
    Svn(#[from] SvnClientError),
    #[error("la URL de checkout no es valida")]
    InvalidUrl,
}

impl OperationError {
    pub fn svn_kind(&self) -> Option<SvnErrorKind> {
        match self {
            Self::Svn(SvnClientError::Svn(error)) => Some(error.kind),
            _ => None,
        }
    }

    fn is_interruption(&self) -> bool {
        matches!(
            self.svn_kind(),
            Some(SvnErrorKind::Cancelled | SvnErrorKind::TimedOut)
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
#[error("hay una operación en curso sobre la copia de trabajo")]
pub struct WorkingCopyBusy;

#[derive(Default)]
pub struct OperationManager {
    next_id: AtomicU64,
    cancels: Mutex<HashMap<OperationId, Arc<Notify>>>,
    locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    dirty: Mutex<HashSet<String>>,
}

impl OperationManager {
    pub fn begin(&self) -> (OperationId, Arc<Notify>) {
        let id = OperationId(self.next_id.fetch_add(1, Ordering::Relaxed));
        let signal = Arc::new(Notify::new());
        locked(&self.cancels).insert(id, signal.clone());
        (id, signal)
    }

    pub fn cancel(&self, id: OperationId) -> bool {
        let signal = locked(&self.cancels).get(&id).cloned();
        signal.is_some_and(|signal| {
            signal.notify_one();
            true
        })
    }

    pub fn finish(&self, id: OperationId) {
        locked(&self.cancels).remove(&id);
    }

    pub fn cancel_signal(&self, id: OperationId) -> Option<Arc<Notify>> {
        locked(&self.cancels).get(&id).cloned()
    }

    pub async fn lock_working_copy(&self, path: &Path) -> OwnedMutexGuard<()> {
        let mutex = locked(&self.locks)
            .entry(working_copy_key(path))
            .or_default()
            .clone();
        mutex.lock_owned().await
    }

    pub fn try_lock_for_write(
        &self,
        path: &Path,
    ) -> Result<Vec<OwnedMutexGuard<()>>, WorkingCopyBusy> {
        let reference = working_copy_key(path);
        let mut locks = locked(&self.locks);
        locks.entry(reference.clone()).or_default();
        locks
            .iter()
            .filter(|(key, _)| are_nested(key, &reference))
            .map(|(_, mutex)| mutex.clone().try_lock_owned().map_err(|_| WorkingCopyBusy))
            .collect()
    }

    pub fn mark_needs_cleanup(&self, path: &Path) {
        locked(&self.dirty).insert(working_copy_key(path));
    }

    pub fn needs_cleanup(&self, path: &Path) -> bool {
        locked(&self.dirty).contains(&working_copy_key(path))
    }

    pub fn clear_cleanup(&self, path: &Path) {
        locked(&self.dirty).remove(&working_copy_key(path));
    }
}

pub(crate) fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

pub(crate) fn working_copy_key(path: &Path) -> String {
    path.to_string_lossy().to_lowercase()
}

pub(crate) fn are_nested(key: &str, reference: &str) -> bool {
    let (key, reference) = (Path::new(key), Path::new(reference));
    key.starts_with(reference) || reference.starts_with(key)
}

#[derive(Clone)]
pub struct Operations {
    workspace: Workspace,
    client: SvnClient,
    manager: Arc<OperationManager>,
    timeout: Duration,
}

impl Operations {
    pub fn new(workspace: Workspace, client: SvnClient, manager: Arc<OperationManager>) -> Self {
        Self {
            workspace,
            client,
            manager,
            timeout: OPERATION_TIMEOUT,
        }
    }

    pub fn with_timeout(self, timeout: Duration) -> Self {
        Self { timeout, ..self }
    }

    pub fn timeout(&self) -> Duration {
        self.timeout
    }

    pub fn client(&self) -> &SvnClient {
        &self.client
    }

    pub fn manager(&self) -> &Arc<OperationManager> {
        &self.manager
    }

    pub async fn checkout(
        &self,
        dest: &ScopedPath,
        req: CheckoutRequest,
        ctx: &OperationContext,
    ) -> Result<u64, OperationError> {
        if !is_safe_checkout_url(&req.url) {
            return Err(OperationError::InvalidUrl);
        }
        let req = CheckoutRequest {
            dest: dest.as_path().to_path_buf(),
            ..req
        };
        self.guarded(dest, ctx, |options| async move {
            self.client.checkout(&req, options).await?;
            self.revision_of(dest).await
        })
        .await
    }

    pub async fn update(
        &self,
        target: &ScopedPath,
        req: UpdateRequest,
        ctx: &OperationContext,
    ) -> Result<u64, OperationError> {
        let req = UpdateRequest {
            target: target.as_path().to_path_buf(),
            ..req
        };
        self.guarded(target, ctx, |options| async move {
            self.client.update(&req, options).await?;
            self.revision_of(target).await
        })
        .await
    }

    pub async fn commit(
        &self,
        target: &ScopedPath,
        req: CommitRequest,
        ctx: &OperationContext,
    ) -> Result<CommitOutcome, OperationError> {
        let req = CommitRequest {
            target: target.as_path().to_path_buf(),
            ..req
        };
        self.guarded(target, ctx, |options| async move {
            let revision = self.client.commit(&req, options).await?;
            Ok(CommitOutcome { revision })
        })
        .await
    }

    pub async fn cleanup(
        &self,
        target: &ScopedPath,
        ctx: &OperationContext,
    ) -> Result<(), OperationError> {
        let req = CleanupRequest {
            target: target.as_path().to_path_buf(),
        };
        self.guarded(target, ctx, |options| async move {
            self.client.cleanup(&req, options).await?;
            self.manager.clear_cleanup(target.as_path());
            Ok(())
        })
        .await
    }

    async fn guarded<T, F, Fut>(
        &self,
        target: &ScopedPath,
        ctx: &OperationContext,
        run: F,
    ) -> Result<T, OperationError>
    where
        F: FnOnce(RunOptions) -> Fut,
        Fut: Future<Output = Result<T, SvnClientError>>,
    {
        let result = self.run_locked(target, ctx, run).await;
        self.manager.finish(ctx.id);
        result
    }

    async fn run_locked<T, F, Fut>(
        &self,
        target: &ScopedPath,
        ctx: &OperationContext,
        run: F,
    ) -> Result<T, OperationError>
    where
        F: FnOnce(RunOptions) -> Fut,
        Fut: Future<Output = Result<T, SvnClientError>>,
    {
        let _lock = self.acquire(target, ctx).await?;
        self.workspace.revalidate(target)?;
        let (progress, forwarder) = forward_progress(ctx).unzip();
        let result = run(self.run_options(ctx, progress)).await;
        if let Some(forwarder) = forwarder {
            forwarder.await.ok();
        }
        result.map_err(OperationError::from).inspect_err(|error| {
            if error.is_interruption() {
                self.manager.mark_needs_cleanup(target.as_path());
            }
        })
    }

    async fn acquire(
        &self,
        target: &ScopedPath,
        ctx: &OperationContext,
    ) -> Result<OwnedMutexGuard<()>, OperationError> {
        let lock = self.manager.lock_working_copy(target.as_path());
        let Some(signal) = self.manager.cancel_signal(ctx.id) else {
            return Ok(lock.await);
        };
        tokio::select! {
            biased;
            guard = lock => Ok(guard),
            () = signal.notified() => Err(cancelled_while_queued()),
        }
    }

    fn run_options(
        &self,
        ctx: &OperationContext,
        progress: Option<UnboundedSender<String>>,
    ) -> RunOptions {
        RunOptions {
            timeout: self.timeout,
            password: ctx.password.clone(),
            cancel: self.manager.cancel_signal(ctx.id),
            progress,
            ..RunOptions::default()
        }
    }

    async fn revision_of(&self, target: &ScopedPath) -> Result<u64, SvnClientError> {
        let req = InfoRequest {
            target: target.as_path().to_path_buf(),
        };
        let entry = self.client.info(&req, RunOptions::default()).await?;
        Ok(entry.revision)
    }
}

fn cancelled_while_queued() -> OperationError {
    let error = SvnError::interrupted(SvnErrorKind::Cancelled, &[], Captured::default());
    OperationError::Svn(SvnClientError::Svn(error))
}

fn forward_progress(ctx: &OperationContext) -> Option<(UnboundedSender<String>, JoinHandle<()>)> {
    let sink = ctx.progress.clone()?;
    let (sender, receiver) = unbounded_channel();
    Some((sender, tokio::spawn(relay(receiver, sink, ctx.id))))
}

async fn relay(mut lines: UnboundedReceiver<String>, sink: ProgressSink, id: OperationId) {
    while let Some(line) = lines.recv().await {
        sink(id, parse_progress_line(&line));
    }
}
