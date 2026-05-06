use lofty::file::AudioFile;
use rayon::prelude::*;
use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::{collect_audio_files, parse_extensions};

#[derive(Serialize)]
pub struct QualityResult {
    pub root: Option<String>,
    pub tracks: Vec<QualityTrack>,
    pub total_files: usize,
    pub error_count: usize,
}

#[derive(Serialize)]
pub struct QualityTrack {
    pub path: String,
    pub filename: String,
    pub format: String,
    pub size: u64,
    pub duration_ms: Option<u64>,
    pub duration: Option<f64>,
    pub bitrate: Option<u32>,
    pub sample_rate: Option<u32>,
    pub bit_depth: Option<u32>,
    pub channels: Option<u32>,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn ext_to_format(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("unknown")
        .to_lowercase()
}

fn probe_file(path: &Path) -> QualityTrack {
    let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let filename = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let format = ext_to_format(path);

    match lofty::read_from_path(path) {
        Ok(tagged) => {
            let props = tagged.properties();
            let duration_ms = props.duration().as_millis() as u64;
            QualityTrack {
                path: path.to_string_lossy().to_string(),
                filename,
                format,
                size,
                duration_ms: Some(duration_ms),
                duration: Some(duration_ms as f64 / 1000.0),
                bitrate: props
                    .audio_bitrate()
                    .map(|bitrate| bitrate.saturating_mul(1000)),
                sample_rate: props.sample_rate(),
                bit_depth: props.bit_depth().map(u32::from),
                channels: props.channels().map(u32::from),
                ok: true,
                error: None,
            }
        }
        Err(error) => QualityTrack {
            path: path.to_string_lossy().to_string(),
            filename,
            format,
            size,
            duration_ms: None,
            duration: None,
            bitrate: None,
            sample_rate: None,
            bit_depth: None,
            channels: None,
            ok: false,
            error: Some(error.to_string()),
        },
    }
}

pub fn quality_file(path: PathBuf) -> QualityResult {
    let track = probe_file(&path);
    let error_count = usize::from(!track.ok);
    QualityResult {
        root: path.parent().map(|p| p.to_string_lossy().to_string()),
        tracks: vec![track],
        total_files: 1,
        error_count,
    }
}

pub fn quality_directory(dir: PathBuf, extensions: String) -> QualityResult {
    let exts = parse_extensions(&extensions);
    let files = collect_audio_files(&dir, &exts);
    let tracks: Vec<QualityTrack> = files.par_iter().map(|path| probe_file(path)).collect();
    let error_count = tracks.iter().filter(|track| !track.ok).count();

    QualityResult {
        root: Some(dir.to_string_lossy().to_string()),
        total_files: tracks.len(),
        error_count,
        tracks,
    }
}

pub fn run_quality(file: Option<PathBuf>, dir: Option<PathBuf>, extensions: String) {
    let result = if let Some(file_path) = file {
        quality_file(file_path)
    } else if let Some(dir_path) = dir {
        quality_directory(dir_path, extensions)
    } else {
        QualityResult {
            root: None,
            tracks: Vec::new(),
            total_files: 0,
            error_count: 0,
        }
    };
    println!("{}", serde_json::to_string(&result).unwrap_or_default());
}
