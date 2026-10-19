use std::io::Write;

const ZIP_LOCAL: [u8; 4] = *b"PK\x03\x04";
const ZIP_CENTRAL: [u8; 4] = *b"PK\x01\x02";
const ZIP_END: [u8; 4] = *b"PK\x05\x06";
const ZIP_VERSION: u16 = 20;
const OLE2_SIGNATURE: [u8; 8] = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
const OLE2_SECTOR: usize = 512;
const OLE2_ENTRIES_PER_SECTOR: usize = 4;
const OLE2_ENTRY: usize = 128;
const FAT_SECTOR: u32 = 0xFFFF_FFFD;
const END_OF_CHAIN: u32 = 0xFFFF_FFFE;
const FREE_SECTOR: u32 = 0xFFFF_FFFF;
const TAR_BLOCK: usize = 512;

pub const MIME_ODT: &str = "application/vnd.oasis.opendocument.text";
pub const MIME_ODS: &str = "application/vnd.oasis.opendocument.spreadsheet";
pub const MIME_ODP: &str = "application/vnd.oasis.opendocument.presentation";

pub fn zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut file = Vec::new();
    let mut central = Vec::new();
    for (name, data) in entries {
        let offset = file.len() as u32;
        file.extend(local_entry(name, data));
        central.extend(central_entry(name, data.len() as u32, offset));
    }
    let directory_offset = file.len() as u32;
    file.extend(&central);
    file.extend(end_record(
        entries.len() as u16,
        central.len() as u32,
        directory_offset,
    ));
    file
}

fn local_entry(name: &str, data: &[u8]) -> Vec<u8> {
    let mut entry = ZIP_LOCAL.to_vec();
    entry.extend(ZIP_VERSION.to_le_bytes());
    entry.extend([0; 2 + 2 + 2 + 2 + 4]);
    entry.extend((data.len() as u32).to_le_bytes());
    entry.extend((data.len() as u32).to_le_bytes());
    entry.extend((name.len() as u16).to_le_bytes());
    entry.extend([0; 2]);
    entry.extend(name.as_bytes());
    entry.extend(data);
    entry
}

fn central_entry(name: &str, size: u32, offset: u32) -> Vec<u8> {
    let mut entry = ZIP_CENTRAL.to_vec();
    entry.extend(ZIP_VERSION.to_le_bytes());
    entry.extend(ZIP_VERSION.to_le_bytes());
    entry.extend([0; 2 + 2 + 2 + 2 + 4]);
    entry.extend(size.to_le_bytes());
    entry.extend(size.to_le_bytes());
    entry.extend((name.len() as u16).to_le_bytes());
    entry.extend([0; 2 + 2 + 2 + 2 + 4]);
    entry.extend(offset.to_le_bytes());
    entry.extend(name.as_bytes());
    entry
}

pub fn end_record(entries: u16, size: u32, offset: u32) -> Vec<u8> {
    let mut end = ZIP_END.to_vec();
    end.extend([0; 4]);
    end.extend(entries.to_le_bytes());
    end.extend(entries.to_le_bytes());
    end.extend(size.to_le_bytes());
    end.extend(offset.to_le_bytes());
    end.extend([0; 2]);
    end
}

pub fn docx(extra: &[(&str, &[u8])]) -> Vec<u8> {
    ooxml("word/document.xml", extra)
}

pub fn xlsx(extra: &[(&str, &[u8])]) -> Vec<u8> {
    ooxml("xl/workbook.xml", extra)
}

pub fn pptx(extra: &[(&str, &[u8])]) -> Vec<u8> {
    ooxml("ppt/presentation.xml", extra)
}

fn ooxml(main_part: &str, extra: &[(&str, &[u8])]) -> Vec<u8> {
    let mut entries: Vec<(&str, &[u8])> =
        vec![("[Content_Types].xml", b"<Types/>"), (main_part, b"<x/>")];
    entries.extend_from_slice(extra);
    zip(&entries)
}

pub fn odf(mime: &str, extra: &[(&str, &[u8])]) -> Vec<u8> {
    let mut entries: Vec<(&str, &[u8])> =
        vec![("mimetype", mime.as_bytes()), ("content.xml", b"<x/>")];
    entries.extend_from_slice(extra);
    zip(&entries)
}

