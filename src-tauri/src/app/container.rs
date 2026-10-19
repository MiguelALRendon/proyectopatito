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
