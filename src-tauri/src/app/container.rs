use std::io::{self, ErrorKind, Read, Seek, SeekFrom};

const ZIP_EOCD_SIGNATURE: [u8; 4] = *b"PK\x05\x06";
const ZIP_CENTRAL_SIGNATURE: [u8; 4] = *b"PK\x01\x02";
const ZIP_LOCAL_SIGNATURE: [u8; 4] = *b"PK\x03\x04";
const ZIP_EOCD_LEN: usize = 22;
const ZIP_MAX_COMMENT_LEN: usize = u16::MAX as usize;
const ZIP_CENTRAL_FIXED_LEN: usize = 46;
const ZIP_LOCAL_FIXED_LEN: usize = 30;
const ZIP_MAX_ENTRIES: usize = 20_000;
const ZIP_MAX_DIRECTORY_BYTES: u64 = 4 * 1024 * 1024;
const ZIP64_ENTRIES: u16 = u16::MAX;
const ZIP64_FIELD: u32 = u32::MAX;
const ZIP_STORED: u16 = 0;

const OLE2_SIGNATURE: [u8; 8] = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
const OLE2_HEADER_LEN: usize = 512;
const OLE2_BYTE_ORDER: [u8; 2] = [0xFE, 0xFF];
const OLE2_SECTOR_SHIFTS: [(u16, u16); 2] = [(3, 9), (4, 12)];
const OLE2_HEADER_FAT_SLOTS: usize = 109;
const OLE2_MAX_DIFAT_SECTORS: usize = 1024;
const OLE2_MAX_DIRECTORY_SECTORS: usize = 1024;
const OLE2_LAST_REGULAR_SECTOR: u32 = 0xFFFF_FFFA;
const OLE2_ENTRY_LEN: usize = 128;
const OLE2_NAME_FIELD_LEN: usize = 64;
const OLE2_TYPES_WITH_NAME: [u8; 3] = [1, 2, 5];
const UTF16_UNIT_BYTES: usize = 2;
const U32_BYTES: usize = 4;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ZipEntry {
    pub name: String,
    pub method: u16,
    pub compressed_size: u32,
    pub local_offset: u32,
}

#[derive(Debug, Clone, Copy)]
struct ZipEnd {
    position: u64,
    entries: u16,
    directory_size: u32,
    directory_offset: u32,
}

pub fn has_zip_local_signature(bytes: &[u8]) -> bool {
    bytes.starts_with(&ZIP_LOCAL_SIGNATURE)
}

pub fn has_ole2_signature(bytes: &[u8]) -> bool {
    bytes.starts_with(&OLE2_SIGNATURE)
}

pub fn read_zip_directory<R: Read + Seek>(
    reader: &mut R,
    len: u64,
) -> io::Result<Option<Vec<ZipEntry>>> {
    let Some(end) = find_zip_end(reader, len)? else {
        return Ok(None);
    };
    let Some(size) = end.directory_bytes() else {
        return Ok(None);
    };
    reader.seek(SeekFrom::Start(u64::from(end.directory_offset)))?;
    let mut directory = vec![0; size];
    reader.read_exact(&mut directory)?;
    Ok(parse_central_directory(
        &directory,
        usize::from(end.entries),
    ))
}

pub fn read_stored_entry<R: Read + Seek>(
    reader: &mut R,
    entry: &ZipEntry,
    max_len: usize,
) -> io::Result<Option<Vec<u8>>> {
    if entry.method != ZIP_STORED || entry.compressed_size as usize > max_len {
        return Ok(None);
    }
    reader.seek(SeekFrom::Start(u64::from(entry.local_offset)))?;
    let mut header = [0; ZIP_LOCAL_FIXED_LEN];
    if !read_or_none(reader, &mut header)? || !header.starts_with(&ZIP_LOCAL_SIGNATURE) {
        return Ok(None);
    }
    let skip = i64::from(u16_le(&header, 26)) + i64::from(u16_le(&header, 28));
    reader.seek(SeekFrom::Current(skip))?;
    let mut data = vec![0; entry.compressed_size as usize];
    Ok(read_or_none(reader, &mut data)?.then_some(data))
}

