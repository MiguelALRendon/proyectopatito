use std::io;

use thiserror::Error;

use crate::svn::commands::{
    CheckoutRequest, CleanupRequest, CommitRequest, InfoRequest, StatusRequest, UpdateRequest,
};
use crate::svn::error::SvnError;
use crate::svn::message_file::MessageFile;
use crate::svn::models::{InfoEntry, StatusReport};
use crate::svn::parsers::{ParseError, parse_info, parse_status};
use crate::svn::progress::last_revision;
use crate::svn::runner::{RawOutput, RunOptions, SvnRunner};

#[derive(Debug, Error)]
pub enum SvnClientError {
    #[error(transparent)]
    Svn(#[from] SvnError),
    #[error(transparent)]
    Parse(#[from] ParseError),
    #[error("no se pudo preparar el mensaje de commit: {0}")]
    MessageFile(#[from] io::Error),
}

#[derive(Debug, Clone)]
pub struct SvnClient {
    runner: SvnRunner,
}

impl SvnClient {
    pub fn new(runner: SvnRunner) -> Self {
        Self { runner }
    }

    pub async fn info(
        &self,
        req: &InfoRequest,
        options: RunOptions,
    ) -> Result<InfoEntry, SvnClientError> {
        let output = self.runner.run(&req.args(), options).await?;
        Ok(parse_info(&output.stdout)?)
    }

    pub async fn status(
        &self,
        req: &StatusRequest,
        options: RunOptions,
    ) -> Result<StatusReport, SvnClientError> {
        let output = self.runner.run(&req.args(), options).await?;
        Ok(parse_status(&output.stdout)?)
    }

    pub async fn checkout(
        &self,
        req: &CheckoutRequest,
        options: RunOptions,
    ) -> Result<RawOutput, SvnClientError> {
        Ok(self.runner.run(&req.args(), options).await?)
    }

    pub async fn update(
        &self,
        req: &UpdateRequest,
        options: RunOptions,
    ) -> Result<RawOutput, SvnClientError> {
        Ok(self.runner.run(&req.args(), options).await?)
    }

    pub async fn commit(
        &self,
        req: &CommitRequest,
        options: RunOptions,
    ) -> Result<Option<u64>, SvnClientError> {
        let message_file = MessageFile::create(&req.message)?;
        let output = self
            .runner
            .run(&req.args(message_file.path()), options)
            .await?;
        Ok(last_revision(&String::from_utf8_lossy(&output.stdout)))
    }

    pub async fn cleanup(
        &self,
        req: &CleanupRequest,
        options: RunOptions,
    ) -> Result<RawOutput, SvnClientError> {
        Ok(self.runner.run(&req.args(), options).await?)
    }
}
