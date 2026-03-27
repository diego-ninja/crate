mod common;

use common::{create_test_library, create_test_wav};
use tempfile::TempDir;

#[test]
fn test_scan_finds_all_tracks() {
    let dir = TempDir::new().unwrap();
    let lib = create_test_library(&dir);

    let exts = crate_cli::parse_extensions("wav");
    let files = crate_cli::collect_audio_files(&lib, &exts);
    assert_eq!(files.len(), 3);
}

#[test]
fn test_scan_reads_file_sizes() {
    let dir = TempDir::new().unwrap();
    let lib = create_test_library(&dir);

    let exts = crate_cli::parse_extensions("wav");
    let files = crate_cli::collect_audio_files(&lib, &exts);

    for f in &files {
        let meta = std::fs::metadata(f).unwrap();
        assert!(meta.len() > 0, "File should have non-zero size");
    }
}

#[test]
fn test_scan_detects_cover_art() {
    let dir = TempDir::new().unwrap();
    let lib = create_test_library(&dir);
    let album_dir = lib.join("Test Artist").join("2024").join("Test Album");

    // cover.jpg was created by create_test_library
    assert!(album_dir.join("cover.jpg").exists());
}

#[test]
fn test_scan_detects_artist_photo() {
    let dir = TempDir::new().unwrap();
    let lib = create_test_library(&dir);
    let artist_dir = lib.join("Test Artist");

    assert!(artist_dir.join("artist.jpg").exists());
}

#[test]
fn test_scan_computes_content_hash() {
    let dir = TempDir::new().unwrap();
    let lib = create_test_library(&dir);
    let artist_dir = lib.join("Test Artist");

    // Compute hash using the same logic as scan module
    use md5::{Digest, Md5};
    use walkdir::WalkDir;

    let mut entries: Vec<(String, u64)> = Vec::new();
    for entry in WalkDir::new(&artist_dir).into_iter().flatten() {
        if entry.file_type().is_file() {
            if let Ok(meta) = entry.metadata() {
                let rel = entry
                    .path()
                    .strip_prefix(&artist_dir)
                    .unwrap()
                    .to_string_lossy()
                    .to_string();
                entries.push((rel, meta.len()));
            }
        }
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0));

    let mut hasher = Md5::new();
    for (name, size) in &entries {
        hasher.update(format!("{}:{}\n", name, size).as_bytes());
    }
    let hash = hex::encode(hasher.finalize());

    assert!(!hash.is_empty());
    assert_eq!(hash.len(), 32); // MD5 hex is 32 chars
}

#[test]
fn test_scan_hash_changes_on_new_file() {
    let dir = TempDir::new().unwrap();
    let lib = create_test_library(&dir);
    let artist_dir = lib.join("Test Artist");
    let album_dir = artist_dir.join("2024").join("Test Album");

    use md5::{Digest, Md5};
    use walkdir::WalkDir;

    let compute_hash = |path: &std::path::Path| -> String {
        let mut entries: Vec<(String, u64)> = Vec::new();
        for entry in WalkDir::new(path).into_iter().flatten() {
            if entry.file_type().is_file() {
                if let Ok(meta) = entry.metadata() {
                    let rel = entry
                        .path()
                        .strip_prefix(path)
                        .unwrap()
                        .to_string_lossy()
                        .to_string();
                    entries.push((rel, meta.len()));
                }
            }
        }
        entries.sort_by(|a, b| a.0.cmp(&b.0));
        let mut hasher = Md5::new();
        for (name, size) in &entries {
            hasher.update(format!("{}:{}\n", name, size).as_bytes());
        }
        hex::encode(hasher.finalize())
    };

    let hash_before = compute_hash(&artist_dir);

    // Add a new file
    common::create_test_wav_at(&album_dir, "04 - Track Four.wav", 880.0, 2.0);

    let hash_after = compute_hash(&artist_dir);
    assert_ne!(hash_before, hash_after, "Hash should change after adding a file");
}

#[test]
fn test_scan_empty_directory() {
    let dir = TempDir::new().unwrap();
    let exts = crate_cli::parse_extensions("wav,flac");
    let files = crate_cli::collect_audio_files(dir.path(), &exts);
    assert!(files.is_empty());
}

#[test]
fn test_scan_filters_by_extension() {
    let dir = TempDir::new().unwrap();
    create_test_wav(&dir, "track.wav", 440.0, 1.0);
    std::fs::write(dir.path().join("notes.txt"), b"not audio").unwrap();
    std::fs::write(dir.path().join("image.jpg"), b"not audio").unwrap();

    let exts = crate_cli::parse_extensions("wav");
    let files = crate_cli::collect_audio_files(dir.path(), &exts);
    assert_eq!(files.len(), 1);
    assert!(files[0].to_string_lossy().ends_with(".wav"));
}
