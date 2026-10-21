#![allow(dead_code)]

use std::fs;
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use dakedaduck_svn_lib::app::archive::Cancel;
use flate2::Compression;
use flate2::write::GzEncoder;
use sevenz_rust2::{ArchiveEntry, ArchiveWriter};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

const TAR_NAME_FIELD: usize = 100;
const ZIP_LOCAL_HEADER_SIZE_OFFSET: usize = 22;
const ZIP_CENTRAL_SIGNATURE: [u8; 4] = [0x50, 0x4B, 0x01, 0x02];
const ZIP_CENTRAL_SIZE_OFFSET: usize = 24;
const FIXTURES: &str = "tests/fixtures/archives";

pub fn running() -> Cancel {
    Arc::new(AtomicBool::new(false))
}

pub fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(FIXTURES)
        .join(name)
}

pub fn put(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
    let path = dir.join(name);
    fs::write(&path, bytes).unwrap();
    path
}

pub fn zip_stored(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    for (name, data) in entries {
        if name.ends_with('/') {
            writer.add_directory(*name, options).unwrap();
        } else {
            writer.start_file(*name, options).unwrap();
            writer.write_all(data).unwrap();
        }
    }
    writer.finish().unwrap().into_inner()
}

pub fn zip_zeros(name: &str, len: usize) -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    writer.start_file(name, options).unwrap();
    writer.write_all(&vec![0u8; len]).unwrap();
    writer.finish().unwrap().into_inner()
}

pub fn zip_many(count: usize) -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    for index in 0..count {
        writer.start_file(format!("f{index}"), options).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

pub fn zip_lying_about_size(name: &str, real_len: usize, declared: u32) -> Vec<u8> {
    let mut bytes = zip_zeros(name, real_len);
    bytes[ZIP_LOCAL_HEADER_SIZE_OFFSET..ZIP_LOCAL_HEADER_SIZE_OFFSET + 4]
        .copy_from_slice(&declared.to_le_bytes());
    let central = bytes
        .windows(ZIP_CENTRAL_SIGNATURE.len())
        .position(|window| window == ZIP_CENTRAL_SIGNATURE)
        .unwrap();
    let at = central + ZIP_CENTRAL_SIZE_OFFSET;
    bytes[at..at + 4].copy_from_slice(&declared.to_le_bytes());
    bytes
}

pub struct RawTar<'a> {
    pub name: &'a str,
    pub kind: tar::EntryType,
    pub data: &'a [u8],
    pub link: Option<&'a str>,
}

pub fn file<'a>(name: &'a str, data: &'a [u8]) -> RawTar<'a> {
    RawTar {
        name,
        kind: tar::EntryType::Regular,
        data,
        link: None,
    }
}

pub fn tar_raw(entries: &[RawTar<'_>]) -> Vec<u8> {
    let mut builder = tar::Builder::new(Vec::new());
    for entry in entries {
        let mut header = tar::Header::new_gnu();
        let name = entry.name.as_bytes();
        header.as_old_mut().name[..name.len().min(TAR_NAME_FIELD)]
            .copy_from_slice(&name[..name.len().min(TAR_NAME_FIELD)]);
        header.set_size(entry.data.len() as u64);
        header.set_mode(0o644);
        header.set_entry_type(entry.kind);
        if let Some(target) = entry.link {
            header.set_link_name(target).unwrap();
        }
        header.set_cksum();
        builder.append(&header, entry.data).unwrap();
    }
    builder.into_inner().unwrap()
}

pub fn gzip(bytes: &[u8]) -> Vec<u8> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
    encoder.write_all(bytes).unwrap();
    encoder.finish().unwrap()
}