fn read_or_none<R: Read>(reader: &mut R, buffer: &mut [u8]) -> io::Result<bool> {
    match reader.read_exact(buffer) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == ErrorKind::UnexpectedEof => Ok(false),
        Err(error) => Err(error),
    }
}

fn find_zip_end<R: Read + Seek>(reader: &mut R, len: u64) -> io::Result<Option<ZipEnd>> {
    let tail_len = len.min((ZIP_EOCD_LEN + ZIP_MAX_COMMENT_LEN) as u64);
    if tail_len < ZIP_EOCD_LEN as u64 {
        return Ok(None);
    }
    let start = len - tail_len;
    reader.seek(SeekFrom::Start(start))?;
    let mut tail = vec![0; tail_len as usize];
    reader.read_exact(&mut tail)?;
    Ok(last_zip_end(&tail).map(|(at, end)| ZipEnd {
        position: start + at as u64,
        ..end
    }))
}

fn last_zip_end(tail: &[u8]) -> Option<(usize, ZipEnd)> {
    (0..=tail.len() - ZIP_EOCD_LEN)
        .rev()
        .filter(|at| tail[*at..].starts_with(&ZIP_EOCD_SIGNATURE))
        .find(|at| usize::from(u16_le(tail, at + 20)) == tail.len() - at - ZIP_EOCD_LEN)
        .map(|at| (at, zip_end_at(tail, at)))
}

fn zip_end_at(tail: &[u8], at: usize) -> ZipEnd {
    ZipEnd {
        position: 0,
        entries: u16_le(tail, at + 10),
        directory_size: u32_le(tail, at + 12),
        directory_offset: u32_le(tail, at + 16),
    }
}

impl ZipEnd {
    fn directory_bytes(&self) -> Option<usize> {
        let uses_zip64 = self.entries == ZIP64_ENTRIES
            || self.directory_size == ZIP64_FIELD
            || self.directory_offset == ZIP64_FIELD;
        let end = u64::from(self.directory_offset) + u64::from(self.directory_size);
        let fits = end <= self.position
            && u64::from(self.directory_size) <= ZIP_MAX_DIRECTORY_BYTES
            && usize::from(self.entries) <= ZIP_MAX_ENTRIES
            && self.directory_size as usize >= usize::from(self.entries) * ZIP_CENTRAL_FIXED_LEN;
        (!uses_zip64 && fits).then_some(self.directory_size as usize)
    }
}

fn parse_central_directory(directory: &[u8], count: usize) -> Option<Vec<ZipEntry>> {
    let mut entries = Vec::with_capacity(count);
    let mut at = 0;
    for _ in 0..count {
        let header = directory.get(at..at + ZIP_CENTRAL_FIXED_LEN)?;
        if !header.starts_with(&ZIP_CENTRAL_SIGNATURE) {
            return None;
        }
        let name_len = usize::from(u16_le(header, 28));
        let name =
            directory.get(at + ZIP_CENTRAL_FIXED_LEN..at + ZIP_CENTRAL_FIXED_LEN + name_len)?;
        entries.push(ZipEntry {
            name: String::from_utf8_lossy(name).into_owned(),
            method: u16_le(header, 10),
            compressed_size: u32_le(header, 20),
            local_offset: u32_le(header, 42),
        });
        let variable = name_len + usize::from(u16_le(header, 30)) + usize::from(u16_le(header, 32));
        at += ZIP_CENTRAL_FIXED_LEN + variable;
    }
    Some(entries)
}

struct Ole2 {
    sector_len: u64,
    first_directory: u32,
    fat_sectors: Vec<u32>,
}

pub fn read_ole2_names<R: Read + Seek>(
    reader: &mut R,
    len: u64,
) -> io::Result<Option<Vec<String>>> {
    reader.seek(SeekFrom::Start(0))?;
    let mut header = [0; OLE2_HEADER_LEN];
    if len < OLE2_HEADER_LEN as u64 || !read_or_none(reader, &mut header)? {
        return Ok(None);
    }
    let Some(mut ole2) = parse_ole2_header(&header) else {
        return Ok(None);
    };
    if !collect_extra_fat_sectors(reader, &header, &mut ole2, len)? {
        return Ok(None);
    }
    walk_ole2_directory(reader, &ole2, len)
}

