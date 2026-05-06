mod common;

use tempfile::TempDir;

#[test]
fn fingerprint_file_is_stable_for_same_content() {
    let dir = TempDir::new().unwrap();
    let track = common::create_test_wav(&dir, "track.wav", 440.0, 1.0);

    let first = crate_cli::fingerprint::fingerprint_file(track.clone(), "quick");
    let second = crate_cli::fingerprint::fingerprint_file(track, "quick");

    assert_eq!(first.fingerprint, second.fingerprint);
    assert_eq!(first.mode, "quick");
    assert_eq!(first.fingerprint.len(), 32);
}

#[test]
fn fingerprint_directory_filters_extensions() {
    let dir = TempDir::new().unwrap();
    common::create_test_wav(&dir, "track.wav", 440.0, 1.0);
    std::fs::write(dir.path().join("notes.txt"), b"not audio").unwrap();

    let result = crate_cli::fingerprint::fingerprint_paths(
        None,
        Some(dir.path().to_path_buf()),
        "wav".to_string(),
        "full".to_string(),
    )
    .unwrap();

    assert_eq!(result.tracks.len(), 1);
    assert_eq!(result.tracks[0].mode, "full");
}
