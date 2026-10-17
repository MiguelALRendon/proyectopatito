use std::time::{Duration, Instant};

use dakedaduck_svn_lib::app::closing::{
    CLOSE_TIMEOUT, CloseDecision, Closing, HOLD_KEEPALIVE_TIMEOUT,
};

const A_SECOND: Duration = Duration::from_secs(1);
const A_MILLISECOND: Duration = Duration::from_millis(1);
const JUST_BEFORE_TIMEOUT: Duration = Duration::from_millis(4_999);
const HEARTBEAT: Duration = Duration::from_secs(2);
const A_HOUR: Duration = Duration::from_secs(3_600);

fn ready() -> Closing {
    let mut closing = Closing::default();
    closing.mark_frontend_ready();
    closing
}

fn asked(at: Instant) -> Closing {
    let mut closing = ready();
    assert_eq!(closing.request_close(at), CloseDecision::AskFrontend);
    closing
}

#[test]
fn a_close_before_the_frontend_is_ready_closes_immediately() {
    let mut closing = Closing::default();
    assert_eq!(
        closing.request_close(Instant::now()),
        CloseDecision::CloseNow
    );
}

#[test]
fn a_frontend_that_never_answers_gets_closed_exactly_at_the_timeout() {
    let start = Instant::now();
    let mut closing = asked(start);
    assert!(!closing.expire(start + JUST_BEFORE_TIMEOUT));
    assert!(closing.expire(start + CLOSE_TIMEOUT));
}

#[test]
fn a_second_close_after_the_timeout_closes_without_waiting_for_the_timer() {
    let start = Instant::now();
    let mut closing = asked(start);
    assert_eq!(
        closing.request_close(start + CLOSE_TIMEOUT),
        CloseDecision::CloseNow
    );
}

#[test]
fn a_second_close_before_the_timeout_does_not_ask_again_nor_restart_the_clock() {
    let start = Instant::now();
    let mut closing = asked(start);
    assert_eq!(
        closing.request_close(start + A_SECOND),
        CloseDecision::AlreadyAsking
    );
    assert!(closing.expire(start + CLOSE_TIMEOUT));
}

#[test]
fn a_stale_timer_from_a_cancelled_request_does_not_close_a_newer_one() {
    let start = Instant::now();
    let mut closing = asked(start);
    closing.cancel();
    let second = start + A_SECOND * 2;
    assert_eq!(closing.request_close(second), CloseDecision::AskFrontend);
    assert!(!closing.expire(start + CLOSE_TIMEOUT));
    assert!(closing.expire(second + CLOSE_TIMEOUT));
}

#[test]
fn an_expired_request_closes_only_once() {
    let start = Instant::now();
    let mut closing = asked(start);
    assert!(closing.expire(start + CLOSE_TIMEOUT));
    assert!(!closing.expire(start + CLOSE_TIMEOUT * 2));
}

#[test]
fn nothing_expires_when_no_close_was_requested() {
    let mut closing = ready();
    assert!(!closing.expire(Instant::now() + CLOSE_TIMEOUT * 10));
}

#[test]
fn a_confirmation_without_a_request_is_ignored() {
    assert!(!ready().confirm());
    assert!(!Closing::default().confirm());
}

#[test]
fn a_confirmation_after_a_cancel_is_ignored() {
    let mut closing = asked(Instant::now());
    closing.cancel();
    assert!(!closing.confirm());
}

#[test]
fn a_confirmation_cannot_be_replayed() {
    let mut closing = asked(Instant::now());
    assert!(closing.confirm());
    assert!(!closing.confirm());
}

#[test]
fn cancelling_keeps_the_window_open_and_allows_asking_again() {
    let start = Instant::now();
    let mut closing = asked(start);
    closing.cancel();
    assert!(!closing.expire(start + CLOSE_TIMEOUT));
    assert_eq!(
        closing.request_close(start + A_SECOND),
        CloseDecision::AskFrontend
    );
}

#[test]
fn cancelling_without_a_request_changes_nothing() {
    let mut closing = ready();
    closing.cancel();
    assert_eq!(
        closing.request_close(Instant::now()),
        CloseDecision::AskFrontend
    );
}

fn held(at: Instant) -> Closing {
    let mut closing = asked(at);
    closing.hold(at);
    closing
}

#[test]
fn a_held_request_survives_the_close_timeout_but_not_the_keepalive_timeout() {
    let start = Instant::now();
    let mut closing = held(start);
    assert!(!closing.expire(start + HOLD_KEEPALIVE_TIMEOUT - A_MILLISECOND));
    assert!(closing.expire(start + HOLD_KEEPALIVE_TIMEOUT));
}

#[test]
fn a_heartbeat_keeps_the_decision_alive_far_beyond_the_old_ten_minute_limit() {
    let start = Instant::now();
    let mut closing = held(start);
    let mut beat = start;
    while beat < start + A_HOUR {
        beat += HEARTBEAT;
        assert!(!closing.expire(beat));
        closing.hold(beat);
    }
    assert!(!closing.expire(beat + HOLD_KEEPALIVE_TIMEOUT - A_MILLISECOND));
    assert_eq!(closing.request_close(beat), CloseDecision::AlreadyAsking);
}

