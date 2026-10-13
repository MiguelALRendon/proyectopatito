use std::ffi::OsString;
use std::fmt;
use std::future::pending;
use std::io;
use std::path::PathBuf;
use std::process::{Output, Stdio};
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdout, Command};
use tokio::sync::Notify;
use tokio::sync::mpsc::UnboundedSender;

use crate::svn::error::{Captured, SvnError, SvnErrorKind};

pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(120);
const NON_INTERACTIVE_FLAG: &str = "--non-interactive";
const PASSWORD_FROM_STDIN_FLAG: &str = "--password-from-stdin";
const LINE_END: &[u8] = b"\n";
const LINE_DELIMITER: u8 = b'\n';
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone)]
pub struct SvnRunner {
    pub binary: PathBuf,
}

#[derive(Clone)]
pub struct Password(String);

impl Password {
    fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Password {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Password(***)")
    }
}

impl From<String> for Password {
    fn from(value: String) -> Self {
        Self(value)
    }
}

impl From<&str> for Password {
    fn from(value: &str) -> Self {
        Self(value.to_string())
    }
}

#[derive(Debug, Clone)]
pub struct RunOptions {
    pub cwd: Option<PathBuf>,
    pub timeout: Duration,
    pub password: Option<Password>,
    pub cancel: Option<Arc<Notify>>,
    pub progress: Option<UnboundedSender<String>>,
}

impl Default for RunOptions {
    fn default() -> Self {
        Self {
            cwd: None,
            timeout: DEFAULT_TIMEOUT,
            password: None,
            cancel: None,
            progress: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct RawOutput {
    pub stdout: Vec<u8>,
    pub stderr: String,
    pub exit_code: i32,
}

enum Outcome {
    Finished(io::Result<Output>),
    Interrupted(SvnErrorKind),
}

impl SvnRunner {
    pub fn new(binary: PathBuf) -> Self {
        Self { binary }
    }

    pub async fn run(&self, args: &[OsString], options: RunOptions) -> Result<RawOutput, SvnError> {
        let mut argv = args.to_vec();
        if options.password.is_some() {
            argv.push(PASSWORD_FROM_STDIN_FLAG.into());
        }
        argv.push(NON_INTERACTIVE_FLAG.into());
        let mut child = self
            .spawn(&argv, &options)
            .await
            .map_err(|error| SvnError::spawn_failed(&argv, error))?;
        let outcome = supervise(&mut child, &options).await;
        into_result(&argv, outcome)
    }

    async fn spawn(&self, argv: &[OsString], options: &RunOptions) -> io::Result<Child> {
        let mut command = Command::new(&self.binary);
        command
            .args(argv)
            .kill_on_drop(true)
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(stdin_mode(options.password.as_ref()));
        if let Some(dir) = &options.cwd {
            command.current_dir(dir);
        }
        let mut child = command.spawn()?;
        if let Some(password) = &options.password {
            write_password(&mut child, password.expose()).await;
        }
        Ok(child)
    }
}

async fn supervise(child: &mut Child, options: &RunOptions) -> Outcome {
    let outcome = tokio::select! {
        result = collect(child, options.progress.as_ref()) => Outcome::Finished(result),
        () = tokio::time::sleep(options.timeout) => Outcome::Interrupted(SvnErrorKind::TimedOut),
        () = cancelled(options.cancel.as_deref()) => Outcome::Interrupted(SvnErrorKind::Cancelled),
    };
    if matches!(outcome, Outcome::Interrupted(_)) {
        child.kill().await.ok();
    }
    outcome
}

async fn collect(
    child: &mut Child,
    progress: Option<&UnboundedSender<String>>,
) -> io::Result<Output> {
    let (stdout, stderr) = tokio::join!(
        read_stdout(child.stdout.take(), progress),
        read_stderr(child.stderr.take())
    );
    let status = child.wait().await?;
    Ok(Output {
        status,
        stdout: stdout?,
        stderr: stderr?,
    })
}

async fn read_stdout(
    pipe: Option<ChildStdout>,
    progress: Option<&UnboundedSender<String>>,
) -> io::Result<Vec<u8>> {
    let Some(pipe) = pipe else {
        return Ok(Vec::new());
    };
    let mut reader = BufReader::new(pipe);
    let mut collected = Vec::new();
    loop {
        let line_start = collected.len();
        if reader.read_until(LINE_DELIMITER, &mut collected).await? == 0 {
            return Ok(collected);
        }
        report_line(progress, &collected[line_start..]);
    }
}

fn report_line(progress: Option<&UnboundedSender<String>>, line: &[u8]) {
    let Some(sender) = progress else {
        return;
    };
    sender.send(decode_stderr(line).trim_end().to_string()).ok();
}

async fn read_stderr(pipe: Option<ChildStderr>) -> io::Result<Vec<u8>> {
    let mut collected = Vec::new();
    if let Some(mut pipe) = pipe {
        pipe.read_to_end(&mut collected).await?;
    }
    Ok(collected)
}

fn stdin_mode(password: Option<&Password>) -> Stdio {
    match password {
        Some(_) => Stdio::piped(),
        None => Stdio::null(),
    }
}

async fn write_password(child: &mut Child, password: &str) {
    let Some(mut stdin) = child.stdin.take() else {
        return;
    };
    // si el hijo sale antes de leer, su exit code ya reporta el fallo
    stdin.write_all(password.as_bytes()).await.ok();
    stdin.write_all(LINE_END).await.ok();
}

async fn cancelled(cancel: Option<&Notify>) {
    match cancel {
        Some(notify) => notify.notified().await,
        None => pending().await,
    }
}

fn into_result(argv: &[OsString], outcome: Outcome) -> Result<RawOutput, SvnError> {
    match outcome {
        Outcome::Interrupted(kind) => Err(SvnError::interrupted(kind, argv, Captured::default())),
        Outcome::Finished(Err(error)) => Err(SvnError::spawn_failed(argv, error)),
        Outcome::Finished(Ok(output)) => from_output(argv, output),
    }
}

fn from_output(argv: &[OsString], output: Output) -> Result<RawOutput, SvnError> {
    let stderr = decode_stderr(&output.stderr);
    if output.status.success() {
        return Ok(RawOutput {
            stdout: output.stdout,
            stderr,
            exit_code: 0,
        });
    }
    let captured = Captured {
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr,
        exit_code: output.status.code(),
    };
    Err(SvnError::from_process(argv, captured))
}

pub fn decode_stderr(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_string(),
        Err(_) => bytes.iter().map(|&byte| char::from(byte)).collect(),
    }
}
