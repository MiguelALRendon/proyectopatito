use std::ffi::OsString;
use std::fmt;
use std::io;
use std::time::SystemTime;

use thiserror::Error;

pub const CODE_AUTH_REQUIRED: &str = "E170001";
pub const CODE_UNTRUSTED_CERTIFICATE: &str = "E230001";
pub const CODE_WORKING_COPY_TOO_OLD: &str = "E155036";
pub const CODE_WORKING_COPY_LOCKED: &str = "E155004";

const CODE_LEN: usize = 7;
const CODE_PREFIX: char = 'E';
const STDERR_LINE_PREFIX: &str = "svn: ";
const PASSWORD_FLAG: &str = "--password";
const PASSWORD_FLAG_EQUALS: &str = "--password=";
const REDACTED: &str = "***";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SvnErrorKind {
    AuthRequired,
    UntrustedCertificate,
    WorkingCopyTooOld,
    WorkingCopyLocked,
    Cancelled,
    TimedOut,
    Other,
}

impl SvnErrorKind {
    pub fn from_codes(codes: &[String]) -> Self {
        codes
            .iter()
            .find_map(|code| Self::from_code(code))
            .unwrap_or(Self::Other)
    }

    fn from_code(code: &str) -> Option<Self> {
        match code {
            CODE_AUTH_REQUIRED => Some(Self::AuthRequired),
            CODE_UNTRUSTED_CERTIFICATE => Some(Self::UntrustedCertificate),
            CODE_WORKING_COPY_TOO_OLD => Some(Self::WorkingCopyTooOld),
            CODE_WORKING_COPY_LOCKED => Some(Self::WorkingCopyLocked),
            _ => None,
        }
    }
}

impl fmt::Display for SvnErrorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::AuthRequired => "se requiere autenticacion",
            Self::UntrustedCertificate => "el certificado del servidor no es confiable",
            Self::WorkingCopyTooOld => "la copia de trabajo tiene un formato antiguo",
            Self::WorkingCopyLocked => "la copia de trabajo esta bloqueada",
            Self::Cancelled => "operacion cancelada",
            Self::TimedOut => "la operacion excedio el tiempo limite",
            Self::Other => "svn termino con error",
        };
        f.write_str(message)
    }
}

#[derive(Debug, Clone, Default)]
pub struct Captured {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Error)]
#[error("{kind}")]
pub struct SvnError {
    pub codes: Vec<String>,
    pub kind: SvnErrorKind,
    pub command: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub timestamp: SystemTime,
}

impl SvnError {
    pub fn from_process(args: &[OsString], captured: Captured) -> Self {
        let codes = extract_codes(&captured.stderr);
        let kind = SvnErrorKind::from_codes(&codes);
        Self::build((kind, codes), args, captured)
    }

    pub fn interrupted(kind: SvnErrorKind, args: &[OsString], captured: Captured) -> Self {
        Self::build((kind, Vec::new()), args, captured)
    }

    pub fn spawn_failed(args: &[OsString], error: io::Error) -> Self {
        let captured = Captured {
            stderr: error.to_string(),
            ..Captured::default()
        };
        Self::build((SvnErrorKind::Other, Vec::new()), args, captured)
    }

    fn build(
        (kind, codes): (SvnErrorKind, Vec<String>),
        args: &[OsString],
        captured: Captured,
    ) -> Self {
        Self {
            codes,
            kind,
            command: redact_command(args),
            stdout: captured.stdout,
            stderr: captured.stderr,
            exit_code: captured.exit_code,
            timestamp: SystemTime::now(),
        }
    }
}

pub fn extract_codes(stderr: &str) -> Vec<String> {
    stderr.lines().filter_map(parse_code_line).collect()
}

fn parse_code_line(line: &str) -> Option<String> {
    let rest = line.trim().strip_prefix(STDERR_LINE_PREFIX)?;
    let (code, _) = rest.split_once(':')?;
    is_error_code(code).then(|| code.to_string())
}

fn is_error_code(code: &str) -> bool {
    code.len() == CODE_LEN
        && code.starts_with(CODE_PREFIX)
        && code[1..].bytes().all(|byte| byte.is_ascii_digit())
}

pub fn redact_command(args: &[OsString]) -> String {
    let mut redact_next = false;
    let parts: Vec<String> = args
        .iter()
        .map(|arg| redact_arg(&arg.to_string_lossy(), &mut redact_next))
        .collect();
    parts.join(" ")
}

fn redact_arg(arg: &str, redact_next: &mut bool) -> String {
    if std::mem::take(redact_next) {
        return REDACTED.to_string();
    }
    if arg == PASSWORD_FLAG {
        *redact_next = true;
    }
    if arg.starts_with(PASSWORD_FLAG_EQUALS) {
        return format!("{PASSWORD_FLAG_EQUALS}{REDACTED}");
    }
    arg.to_string()
}