fn parse_ole2_header(header: &[u8; OLE2_HEADER_LEN]) -> Option<Ole2> {
    let major = u16_le(header, 0x1A);
    let shift = u16_le(header, 0x1E);
    let coherent = header.starts_with(&OLE2_SIGNATURE)
        && header[0x1C..0x1E] == OLE2_BYTE_ORDER
        && OLE2_SECTOR_SHIFTS.contains(&(major, shift));
    coherent.then(|| Ole2 {
        sector_len: 1 << shift,
        first_directory: u32_le(header, 0x30),
        fat_sectors: (0..OLE2_HEADER_FAT_SLOTS)
            .map(|slot| u32_le(header, 0x4C + slot * U32_BYTES))
            .take_while(|sector| *sector <= OLE2_LAST_REGULAR_SECTOR)
            .collect(),
    })
}

fn collect_extra_fat_sectors<R: Read + Seek>(
    reader: &mut R,
    header: &[u8; OLE2_HEADER_LEN],
    ole2: &mut Ole2,
    len: u64,
) -> io::Result<bool> {
    let mut next = u32_le(header, 0x44);
    let declared = u32_le(header, 0x48) as usize;
    if declared > OLE2_MAX_DIFAT_SECTORS {
        return Ok(false);
    }
    for _ in 0..declared {
        let Some(sector) = read_sector(reader, ole2, next, len)? else {
            return Ok(false);
        };
        let slots = sector.len() / U32_BYTES - 1;
        let ids = (0..slots).map(|slot| u32_le(&sector, slot * U32_BYTES));
        ole2.fat_sectors
            .extend(ids.take_while(|id| *id <= OLE2_LAST_REGULAR_SECTOR));
        next = u32_le(&sector, slots * U32_BYTES);
    }
    Ok(true)
}

fn read_sector<R: Read + Seek>(
    reader: &mut R,
    ole2: &Ole2,
    sector: u32,
    len: u64,
) -> io::Result<Option<Vec<u8>>> {
    let at = (u64::from(sector) + 1) * ole2.sector_len;
    if sector > OLE2_LAST_REGULAR_SECTOR || at + ole2.sector_len > len {
        return Ok(None);
    }
    reader.seek(SeekFrom::Start(at))?;
    let mut data = vec![0; ole2.sector_len as usize];
    Ok(read_or_none(reader, &mut data)?.then_some(data))
}

fn next_sector<R: Read + Seek>(
    reader: &mut R,
    ole2: &Ole2,
    sector: u32,
    len: u64,
) -> io::Result<Option<u32>> {
    let per_fat = ole2.sector_len as usize / U32_BYTES;
    let Some(fat) = ole2.fat_sectors.get(sector as usize / per_fat) else {
        return Ok(None);
    };
    let Some(data) = read_sector(reader, ole2, *fat, len)? else {
        return Ok(None);
    };
    Ok(Some(u32_le(&data, (sector as usize % per_fat) * U32_BYTES)))
}

fn walk_ole2_directory<R: Read + Seek>(
    reader: &mut R,
    ole2: &Ole2,
    len: u64,
) -> io::Result<Option<Vec<String>>> {
    let mut names = Vec::new();
    let mut sector = ole2.first_directory;
    for _ in 0..OLE2_MAX_DIRECTORY_SECTORS {
        let Some(data) = read_sector(reader, ole2, sector, len)? else {
            return Ok(None);
        };
        names.extend(
            data.chunks_exact(OLE2_ENTRY_LEN)
                .filter_map(ole2_entry_name),
        );
        match next_sector(reader, ole2, sector, len)? {
            Some(next) if next <= OLE2_LAST_REGULAR_SECTOR => sector = next,
            Some(_) => return Ok(Some(names)),
            None => return Ok(None),
        }
    }
    Ok(None)
}

