use std::time::{Duration, Instant};

pub const CLOSE_TIMEOUT: Duration = Duration::from_secs(5);
pub const HOLD_KEEPALIVE_TIMEOUT: Duration = Duration::from_secs(6);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseDecision {
    CloseNow,
    AskFrontend,
    AlreadyAsking,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
enum Phase {
    #[default]
    Idle,
    Asked {
        since: Instant,
    },
    Deciding {
        since: Instant,
    },
}

impl Phase {
    fn limit(self) -> Option<(Instant, Duration)> {
        match self {
            Phase::Idle => None,
            Phase::Asked { since } => Some((since, CLOSE_TIMEOUT)),
            Phase::Deciding { since } => Some((since, HOLD_KEEPALIVE_TIMEOUT)),
        }
    }
}

#[derive(Debug, Default)]
pub struct Closing {
    frontend_ready: bool,
    phase: Phase,
}

impl Closing {
    pub fn mark_frontend_ready(&mut self) {
        self.frontend_ready = true;
        self.phase = Phase::Idle;
    }

    pub fn request_close(&mut self, now: Instant) -> CloseDecision {
        if !self.frontend_ready || self.has_expired(now) {
            return CloseDecision::CloseNow;
        }
        match self.phase {
            Phase::Idle => {
                self.phase = Phase::Asked { since: now };
                CloseDecision::AskFrontend
            }
            Phase::Asked { .. } | Phase::Deciding { .. } => CloseDecision::AlreadyAsking,
        }
    }

    pub fn hold(&mut self, now: Instant) {
        let is_asking = !matches!(self.phase, Phase::Idle);
        if is_asking && !self.has_expired(now) {
            self.phase = Phase::Deciding { since: now };
        }
    }

    pub fn confirm(&mut self) -> bool {
        let was_asked = self.phase != Phase::Idle;
        self.phase = Phase::Idle;
        was_asked
    }

    pub fn cancel(&mut self) {
        self.phase = Phase::Idle;
    }

    pub fn expire(&mut self, now: Instant) -> bool {
        let expired = self.has_expired(now);
        if expired {
            self.phase = Phase::Idle;
        }
        expired
    }

    pub fn remaining(&self, now: Instant) -> Option<Duration> {
        let (since, limit) = self.phase.limit()?;
        Some(limit.saturating_sub(now.saturating_duration_since(since)))
    }

    fn has_expired(&self, now: Instant) -> bool {
        self.remaining(now).is_some_and(|left| left.is_zero())
    }
}
