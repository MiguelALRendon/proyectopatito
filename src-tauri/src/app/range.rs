use thiserror::Error;

const BYTES_PER_MIB: u64 = 1024 * 1024;
pub const MAX_RESPONSE_BYTES: u64 = 32 * BYTES_PER_MIB;

const RANGE_UNIT: &str = "bytes";
const UNIT_SEPARATOR: char = '=';
const BOUND_SEPARATOR: char = '-';
const LIST_SEPARATOR: char = ',';

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Range {
    From(u64),
    Between(u64, u64),
    Suffix(u64),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum RangeError {
    #[error("la cabecera Range tiene una sintaxis inválida")]
    Invalid,
    #[error("solo se admite un rango en bytes por petición")]
    Unsupported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Slice {
    pub start: u64,
    pub len: u64,
    pub total: u64,
}

impl Slice {
    fn capped(start: u64, end: u64, total: u64, limit: u64) -> Self {
        Self {
            start,
            len: (end - start + 1).min(limit),
            total,
        }
    }

    pub fn content_range(&self) -> String {
        let last = self.start + self.len - 1;
        format!(
            "{RANGE_UNIT} {}{BOUND_SEPARATOR}{last}/{}",
            self.start, self.total
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Full(Slice),
    Partial(Slice),
    TooLarge,
    Unsatisfiable,
}

pub fn parse(header: &str) -> Result<Range, RangeError> {
    let (unit, spec) = header
        .trim()
        .split_once(UNIT_SEPARATOR)
        .ok_or(RangeError::Invalid)?;
    if !unit.eq_ignore_ascii_case(RANGE_UNIT) || spec.contains(LIST_SEPARATOR) {
        return Err(RangeError::Unsupported);
    }
    let (first, last) = spec
        .split_once(BOUND_SEPARATOR)
        .ok_or(RangeError::Invalid)?;
    match (parse_position(first)?, parse_position(last)?) {
        (None, None) => Err(RangeError::Invalid),
        (None, Some(len)) => Ok(Range::Suffix(len)),
        (Some(start), None) => Ok(Range::From(start)),
        (Some(start), Some(end)) if start > end => Err(RangeError::Invalid),
        (Some(start), Some(end)) => Ok(Range::Between(start, end)),
    }
}

fn parse_position(text: &str) -> Result<Option<u64>, RangeError> {
    if text.is_empty() {
        return Ok(None);
    }
    if !text.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(RangeError::Invalid);
    }
    Ok(Some(text.parse().unwrap_or(u64::MAX)))
}

pub fn plan(range: Option<Range>, total: u64) -> Outcome {
    plan_within(range, total, MAX_RESPONSE_BYTES)
}

pub fn plan_within(range: Option<Range>, total: u64, limit: u64) -> Outcome {
    match range {
        None => whole(total, limit),
        Some(range) => partial(range, total, limit),
    }
}

fn whole(total: u64, limit: u64) -> Outcome {
    if total > limit {
        return Outcome::TooLarge;
    }
    Outcome::Full(Slice {
        start: 0,
        len: total,
        total,
    })
}

fn partial(range: Range, total: u64, limit: u64) -> Outcome {
    match bounds(range, total) {
        Some((start, end)) => Outcome::Partial(Slice::capped(start, end, total, limit)),
        None => Outcome::Unsatisfiable,
    }
}

fn bounds(range: Range, total: u64) -> Option<(u64, u64)> {
    let last = total.checked_sub(1)?;
    match range {
        Range::From(start) | Range::Between(start, _) if start > last => None,
        Range::From(start) => Some((start, last)),
        Range::Between(start, end) => Some((start, end.min(last))),
        Range::Suffix(0) => None,
        Range::Suffix(len) => Some((total.saturating_sub(len), last)),
    }
}
