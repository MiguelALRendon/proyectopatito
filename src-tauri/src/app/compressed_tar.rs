use std::fs::File;
use std::io::{self, BufReader, Read};
use std::path::Path;

use crate::app::media::has_tar_header;
use crate::app::sniff::{ProbeKind, Sniffed};

const TAR_BLOCK_LEN: usize = 512;
const INPUT_LIMIT_BYTES: u64 = 4 * 1024 * 1024;
const XZ_MEMORY_LIMIT_BYTES: u64 = 64 * 1024 * 1024;

const GZIP_SUFFIXES: [&str; 2] = [".tar.gz", ".tgz"];
const BZIP2_SUFFIXES: [&str; 3] = [".tar.bz2", ".tbz2", ".tbz"];
const XZ_SUFFIXES: [&str; 2] = [".tar.xz", ".txz"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Compression {
    Gzip,
    Bzip2,
    Xz,
}

impl Compression {
    fn sniffed(self) -> Sniffed {
        let (mime, extension) = match self {
            Self::Gzip => ("application/gzip", "tar.gz"),
            Self::Bzip2 => ("application/x-bzip2", "tar.bz2"),
            Self::Xz => ("application/x-xz", "tar.xz"),
        };
        Sniffed {
            kind: ProbeKind::Archive,
            mime,
            extension: Some(extension),
        }
    }
}

pub fn detect_compressed_tar(path: &Path, file_name: &str) -> io::Result<Option<Sniffed>> {
    let Some(compression) = compression_of(file_name) else {
        return Ok(None);
    };
    let input = BufReader::new(File::open(path)?.take(INPUT_LIMIT_BYTES));
    let block = first_block(compression, input)?;
    Ok(block
        .is_some_and(|bytes| has_tar_header(&bytes))
        .then(|| compression.sniffed()))
}

fn compression_of(file_name: &str) -> Option<Compression> {
    let named = |suffixes: &[&str]| suffixes.iter().any(|suffix| file_name.ends_with(suffix));
    if named(&GZIP_SUFFIXES) {
        return Some(Compression::Gzip);
    }
    if named(&BZIP2_SUFFIXES) {
        return Some(Compression::Bzip2);
    }
    named(&XZ_SUFFIXES).then_some(Compression::Xz)
}

fn first_block<R: Read>(compression: Compression, input: R) -> io::Result<Option<Vec<u8>>> {
    let mut decoder: Box<dyn Read> = match compression {
        Compression::Gzip => Box::new(flate2::read::GzDecoder::new(input)),
        Compression::Bzip2 => Box::new(bzip2::read::BzDecoder::new(input)),
        Compression::Xz => {
            let stream = liblzma::stream::Stream::new_stream_decoder(XZ_MEMORY_LIMIT_BYTES, 0)
                .map_err(io::Error::other)?;
            Box::new(liblzma::read::XzDecoder::new_stream(input, stream))
        }
    };
    let mut block = vec![0; TAR_BLOCK_LEN];
    Ok(decoder.read_exact(&mut block).is_ok().then_some(block))
}