pub fn ole2(names: &[&str]) -> Vec<u8> {
    let mut entries = vec![directory_entry("Root Entry", 5)];
    entries.extend(names.iter().map(|name| directory_entry(name, 2)));
    let sectors = entries.len().div_ceil(OLE2_ENTRIES_PER_SECTOR);
    let mut file = ole2_header();
    file.extend(fat_sector(sectors));
    for sector in 0..sectors {
        let mut data = vec![0; OLE2_SECTOR];
        for (slot, entry) in entries
            .iter()
            .skip(sector * OLE2_ENTRIES_PER_SECTOR)
            .take(OLE2_ENTRIES_PER_SECTOR)
            .enumerate()
        {
            data[slot * OLE2_ENTRY..(slot + 1) * OLE2_ENTRY].copy_from_slice(entry);
        }
        file.extend(data);
    }
    file
}

fn ole2_header() -> Vec<u8> {
    let mut header = vec![0; OLE2_SECTOR];
    header[..8].copy_from_slice(&OLE2_SIGNATURE);
    header[0x18..0x1A].copy_from_slice(&0x3Eu16.to_le_bytes());
    header[0x1A..0x1C].copy_from_slice(&3u16.to_le_bytes());
    header[0x1C..0x1E].copy_from_slice(&[0xFE, 0xFF]);
    header[0x1E..0x20].copy_from_slice(&9u16.to_le_bytes());
    header[0x20..0x22].copy_from_slice(&6u16.to_le_bytes());
    header[0x2C..0x30].copy_from_slice(&1u32.to_le_bytes());
    header[0x30..0x34].copy_from_slice(&1u32.to_le_bytes());
    header[0x38..0x3C].copy_from_slice(&4096u32.to_le_bytes());
    header[0x3C..0x40].copy_from_slice(&END_OF_CHAIN.to_le_bytes());
    header[0x44..0x48].copy_from_slice(&END_OF_CHAIN.to_le_bytes());
    for slot in 0..109 {
        let value = if slot == 0 { 0 } else { FREE_SECTOR };
        header[0x4C + slot * 4..0x50 + slot * 4].copy_from_slice(&value.to_le_bytes());
    }
    header
}

fn fat_sector(directory_sectors: usize) -> Vec<u8> {
    let mut table = vec![FREE_SECTOR; OLE2_SECTOR / 4];
    table[0] = FAT_SECTOR;
    for (sector, slot) in table.iter_mut().enumerate().skip(1).take(directory_sectors) {
        *slot = if sector == directory_sectors {
            END_OF_CHAIN
        } else {
            sector as u32 + 1
        };
    }
    table.iter().flat_map(|value| value.to_le_bytes()).collect()
}

fn directory_entry(name: &str, kind: u8) -> Vec<u8> {
    let mut entry = vec![0; OLE2_ENTRY];
    let units: Vec<u16> = name.encode_utf16().collect();
    for (index, unit) in units.iter().enumerate() {
        entry[index * 2..index * 2 + 2].copy_from_slice(&unit.to_le_bytes());
    }
    entry[64..66].copy_from_slice(&(((units.len() + 1) * 2) as u16).to_le_bytes());
    entry[66] = kind;
    entry
}

pub fn set_u32(bytes: &mut [u8], at: usize, value: u32) {
    bytes[at..at + 4].copy_from_slice(&value.to_le_bytes());
}

pub fn set_u16(bytes: &mut [u8], at: usize, value: u16) {
    bytes[at..at + 2].copy_from_slice(&value.to_le_bytes());
}

pub fn tar_block(name: &str) -> Vec<u8> {
    let mut block = vec![0; TAR_BLOCK];
    block[..name.len()].copy_from_slice(name.as_bytes());
    block[257..265].copy_from_slice(b"ustar\x0000");
    block[148..156].copy_from_slice(b"        ");
    let sum: u32 = block.iter().map(|byte| u32::from(*byte)).sum();
    let field = format!("{sum:06o}\0 ");
    block[148..156].copy_from_slice(field.as_bytes());
    block
}

pub fn tar_archive(name: &str, content: &[u8]) -> Vec<u8> {
    let mut archive = tar_block(name);
    archive.extend(content);
    archive.resize(
        archive.len().div_ceil(TAR_BLOCK) * TAR_BLOCK + 2 * TAR_BLOCK,
        0,
    );
    archive
}

pub fn gzip(bytes: &[u8]) -> Vec<u8> {
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
    encoder.write_all(bytes).unwrap();
    encoder.finish().unwrap()
}

pub fn bzip2(bytes: &[u8]) -> Vec<u8> {
    let mut encoder = bzip2::write::BzEncoder::new(Vec::new(), bzip2::Compression::fast());
    encoder.write_all(bytes).unwrap();
    encoder.finish().unwrap()
}

pub fn xz(bytes: &[u8]) -> Vec<u8> {
    let mut encoder = liblzma::write::XzEncoder::new(Vec::new(), 1);
    encoder.write_all(bytes).unwrap();
    encoder.finish().unwrap()
}