#[test]
fn a_missing_heartbeat_expires_the_decision_one_keepalive_after_the_last_one() {
    let start = Instant::now();
    let mut closing = held(start);
    let last_beat = start + HEARTBEAT * 5;
    (1..=5).for_each(|beat| closing.hold(start + HEARTBEAT * beat));
    assert!(!closing.expire(last_beat + HOLD_KEEPALIVE_TIMEOUT - A_MILLISECOND));
    assert!(closing.expire(last_beat + HOLD_KEEPALIVE_TIMEOUT));
}

#[test]
fn a_dead_page_lets_the_next_close_through_one_keepalive_after_its_last_heartbeat() {
    let start = Instant::now();
    let mut closing = held(start);
    assert_eq!(
        closing.request_close(start + HOLD_KEEPALIVE_TIMEOUT - A_MILLISECOND),
        CloseDecision::AlreadyAsking
    );
    assert_eq!(
        closing.request_close(start + HOLD_KEEPALIVE_TIMEOUT),
        CloseDecision::CloseNow
    );
}

#[test]
fn a_second_close_while_the_page_decides_never_asks_again() {
    let start = Instant::now();
    let mut closing = held(start);
    let past_asked_timeout = start + CLOSE_TIMEOUT;
    assert_eq!(
        closing.request_close(past_asked_timeout),
        CloseDecision::AlreadyAsking
    );
    assert!(!closing.expire(past_asked_timeout));
}

#[test]
fn the_keepalive_clock_starts_when_the_hold_arrives_not_when_the_close_was_asked() {
    let start = Instant::now();
    let hold_at = start + A_SECOND * 3;
    let mut closing = asked(start);
    closing.hold(hold_at);
    assert!(!closing.expire(start + HOLD_KEEPALIVE_TIMEOUT));
    assert!(closing.expire(hold_at + HOLD_KEEPALIVE_TIMEOUT));
}

#[test]
fn a_hold_after_the_close_timeout_cannot_revive_an_expired_request() {
    let start = Instant::now();
    let mut closing = asked(start);
    closing.hold(start + CLOSE_TIMEOUT);
    assert!(closing.expire(start + CLOSE_TIMEOUT));
}

#[test]
fn a_late_heartbeat_cannot_revive_an_expired_decision() {
    let start = Instant::now();
    let mut closing = held(start);
    closing.hold(start + HOLD_KEEPALIVE_TIMEOUT);
    assert!(closing.expire(start + HOLD_KEEPALIVE_TIMEOUT));
}

#[test]
fn a_heartbeat_after_the_decision_ended_does_not_start_a_new_one() {
    let start = Instant::now();
    let mut closing = held(start);
    closing.cancel();
    closing.hold(start + A_SECOND);
    assert!(!closing.expire(start + HOLD_KEEPALIVE_TIMEOUT * 2));
    assert!(!closing.confirm());
}

#[test]
fn remaining_reports_the_time_left_of_the_current_phase() {
    let start = Instant::now();
    assert_eq!(ready().remaining(start), None);
    let mut closing = asked(start);
    assert_eq!(
        closing.remaining(start + A_SECOND),
        Some(CLOSE_TIMEOUT - A_SECOND)
    );
    closing.hold(start);
    assert_eq!(
        closing.remaining(start + A_SECOND),
        Some(HOLD_KEEPALIVE_TIMEOUT - A_SECOND)
    );
    assert_eq!(
        closing.remaining(start + HOLD_KEEPALIVE_TIMEOUT * 2),
        Some(Duration::ZERO)
    );
}

#[test]
fn a_held_request_can_still_be_confirmed_or_cancelled() {
    let mut confirmed = held(Instant::now());
    assert!(confirmed.confirm());
    let mut cancelled = held(Instant::now());
    cancelled.cancel();
    assert!(!cancelled.confirm());
}

#[test]
fn holding_without_a_request_neither_asks_nor_blocks_the_next_close() {
    let mut closing = ready();
    closing.hold(Instant::now());
    assert!(!closing.confirm());
    assert_eq!(
        closing.request_close(Instant::now()),
        CloseDecision::AskFrontend
    );
}

#[test]
fn a_reloaded_frontend_clears_a_request_left_pending_by_the_previous_page() {
    let start = Instant::now();
    let mut closing = held(start);
    closing.mark_frontend_ready();
    assert_eq!(
        closing.request_close(start + A_SECOND),
        CloseDecision::AskFrontend
    );
}

#[test]
fn a_ready_frontend_is_asked_and_its_confirmation_closes_the_window() {
    let mut closing = ready();
    assert_eq!(
        closing.request_close(Instant::now()),
        CloseDecision::AskFrontend
    );
    assert!(closing.confirm());
}