fn ole2_entry_name(entry: &[u8]) -> Option<String> {
    let name_len = usize::from(u16_le(entry, OLE2_NAME_FIELD_LEN));
    let valid = OLE2_TYPES_WITH_NAME.contains(&entry[OLE2_NAME_FIELD_LEN + 2])
        && (UTF16_UNIT_BYTES..=OLE2_NAME_FIELD_LEN).contains(&name_len)
        && name_len % UTF16_UNIT_BYTES == 0;
    if !valid {
        return None;
    }
    let units: Vec<u16> = entry[..name_len - UTF16_UNIT_BYTES]
        .chunks_exact(UTF16_UNIT_BYTES)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect();
    Some(String::from_utf16_lossy(&units))
}

fn u16_le(bytes: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([bytes[at], bytes[at + 1]])
}

fn u32_le(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    const FREE: u32 = 0xFFFF_FFFF;
    const END: u32 = 0xFFFF_FFFE;
    const SECTOR: usize = 512;
    const LOCAL_EXTRA: usize = 4;
    const CENTRAL_EXTRA: usize = 3;
    const CENTRAL_COMMENT: usize = 2;

    fn zip_with(parts: &[(&str, &[u8])], comment: &[u8]) -> Vec<u8> {
        let mut file = Vec::new();
        let mut central = Vec::new();
        for (name, data) in parts {
            let offset = file.len() as u32;
            let mut local = vec![0u8; ZIP_LOCAL_FIXED_LEN];
            local[..4].copy_from_slice(&ZIP_LOCAL_SIGNATURE);
            local[18..22].copy_from_slice(&(data.len() as u32).to_le_bytes());
            local[26..28].copy_from_slice(&(name.len() as u16).to_le_bytes());
            local[28..30].copy_from_slice(&(LOCAL_EXTRA as u16).to_le_bytes());
            file.extend(local);
            file.extend(name.bytes());
            file.extend([9u8; LOCAL_EXTRA]);
            file.extend(*data);
            let mut header = vec![0u8; ZIP_CENTRAL_FIXED_LEN];
            header[..4].copy_from_slice(&ZIP_CENTRAL_SIGNATURE);
            header[20..24].copy_from_slice(&(data.len() as u32).to_le_bytes());
            header[28..30].copy_from_slice(&(name.len() as u16).to_le_bytes());
            header[30..32].copy_from_slice(&(CENTRAL_EXTRA as u16).to_le_bytes());
            header[32..34].copy_from_slice(&(CENTRAL_COMMENT as u16).to_le_bytes());
            header[42..46].copy_from_slice(&offset.to_le_bytes());
            central.extend(header);
            central.extend(name.bytes());
            central.extend([7u8; CENTRAL_EXTRA + CENTRAL_COMMENT]);
        }
        let directory_offset = file.len() as u32;
        file.extend(&central);
        let mut end = vec![0u8; ZIP_EOCD_LEN];
        end[..4].copy_from_slice(&ZIP_EOCD_SIGNATURE);
        end[10..12].copy_from_slice(&(parts.len() as u16).to_le_bytes());
        end[12..16].copy_from_slice(&(central.len() as u32).to_le_bytes());
        end[16..20].copy_from_slice(&directory_offset.to_le_bytes());
        end[20..22].copy_from_slice(&(comment.len() as u16).to_le_bytes());
        file.extend(end);
        file.extend(comment);
        file
    }

    fn read_directory(bytes: &[u8]) -> Option<Vec<ZipEntry>> {
        let len = bytes.len() as u64;
        read_zip_directory(&mut Cursor::new(bytes), len).unwrap()
    }

    fn two_files() -> Vec<u8> {
        zip_with(&[("a.txt", b"hello"), ("dir/b.bin", b"world!!")], b"hi")
    }

    #[test]
    fn signatures_are_recognised_only_at_the_start() {
        assert!(has_zip_local_signature(&ZIP_LOCAL_SIGNATURE));
        assert!(!has_zip_local_signature(b"not a zip"));
        assert!(has_ole2_signature(&OLE2_SIGNATURE));
        assert!(!has_ole2_signature(b"not ole2 at all"));
    }

    #[test]
    fn a_stored_zip_lists_names_sizes_and_offsets() {
        let entries = read_directory(&two_files()).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["a.txt", "dir/b.bin"]);
        assert_eq!(entries[0].compressed_size, 5);
        assert_eq!(entries[1].compressed_size, 7);
        assert_eq!(entries[0].local_offset, 0);
        let second = ZIP_LOCAL_FIXED_LEN + 5 + LOCAL_EXTRA + 5;
        assert_eq!(entries[1].local_offset as usize, second);
    }

    #[test]
    fn a_zip_with_no_entries_is_only_its_end_record() {
        let empty = zip_with(&[], b"");
        assert_eq!(empty.len(), ZIP_EOCD_LEN);
        assert_eq!(read_directory(&empty), Some(vec![]));
    }

    #[test]
    fn the_end_record_whose_comment_fits_exactly_wins() {
        let mut fake = ZIP_EOCD_SIGNATURE.to_vec();
        fake.extend([0u8; 30]);
        let bytes = zip_with(&[("a.txt", b"hello")], &fake);
        assert_eq!(read_directory(&bytes).unwrap().len(), 1);
    }

    #[test]
    fn a_file_shorter_than_an_end_record_is_not_a_zip() {
        assert_eq!(read_directory(&[0u8; ZIP_EOCD_LEN - 1]), None);
    }

    fn end_with(entries: u16, size: u32, offset: u32, position: u64) -> ZipEnd {
        ZipEnd {
            position,
            entries,
            directory_size: size,
            directory_offset: offset,
        }
    }

    #[test]
    fn the_directory_must_end_before_the_end_record() {
        assert_eq!(end_with(1, 46, 0, 46).directory_bytes(), Some(46));
        assert_eq!(end_with(1, 46, 0, 45).directory_bytes(), None);
    }

    #[test]
    fn the_directory_must_hold_a_header_for_every_entry() {
        assert_eq!(end_with(2, 92, 0, 1000).directory_bytes(), Some(92));
        assert_eq!(end_with(2, 91, 0, 1000).directory_bytes(), None);
        assert_eq!(end_with(2, 60, 0, 1000).directory_bytes(), None);
    }

    #[test]
    fn the_directory_size_is_capped_at_four_mebibytes() {
        let cap = 4 * 1024 * 1024;
        let huge = 1u64 << 40;
        assert_eq!(
            end_with(1, 2 * 1024 * 1024, 0, huge).directory_bytes(),
            Some(2 * 1024 * 1024)
        );
        assert_eq!(
            end_with(1, cap, 0, huge).directory_bytes(),
            Some(cap as usize)
        );
        assert_eq!(end_with(1, cap + 1, 0, huge).directory_bytes(), None);
    }

    #[test]
    fn a_zip_directory_cannot_declare_more_than_20000_entries() {
        let huge = 1u64 << 40;
        let size = |entries: u32| entries * ZIP_CENTRAL_FIXED_LEN as u32;
        assert!(
            end_with(20_000, size(20_000), 0, huge)
                .directory_bytes()
                .is_some()
        );
        assert_eq!(
            end_with(20_001, size(20_001), 0, huge).directory_bytes(),
            None
        );
    }

    #[test]
    fn zip64_markers_are_refused_each_on_its_own() {
        let huge = 1u64 << 40;
        assert_eq!(end_with(1, 46, ZIP64_FIELD, huge).directory_bytes(), None);
        assert_eq!(end_with(1, ZIP64_FIELD, 0, huge).directory_bytes(), None);
        assert_eq!(end_with(ZIP64_ENTRIES, 46, 0, huge).directory_bytes(), None);
    }

    #[test]
    fn a_central_header_that_is_not_one_ends_the_listing() {
        let mut bytes = two_files();
        let directory = bytes.len()
            - ZIP_EOCD_LEN
            - 2
            - (2 * (ZIP_CENTRAL_FIXED_LEN + CENTRAL_EXTRA + CENTRAL_COMMENT) + 5 + 9);
        bytes[directory] = b'X';
        assert_eq!(read_directory(&bytes), None);
    }

    fn entry_of(bytes: &[u8], index: usize) -> ZipEntry {
        read_directory(bytes).unwrap().remove(index)
    }

    fn stored(bytes: &[u8], entry: &ZipEntry, max_len: usize) -> Option<Vec<u8>> {
        read_stored_entry(&mut Cursor::new(bytes), entry, max_len).unwrap()
    }

    #[test]
    fn a_stored_entry_is_read_past_its_name_and_extra_field() {
        let bytes = two_files();
        assert_eq!(
            stored(&bytes, &entry_of(&bytes, 0), 100),
            Some(b"hello".to_vec())
        );
        assert_eq!(
            stored(&bytes, &entry_of(&bytes, 1), 100),
            Some(b"world!!".to_vec())
        );
    }

    #[test]
    fn the_stored_entry_size_limit_is_inclusive() {
        let bytes = two_files();
        let entry = entry_of(&bytes, 0);
        assert!(stored(&bytes, &entry, 5).is_some());
        assert!(stored(&bytes, &entry, 4).is_none());
    }

    #[test]
    fn a_compressed_entry_is_not_read() {
        let bytes = two_files();
        let mut entry = entry_of(&bytes, 0);
        entry.method = 8;
        assert!(stored(&bytes, &entry, 100).is_none());
    }

    #[test]
    fn an_offset_that_is_not_a_local_header_is_refused() {
        let bytes = two_files();
        let mut entry = entry_of(&bytes, 0);
        entry.local_offset = 1;
        assert!(stored(&bytes, &entry, 100).is_none());
    }

    #[test]
    fn a_local_header_with_a_damaged_signature_is_refused() {
        let mut bytes = two_files();
        let entry = entry_of(&bytes, 0);
        bytes[0] = b'X';
        assert!(stored(&bytes, &entry, 100).is_none());
    }

    #[test]
    fn a_truncated_entry_is_refused_without_an_error() {
        let bytes = two_files();
        let entry = entry_of(&bytes, 0);
        let cut = ZIP_LOCAL_FIXED_LEN + 5 + LOCAL_EXTRA + 2;
        assert!(stored(&bytes[..cut], &entry, 100).is_none());
    }

    struct Broken;

    impl Read for Broken {
        fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
            Err(io::Error::other("disco roto"))
        }
    }

    #[test]
    fn only_a_short_read_is_swallowed_and_other_errors_propagate() {
        let mut buffer = [0u8; 4];
        assert!(read_or_none(&mut Broken, &mut buffer).is_err());
        assert!(!read_or_none(&mut &[1u8, 2][..], &mut buffer).unwrap());
        assert!(read_or_none(&mut &[1u8, 2, 3, 4][..], &mut buffer).unwrap());
    }

    fn ole2_header(first_directory: u32, fat: &[u32], difat: (u32, u32)) -> [u8; OLE2_HEADER_LEN] {
        let mut header = [0u8; OLE2_HEADER_LEN];
        header[..8].copy_from_slice(&OLE2_SIGNATURE);
        header[0x1A..0x1C].copy_from_slice(&3u16.to_le_bytes());
        header[0x1C..0x1E].copy_from_slice(&OLE2_BYTE_ORDER);
        header[0x1E..0x20].copy_from_slice(&9u16.to_le_bytes());
        header[0x30..0x34].copy_from_slice(&first_directory.to_le_bytes());
        header[0x44..0x48].copy_from_slice(&difat.0.to_le_bytes());
        header[0x48..0x4C].copy_from_slice(&difat.1.to_le_bytes());
        for slot in 0..OLE2_HEADER_FAT_SLOTS {
            let value = fat.get(slot).copied().unwrap_or(FREE);
            let at = 0x4C + slot * U32_BYTES;
            header[at..at + U32_BYTES].copy_from_slice(&value.to_le_bytes());
        }
        header
    }

    fn sector_of(ids: &[u32], next: u32) -> Vec<u8> {
        let slots = SECTOR / U32_BYTES - 1;
        let mut sector = Vec::new();
        for slot in 0..slots {
            sector.extend(ids.get(slot).copied().unwrap_or(FREE).to_le_bytes());
        }
        sector.extend(next.to_le_bytes());
        sector
    }

    fn ole2() -> Ole2 {
        Ole2 {
            sector_len: SECTOR as u64,
            first_directory: 0,
            fat_sectors: vec![],
        }
    }

    #[test]
    fn the_header_lists_its_fat_sectors_in_order() {
        let parsed = parse_ole2_header(&ole2_header(7, &[5, 6], (END, 0))).unwrap();
        assert_eq!(parsed.fat_sectors, [5, 6]);
        assert_eq!(parsed.first_directory, 7);
        assert_eq!(parsed.sector_len, SECTOR as u64);
    }

    #[test]
    fn extra_fat_sectors_are_followed_through_the_difat_chain() {
        let full: Vec<u32> = (100..100 + 127).collect();
        let mut file = ole2_header(0, &[], (0, 2)).to_vec();
        file.extend(sector_of(&full, 1));
        file.extend(sector_of(&[300], END));
        let mut parsed = ole2();
        let header = ole2_header(0, &[], (0, 2));
        let len = file.len() as u64;
        assert!(
            collect_extra_fat_sectors(&mut Cursor::new(&file), &header, &mut parsed, len).unwrap()
        );
        let mut expected = full.clone();
        expected.push(300);
        assert_eq!(parsed.fat_sectors, expected);
    }

    fn difat_chain(sectors: usize) -> Vec<u8> {
        let mut file = vec![0u8; SECTOR];
        for index in 0..sectors {
            file.extend(sector_of(&[], index as u32 + 1));
        }
        file
    }

    fn follows_difat(declared: u32, sectors: usize) -> bool {
        let file = difat_chain(sectors);
        let header = ole2_header(0, &[], (0, declared));
        let mut parsed = ole2();
        let len = file.len() as u64;
        collect_extra_fat_sectors(&mut Cursor::new(&file), &header, &mut parsed, len).unwrap()
    }

    #[test]
    fn the_difat_chain_is_capped_at_1024_sectors() {
        assert!(follows_difat(1024, 1025));
        assert!(!follows_difat(1025, 1025));
    }

    #[test]
    fn a_sector_must_end_inside_the_file() {
        let mut file = vec![0u8; SECTOR];
        file.extend(sector_of(&[], END));
        let parsed = ole2();
        let sector = |len: u64| read_sector(&mut Cursor::new(&file), &parsed, 0, len).unwrap();
        assert!(sector(file.len() as u64).is_some());
        assert!(sector(file.len() as u64 - 1).is_none());
    }

    #[test]
    fn the_next_sector_is_found_in_the_right_fat_sector() {
        let mut file = vec![0u8; SECTOR];
        file.extend(sector_of(&[], END));
        let mut second = vec![FREE; SECTOR / U32_BYTES];
        second[2] = 77;
        file.extend(second.iter().flat_map(|id| id.to_le_bytes()));
        let parsed = Ole2 {
            fat_sectors: vec![0, 1],
            ..ole2()
        };
        let len = file.len() as u64;
        let next = next_sector(&mut Cursor::new(&file), &parsed, 130, len).unwrap();
        assert_eq!(next, Some(77));
    }

    fn named_entry(name: &str, kind: u8, name_len: Option<u16>) -> Vec<u8> {
        let mut entry = vec![0u8; OLE2_ENTRY_LEN];
        let units: Vec<u8> = name
            .encode_utf16()
            .chain([0])
            .flat_map(u16::to_le_bytes)
            .collect();
        entry[..units.len()].copy_from_slice(&units);
        let declared = name_len.unwrap_or(units.len() as u16);
        entry[OLE2_NAME_FIELD_LEN..OLE2_NAME_FIELD_LEN + 2]
            .copy_from_slice(&declared.to_le_bytes());
        entry[OLE2_NAME_FIELD_LEN + 2] = kind;
        entry
    }

    #[test]
    fn a_directory_entry_needs_a_known_type_and_a_sane_name_length() {
        assert_eq!(
            ole2_entry_name(&named_entry("WordDocument", 2, None)).as_deref(),
            Some("WordDocument")
        );
        assert_eq!(
            ole2_entry_name(&named_entry("Root Entry", 5, None)).as_deref(),
            Some("Root Entry")
        );
        assert_eq!(ole2_entry_name(&named_entry("Libre", 0, None)), None);
        assert_eq!(ole2_entry_name(&named_entry("Impar", 2, Some(11))), None);
        assert_eq!(ole2_entry_name(&named_entry("Corto", 2, Some(0))), None);
        assert_eq!(ole2_entry_name(&named_entry("Largo", 2, Some(66))), None);
    }
}
