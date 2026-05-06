mod common;

use tempfile::TempDir;

#[test]
fn inspect_file_returns_normalized_tags() {
    let dir = TempDir::new().unwrap();
    let track = common::create_test_wav(&dir, "track.wav", 440.0, 1.0);

    let result = crate_cli::tags::inspect_file(track.clone());

    assert_eq!(result.path, track.to_string_lossy());
    assert_eq!(result.filename, "track.wav");
    assert_eq!(result.tags.format, "wav");
    assert_eq!(result.tags.disc_number, Some(1));
    assert!(result.tags.duration_ms.unwrap_or_default() > 0);
}

#[test]
fn inspect_directory_filters_extensions() {
    let dir = TempDir::new().unwrap();
    common::create_test_wav(&dir, "track.wav", 440.0, 1.0);
    std::fs::write(dir.path().join("notes.txt"), b"not audio").unwrap();

    let result =
        crate_cli::tags::inspect_paths(None, Some(dir.path().to_path_buf()), "wav".to_string())
            .unwrap();

    assert_eq!(result.tracks.len(), 1);
    assert_eq!(result.tracks[0].filename, "track.wav");
}

#[test]
fn write_identity_file_dry_run_reports_unsupported_format() {
    let dir = TempDir::new().unwrap();
    let track = common::create_test_wav(&dir, "track.wav", 440.0, 1.0);

    let result = crate_cli::tags::write_identity_file(
        track.clone(),
        crate_cli::tags::IdentityTagInput {
            schema_version: "1".to_string(),
            artist_uid: "artist-uid".to_string(),
            album_uid: "album-uid".to_string(),
            track_uid: "track-uid".to_string(),
            audio_fingerprint: Some("fingerprint".to_string()),
            audio_fingerprint_source: Some("quick".to_string()),
            dry_run: true,
        },
    );

    assert_eq!(result.path, track.to_string_lossy());
    assert!(!result.written);
    assert!(result.dry_run);
    assert_eq!(result.tag_type.as_deref(), Some("RiffInfo"));
    assert_eq!(
        result.error.as_deref(),
        Some("tag type does not support Crate identity custom keys")
    );
    assert_eq!(
        result.tags,
        vec![
            "crate_schema_version",
            "crate_artist_uid",
            "crate_album_uid",
            "crate_track_uid",
            "crate_audio_fingerprint",
            "crate_audio_fingerprint_source",
        ]
    );
}

#[test]
fn write_identity_file_rejects_unsupported_custom_tag_format() {
    let dir = TempDir::new().unwrap();
    let track = common::create_test_wav(&dir, "track.wav", 440.0, 1.0);

    let result = crate_cli::tags::write_identity_file(
        track,
        crate_cli::tags::IdentityTagInput {
            schema_version: "1".to_string(),
            artist_uid: "artist-uid".to_string(),
            album_uid: "album-uid".to_string(),
            track_uid: "track-uid".to_string(),
            audio_fingerprint: Some("fingerprint".to_string()),
            audio_fingerprint_source: Some("quick".to_string()),
            dry_run: false,
        },
    );

    assert!(!result.written);
    assert!(!result.dry_run);
    assert_eq!(result.tag_type.as_deref(), Some("RiffInfo"));
    assert_eq!(
        result.error.as_deref(),
        Some("tag type does not support Crate identity custom keys")
    );
}
