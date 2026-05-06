mod common;

use tempfile::TempDir;

#[test]
fn test_quality_file_reads_technical_metadata() {
    let dir = TempDir::new().unwrap();
    let track = common::create_test_wav(&dir, "track.wav", 440.0, 1.0);

    let result = crate_cli::quality::quality_file(track);

    assert_eq!(result.total_files, 1);
    assert_eq!(result.error_count, 0);
    let quality = &result.tracks[0];
    assert!(quality.ok);
    assert_eq!(quality.format, "wav");
    assert_eq!(quality.sample_rate, Some(22050));
    assert_eq!(quality.bit_depth, Some(16));
    assert!(quality.duration_ms.unwrap_or_default() > 900);
    assert!(quality.bitrate.unwrap_or_default() > 0);
}

#[test]
fn test_quality_directory_reports_errors() {
    let dir = TempDir::new().unwrap();
    let valid = common::create_test_wav(&dir, "track.wav", 440.0, 1.0);
    let invalid = dir.path().join("broken.flac");
    std::fs::write(&invalid, b"not audio").unwrap();

    let result =
        crate_cli::quality::quality_directory(dir.path().to_path_buf(), "wav,flac".to_string());

    assert_eq!(result.total_files, 2);
    assert_eq!(result.error_count, 1);
    assert!(result
        .tracks
        .iter()
        .any(|track| track.path == valid.to_string_lossy() && track.ok));
    assert!(result
        .tracks
        .iter()
        .any(|track| track.path == invalid.to_string_lossy() && !track.ok));
}
