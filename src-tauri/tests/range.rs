use dakedaduck_svn_lib::app::range::{
    MAX_RESPONSE_BYTES, Outcome, Range, RangeError, Slice, parse, plan,
};

const TOTAL: u64 = 100;

fn slice(start: u64, len: u64, total: u64) -> Slice {
    Slice { start, len, total }
}

#[test]
fn a_header_without_the_bytes_unit_assignment_is_invalid() {
    for header in ["", "bytes", "0-9", "bytes 0-9", "garbage"] {
        assert_eq!(parse(header), Err(RangeError::Invalid), "{header:?}");
    }
}

#[test]
fn malformed_bounds_are_invalid() {
    for header in [
        "bytes=",
        "bytes=-",
        "bytes=abc-",
        "bytes=-abc",
        "bytes=1-2-3",
        "bytes=+1-2",
        "bytes=1 -2",
        "bytes=5-3",
        "bytes=0",
        "bytes=-1.5",
    ] {
        assert_eq!(parse(header), Err(RangeError::Invalid), "{header:?}");
    }
}

#[test]
fn several_ranges_or_another_unit_are_unsupported() {
    for header in [
        "bytes=0-1,4-5",
        "bytes=0-1,",
        "bytes=-5,0-0",
        "items=0-1",
        "bytes=a-b,c-d",
    ] {
        assert_eq!(parse(header), Err(RangeError::Unsupported), "{header:?}");
    }
}

#[test]
fn the_three_single_range_forms_are_parsed() {
    assert_eq!(parse("bytes=0-"), Ok(Range::From(0)));
    assert_eq!(parse("bytes=10-"), Ok(Range::From(10)));
    assert_eq!(parse("bytes=2-5"), Ok(Range::Between(2, 5)));
    assert_eq!(parse("bytes=7-7"), Ok(Range::Between(7, 7)));
    assert_eq!(parse("bytes=-5"), Ok(Range::Suffix(5)));
}

#[test]
fn the_unit_is_case_insensitive_and_the_value_is_trimmed() {
    assert_eq!(parse("  BYTES=1-2 "), Ok(Range::Between(1, 2)));
}

#[test]
fn a_position_beyond_u64_saturates_instead_of_failing() {
    let huge = "99999999999999999999999999";
    assert_eq!(parse(&format!("bytes={huge}-")), Ok(Range::From(u64::MAX)));
    assert_eq!(
        plan(Some(Range::From(u64::MAX)), TOTAL),
        Outcome::Unsatisfiable
    );
    assert_eq!(
        plan(Some(Range::Between(0, u64::MAX)), TOTAL),
        Outcome::Partial(slice(0, TOTAL, TOTAL))
    );
}

#[test]
fn a_start_at_or_past_the_end_is_unsatisfiable() {
    assert_eq!(
        plan(Some(Range::From(TOTAL)), TOTAL),
        Outcome::Unsatisfiable
    );
    assert_eq!(
        plan(Some(Range::From(TOTAL + 50)), TOTAL),
        Outcome::Unsatisfiable
    );
    assert_eq!(
        plan(Some(Range::Between(TOTAL, TOTAL + 5)), TOTAL),
        Outcome::Unsatisfiable
    );
}

#[test]
fn a_start_on_the_last_byte_is_satisfiable() {
    let last = TOTAL - 1;
    let expected = Outcome::Partial(slice(last, 1, TOTAL));
    assert_eq!(plan(Some(Range::From(last)), TOTAL), expected);
    assert_eq!(plan(Some(Range::Between(last, last)), TOTAL), expected);
    assert_eq!(
        plan(Some(Range::From(last - 1)), TOTAL),
        Outcome::Partial(slice(last - 1, 2, TOTAL))
    );
}

#[test]
fn a_zero_length_suffix_and_any_range_on_an_empty_file_are_unsatisfiable() {
    assert_eq!(plan(Some(Range::Suffix(0)), TOTAL), Outcome::Unsatisfiable);
    for range in [Range::From(0), Range::Between(0, 0), Range::Suffix(1)] {
        assert_eq!(plan(Some(range), 0), Outcome::Unsatisfiable);
    }
}

#[test]
fn an_end_past_the_file_is_clamped_to_the_last_byte() {
    assert_eq!(
        plan(Some(Range::Between(90, 500)), TOTAL),
        Outcome::Partial(slice(90, 10, TOTAL))
    );
}

#[test]
fn a_suffix_longer_than_the_file_returns_the_whole_file_as_206() {
    assert_eq!(
        plan(Some(Range::Suffix(TOTAL + 1)), TOTAL),
        Outcome::Partial(slice(0, TOTAL, TOTAL))
    );
}

#[test]
fn the_response_cap_is_exactly_32_mib() {
    assert_eq!(MAX_RESPONSE_BYTES, 33_554_432);
}

#[test]
fn a_range_larger_than_the_cap_is_truncated_not_refused() {
    let total = MAX_RESPONSE_BYTES * 2;
    assert_eq!(
        plan(Some(Range::From(0)), total),
        Outcome::Partial(slice(0, MAX_RESPONSE_BYTES, total))
    );
    assert_eq!(
        plan(Some(Range::Suffix(total)), total),
        Outcome::Partial(slice(0, MAX_RESPONSE_BYTES, total))
    );
}

#[test]
fn a_whole_file_over_the_cap_is_too_large_but_exactly_the_cap_is_served() {
    assert_eq!(plan(None, MAX_RESPONSE_BYTES + 1), Outcome::TooLarge);
    assert_eq!(
        plan(None, MAX_RESPONSE_BYTES),
        Outcome::Full(slice(0, MAX_RESPONSE_BYTES, MAX_RESPONSE_BYTES))
    );
}

#[test]
fn an_empty_file_without_range_is_served_whole() {
    assert_eq!(plan(None, 0), Outcome::Full(slice(0, 0, 0)));
}

#[test]
fn content_range_reports_inclusive_bounds_and_the_total() {
    assert_eq!(slice(2, 4, TOTAL).content_range(), "bytes 2-5/100");
    assert_eq!(slice(99, 1, TOTAL).content_range(), "bytes 99-99/100");
}

#[test]
fn open_ended_and_suffix_ranges_resolve_to_the_expected_bytes() {
    assert_eq!(
        plan(Some(Range::From(0)), TOTAL),
        Outcome::Partial(slice(0, TOTAL, TOTAL))
    );
    assert_eq!(
        plan(Some(Range::Suffix(5)), TOTAL),
        Outcome::Partial(slice(95, 5, TOTAL))
    );
    assert_eq!(
        plan(Some(Range::Between(10, 19)), TOTAL),
        Outcome::Partial(slice(10, 10, TOTAL))
    );
    assert_eq!(plan(None, TOTAL), Outcome::Full(slice(0, TOTAL, TOTAL)));
}
