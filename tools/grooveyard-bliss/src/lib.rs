pub mod analyze;
pub mod bliss;
#[cfg(feature = "ml")]
pub mod ml;
pub mod scan;

use std::path::{Path, PathBuf};

/// Collect audio files recursively from a directory, filtered by extension.
pub fn collect_audio_files(dir: &Path, extensions: &[String]) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                files.extend(collect_audio_files(&path, extensions));
            } else if path.is_file() {
                if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    if extensions.iter().any(|e| e.eq_ignore_ascii_case(ext)) {
                        files.push(path);
                    }
                }
            }
        }
    }
    files.sort();
    files
}

/// Parse a comma-separated extensions string into a Vec.
pub fn parse_extensions(extensions: &str) -> Vec<String> {
    extensions
        .split(',')
        .map(|s| s.trim().to_string())
        .collect()
}
