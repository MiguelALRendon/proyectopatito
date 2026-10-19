const KIB: u64 = 1024;
const MIB: u64 = 1024 * KIB;
const GIB: u64 = 1024 * MIB;

pub const MAX_ARCHIVE_ENTRIES: usize = 50_000;
pub const MAX_LISTED_ENTRIES: usize = 5_000;
pub const MAX_EXTRACT_BYTES: u64 = 4 * GIB;
pub const MAX_ENTRY_BYTES: u64 = 2 * GIB;
pub const MAX_RAR_MEMBER_BYTES: u64 = 256 * MIB;
pub const MAX_RAR_HEADER_BYTES: u64 = 16 * MIB;
pub const MAX_7Z_BLOCK_BYTES: u64 = 256 * MIB;
pub const MAX_7Z_HEADER_BYTES: u64 = 16 * MIB;
pub const MAX_EXTRACT_RATIO: u64 = 200;
pub const RATIO_MIN_DECLARED_BYTES: u64 = 16 * MIB;
pub const SUSPICIOUS_DEPTH: usize = 32;
pub const MAX_ENTRY_DEPTH: usize = 64;
pub const MAX_COMPONENT_LEN: usize = 255;
pub const MAX_PATH_LEN: usize = 240;
pub const MAX_LIST_READ_BYTES: u64 = 4 * GIB;
pub const XZ_MEMORY_LIMIT_BYTES: u64 = 256 * MIB;
pub const MAX_SKIPPED_REPORTED: usize = 1000;
pub const MAX_SUFFIX_ATTEMPTS: u32 = 999;
pub const PROGRESS_INTERVAL_MS: u128 = 100;
pub const ERROR_DISK_FULL: i32 = 112;

#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub entry_bytes: u64,
    pub extract_bytes: u64,
    pub ratio_min_bytes: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            entry_bytes: MAX_ENTRY_BYTES,
            extract_bytes: MAX_EXTRACT_BYTES,
            ratio_min_bytes: RATIO_MIN_DECLARED_BYTES,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_published_limits_keep_their_values() {
        assert_eq!(MAX_EXTRACT_BYTES, 4_294_967_296);
        assert_eq!(MAX_ENTRY_BYTES, 2_147_483_648);
        assert_eq!(MAX_RAR_MEMBER_BYTES, 268_435_456);
        assert_eq!(MAX_RAR_HEADER_BYTES, 16_777_216);
        assert_eq!(MAX_7Z_BLOCK_BYTES, 268_435_456);
        assert_eq!(MAX_7Z_HEADER_BYTES, 16_777_216);
        assert_eq!(RATIO_MIN_DECLARED_BYTES, 16_777_216);
        assert_eq!(MAX_LIST_READ_BYTES, 4_294_967_296);
        assert_eq!(XZ_MEMORY_LIMIT_BYTES, 268_435_456);
        let defaults = Limits::default();
        assert_eq!(
            (
                defaults.entry_bytes,
                defaults.extract_bytes,
                defaults.ratio_min_bytes
            ),
            (MAX_ENTRY_BYTES, MAX_EXTRACT_BYTES, RATIO_MIN_DECLARED_BYTES)
        );
    }
}
