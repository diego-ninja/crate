use md5::{Digest, Md5};
use serde::Serialize;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use crate::{collect_audio_files, parse_extensions};

#[derive(Serialize)]
pub struct FingerprintTrack {
    pub path: String,
    pub size: u64,
    pub mode: String,
    pub fingerprint: String,
}

#[derive(Serialize)]
pub struct FingerprintResult {
    pub tracks: Vec<FingerprintTrack>,
}

fn hash_bytes(hasher: &mut Md5, path: &Path, limit: Option<usize>) -> std::io::Result<()> {
    let mut file = File::open(path)?;
    let mut remaining = limit.unwrap_or(usize::MAX);
    let mut buffer = [0_u8; 64 * 1024];
    while remaining > 0 {
        let wanted = buffer.len().min(remaining);
        let read = file.read(&mut buffer[..wanted])?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        remaining -= read;
    }
    Ok(())
}

pub fn fingerprint_file(path: PathBuf, mode: &str) -> FingerprintTrack {
    let size = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
    let normalized_mode = if mode.eq_ignore_ascii_case("full") {
        "full"
    } else {
        "quick"
    };

    let mut hasher = Md5::new();
    hasher.update(normalized_mode.as_bytes());
    hasher.update(size.to_le_bytes());
    let _ = if normalized_mode == "full" {
        hash_bytes(&mut hasher, &path, None)
    } else {
        hash_bytes(&mut hasher, &path, Some(256 * 1024))
    };

    FingerprintTrack {
        path: path.to_string_lossy().to_string(),
        size,
        mode: normalized_mode.to_string(),
        fingerprint: hex::encode(hasher.finalize()),
    }
}

pub fn fingerprint_paths(
    file: Option<PathBuf>,
    dir: Option<PathBuf>,
    extensions: String,
    mode: String,
) -> Option<FingerprintResult> {
    let tracks = if let Some(file_path) = file {
        vec![fingerprint_file(file_path, &mode)]
    } else if let Some(dir_path) = dir {
        let exts = parse_extensions(&extensions);
        collect_audio_files(&dir_path, &exts)
            .into_iter()
            .map(|path| fingerprint_file(path, &mode))
            .collect()
    } else {
        return None;
    };

    Some(FingerprintResult { tracks })
}

pub fn run_fingerprint(
    file: Option<PathBuf>,
    dir: Option<PathBuf>,
    extensions: String,
    mode: String,
) {
    match fingerprint_paths(file, dir, extensions, mode) {
        Some(result) => println!("{}", serde_json::to_string(&result).unwrap_or_default()),
        None => {
            eprintln!("provide --file or --dir");
            std::process::exit(2);
        }
    }
}
