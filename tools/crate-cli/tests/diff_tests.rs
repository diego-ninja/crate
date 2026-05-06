use crate_cli::diff::diff_scan_results;
use crate_cli::scan::{AlbumScan, ArtistScan, CrateIdentityTags, ScanResult, TrackScan, TrackTags};

fn track(path: &str, title: &str, size: u64, uid: Option<&str>) -> TrackScan {
    TrackScan {
        path: path.to_string(),
        filename: std::path::Path::new(path)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
        size,
        tags: TrackTags {
            title: Some(title.to_string()),
            artist: Some("Artist".to_string()),
            album_artist: Some("Artist".to_string()),
            album: Some("Album".to_string()),
            track_number: Some(1),
            disc_number: Some(1),
            year: Some("2024".to_string()),
            genre: None,
            musicbrainz_track_id: None,
            musicbrainz_album_id: None,
            duration_ms: Some(120_000),
            format: "flac".to_string(),
            bitrate: Some(1_411_000),
            sample_rate: Some(44_100),
            bit_depth: Some(16),
            crate_identity: CrateIdentityTags {
                crate_track_uid: uid.map(str::to_string),
                ..Default::default()
            },
        },
    }
}

fn scan(tracks: Vec<TrackScan>) -> ScanResult {
    ScanResult {
        artists: vec![ArtistScan {
            name: "Artist".to_string(),
            path: "/music/Artist".to_string(),
            albums: vec![AlbumScan {
                name: "Album".to_string(),
                path: "/music/Artist/Album".to_string(),
                tracks,
                has_cover: false,
                has_embedded_art: false,
            }],
            content_hash: None,
            has_photo: false,
        }],
        total_files: 0,
        total_size: 0,
    }
}

#[test]
fn diff_reports_added_removed_and_changed_tracks() {
    let before = scan(vec![
        track("/music/Artist/Album/01.flac", "One", 100, Some("uid-one")),
        track("/music/Artist/Album/02.flac", "Two", 200, Some("uid-two")),
    ]);
    let mut changed = track(
        "/music/Artist/Album/01.flac",
        "One Changed",
        100,
        Some("uid-one"),
    );
    changed.tags.title = Some("One Changed".to_string());
    let after = scan(vec![
        changed,
        track(
            "/music/Artist/Album/03.flac",
            "Three",
            300,
            Some("uid-three"),
        ),
    ]);

    let diff = diff_scan_results(&before, &after);

    assert_eq!(diff.before_tracks, 2);
    assert_eq!(diff.after_tracks, 2);
    assert_eq!(diff.changed_count, 1);
    assert_eq!(diff.added_count, 1);
    assert_eq!(diff.removed_count, 1);
    assert_eq!(diff.moved_count, 0);
    assert_eq!(diff.changed[0].path, "/music/Artist/Album/01.flac");
    assert_eq!(diff.changed[0].changed_fields, vec!["title"]);
    assert_eq!(diff.added[0].path, "/music/Artist/Album/03.flac");
    assert_eq!(diff.removed[0].path, "/music/Artist/Album/02.flac");
}

#[test]
fn diff_reports_unique_identity_moves() {
    let before = scan(vec![track(
        "/music/Artist/Old Album/01.flac",
        "One",
        100,
        Some("uid-one"),
    )]);
    let after = scan(vec![track(
        "/music/Artist/New Album/01.flac",
        "One",
        100,
        Some("uid-one"),
    )]);

    let diff = diff_scan_results(&before, &after);

    assert_eq!(diff.added_count, 0);
    assert_eq!(diff.removed_count, 0);
    assert_eq!(diff.moved_count, 1);
    assert_eq!(diff.moved[0].from, "/music/Artist/Old Album/01.flac");
    assert_eq!(diff.moved[0].to, "/music/Artist/New Album/01.flac");
    assert_eq!(diff.moved[0].identity, "crate_track_uid:uid-one");
}

#[test]
fn duplicate_identity_does_not_create_ambiguous_moves() {
    let before = scan(vec![
        track("/music/Artist/Old/01.flac", "One", 100, Some("same")),
        track("/music/Artist/Old/02.flac", "Two", 200, Some("same")),
    ]);
    let after = scan(vec![track(
        "/music/Artist/New/01.flac",
        "One",
        100,
        Some("same"),
    )]);

    let diff = diff_scan_results(&before, &after);

    assert_eq!(diff.moved_count, 0);
    assert_eq!(diff.added_count, 1);
    assert_eq!(diff.removed_count, 2);
}