pub fn sevenz(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut writer = ArchiveWriter::new(Cursor::new(Vec::new())).unwrap();
    for (name, data) in entries {
        let entry = ArchiveEntry::new_file(name);
        writer.push_archive_entry(entry, Some(*data)).unwrap();
    }
    writer.finish().unwrap().into_inner()
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

pub fn tar_many(count: usize) -> Vec<u8> {
    let names: Vec<String> = (0..count).map(|index| format!("f{index}")).collect();
    let entries: Vec<RawTar<'_>> = names.iter().map(|name| file(name, b"")).collect();
    tar_raw(&entries)
}

pub fn sevenz_many(count: usize) -> Vec<u8> {
    let mut writer = ArchiveWriter::new(Cursor::new(Vec::new())).unwrap();
    for index in 0..count {
        let entry = ArchiveEntry::new_file(&format!("f{index}"));
        writer.push_archive_entry(entry, Some(&b""[..])).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

pub const SEVENZ_REPARSE_POINT: u32 = 0x400;
pub const SEVENZ_UNIX_EXTENSION: u32 = 0x8000;

pub fn sevenz_with_attributes(name: &str, attributes: u32) -> Vec<u8> {
    let mut writer = ArchiveWriter::new(Cursor::new(Vec::new())).unwrap();
    let mut entry = ArchiveEntry::new_file(name);
    entry.has_windows_attributes = true;
    entry.windows_attributes = attributes;
    writer.push_archive_entry(entry, Some(&b"x"[..])).unwrap();
    writer.finish().unwrap().into_inner()
}

pub fn unix_attributes(mode: u32) -> u32 {
    SEVENZ_UNIX_EXTENSION | (mode << 16)
}

const ZIP_CENTRAL_ATTRIBUTES_OFFSET: usize = 38;
const ZIP_CENTRAL_MADE_BY_OFFSET: usize = 4;
const ZIP_HOST_UNIX: u8 = 3;

pub fn zip_with_unix_mode(name: &str, mode: u32) -> Vec<u8> {
    let mut bytes = zip_stored(&[(name, b"x")]);
    let central = bytes
        .windows(ZIP_CENTRAL_SIGNATURE.len())
        .position(|window| window == ZIP_CENTRAL_SIGNATURE)
        .unwrap();
    bytes[central + ZIP_CENTRAL_MADE_BY_OFFSET + 1] = ZIP_HOST_UNIX;
    let at = central + ZIP_CENTRAL_ATTRIBUTES_OFFSET;
    bytes[at..at + 4].copy_from_slice(&(mode << 16).to_le_bytes());
    bytes
}

pub fn sevenz_with_anti_item(anti: &str, kept: (&str, &[u8])) -> Vec<u8> {
    let mut writer = ArchiveWriter::new(Cursor::new(Vec::new())).unwrap();
    let mut entry = ArchiveEntry::new_file(anti);
    // sevenz-rust2 writes the anti bit inverted: a plain empty entry is read back as anti
    entry.has_stream = false;
    writer.push_archive_entry::<&[u8]>(entry, None).unwrap();
    let (name, data) = kept;
    writer
        .push_archive_entry(ArchiveEntry::new_file(name), Some(data))
        .unwrap();
    writer.finish().unwrap().into_inner()
}

pub fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = !0u32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 != 0 {
                (crc >> 1) ^ 0xEDB8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

pub fn xz_asking_for_dictionary(dictionary_property: u8) -> Vec<u8> {
    let mut stream = vec![0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00, 0x00, 0x00];
    stream.extend(crc32(&[0x00, 0x00]).to_le_bytes());
    let block = [
        0x02,
        0x00,
        0x21,
        0x01,
        dictionary_property,
        0x00,
        0x00,
        0x00,
    ];
    stream.extend(block);
    stream.extend(crc32(&block).to_le_bytes());
    stream
}

pub fn rar_with_symlink(link: &str, target: &str) -> Vec<u8> {
    let mut builder = rars::Builder::new(rars::ArchiveVersion::Rar50).store(true);
    builder
        .add_unix_symlink(
            link.as_bytes().to_vec(),
            target.as_bytes().to_vec(),
            false,
            None,
            None,
        )
        .unwrap();
    builder.to_bytes().unwrap()
}

pub fn rar_with_file(name: &str, data: &[u8]) -> Vec<u8> {
    let mut builder = rars::Builder::new(rars::ArchiveVersion::Rar50).store(true);
    builder
        .add_bytes(name.as_bytes().to_vec(), data.to_vec(), None, None)
        .unwrap();
    builder.to_bytes().unwrap()
}
