use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use crate::scan::{ScanResult, TrackScan};

#[derive(Clone)]
struct TrackSnapshot {
    path: String,
    filename: String,
    size: u64,
    identity: Option<String>,
    fields: BTreeMap<&'static str, Value>,
}

#[derive(Serialize)]
pub struct DiffTrack {
    pub path: String,
    pub filename: String,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identity: Option<String>,
}

#[derive(Serialize)]
pub struct MovedTrack {
    pub from: String,
    pub to: String,
    pub filename: String,
    pub size: u64,
    pub identity: String,
    pub changed_fields: Vec<String>,
}

#[derive(Serialize)]
pub struct ChangedTrack {
    pub path: String,
    pub filename: String,
    pub identity: Option<String>,
    pub changed_fields: Vec<String>,
}

#[derive(Serialize)]
pub struct ScanDiff {
    pub before_tracks: usize,
    pub after_tracks: usize,
    pub unchanged_count: usize,
    pub added_count: usize,
    pub removed_count: usize,
    pub moved_count: usize,
    pub changed_count: usize,
    pub added: Vec<DiffTrack>,
    pub removed: Vec<DiffTrack>,
    pub moved: Vec<MovedTrack>,
    pub changed: Vec<ChangedTrack>,
}

fn value<T: Serialize>(input: T) -> Value {
    serde_json::to_value(input).unwrap_or(Value::Null)
}

fn optional_value<T: Serialize>(input: Option<T>) -> Value {
    input.map(value).unwrap_or(Value::Null)
}

fn string_value(input: Option<&String>) -> Value {
    input
        .map(|s| Value::String(s.clone()))
        .unwrap_or(Value::Null)
}

fn track_identity(track: &TrackScan) -> Option<String> {
    let tags = &track.tags;
    if let Some(uid) = tags
        .crate_identity
        .crate_track_uid
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        return Some(format!("crate_track_uid:{uid}"));
    }
    if let Some(mbid) = tags
        .musicbrainz_track_id
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        return Some(format!("musicbrainz_track_id:{mbid}"));
    }

    let title = tags.title.as_deref().unwrap_or("");
    let artist = tags.artist.as_deref().unwrap_or("");
    let album = tags.album.as_deref().unwrap_or("");
    if title.is_empty() && artist.is_empty() && album.is_empty() {
        return None;
    }

    Some(format!(
        "tag_signature:{}:{}:{}:{}:{}:{}",
        track.size,
        tags.duration_ms.unwrap_or_default(),
        artist,
        album,
        tags.disc_number.unwrap_or(1),
        tags.track_number
            .map(|value| value.to_string())
            .unwrap_or_default()
    ))
}

fn snapshot(track: &TrackScan) -> TrackSnapshot {
    let tags = &track.tags;
    let mut fields: BTreeMap<&'static str, Value> = BTreeMap::new();
    fields.insert("size", value(track.size));
    fields.insert("title", string_value(tags.title.as_ref()));
    fields.insert("artist", string_value(tags.artist.as_ref()));
    fields.insert("album_artist", string_value(tags.album_artist.as_ref()));
    fields.insert("album", string_value(tags.album.as_ref()));
    fields.insert("track_number", optional_value(tags.track_number));
    fields.insert("disc_number", optional_value(tags.disc_number));
    fields.insert("year", string_value(tags.year.as_ref()));
    fields.insert("genre", string_value(tags.genre.as_ref()));
    fields.insert(
        "musicbrainz_track_id",
        string_value(tags.musicbrainz_track_id.as_ref()),
    );
    fields.insert(
        "musicbrainz_album_id",
        string_value(tags.musicbrainz_album_id.as_ref()),
    );
    fields.insert("duration_ms", optional_value(tags.duration_ms));
    fields.insert("format", value(&tags.format));
    fields.insert("bitrate", optional_value(tags.bitrate));
    fields.insert("sample_rate", optional_value(tags.sample_rate));
    fields.insert("bit_depth", optional_value(tags.bit_depth));
    fields.insert(
        "crate_track_uid",
        string_value(tags.crate_identity.crate_track_uid.as_ref()),
    );
    fields.insert(
        "crate_audio_fingerprint",
        string_value(tags.crate_identity.crate_audio_fingerprint.as_ref()),
    );

    TrackSnapshot {
        path: track.path.clone(),
        filename: track.filename.clone(),
        size: track.size,
        identity: track_identity(track),
        fields,
    }
}

fn flatten(payload: &ScanResult) -> BTreeMap<String, TrackSnapshot> {
    let mut tracks: BTreeMap<String, TrackSnapshot> = BTreeMap::new();
    for artist in &payload.artists {
        for album in &artist.albums {
            for track in &album.tracks {
                tracks.insert(track.path.clone(), snapshot(track));
            }
        }
    }
    tracks
}

fn diff_fields(before: &TrackSnapshot, after: &TrackSnapshot) -> Vec<String> {
    let keys: BTreeSet<&str> = before
        .fields
        .keys()
        .chain(after.fields.keys())
        .copied()
        .collect();
    keys.into_iter()
        .filter(|key| before.fields.get(key) != after.fields.get(key))
        .map(str::to_string)
        .collect()
}

fn diff_track(track: &TrackSnapshot) -> DiffTrack {
    DiffTrack {
        path: track.path.clone(),
        filename: track.filename.clone(),
        size: track.size,
        identity: track.identity.clone(),
    }
}

fn unique_identity_map(tracks: &[TrackSnapshot]) -> BTreeMap<String, TrackSnapshot> {
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for track in tracks {
        if let Some(identity) = &track.identity {
            *counts.entry(identity.clone()).or_insert(0) += 1;
        }
    }

    tracks
        .iter()
        .filter_map(|track| {
            let identity = track.identity.as_ref()?;
            if counts.get(identity).copied().unwrap_or(0) == 1 {
                Some((identity.clone(), track.clone()))
            } else {
                None
            }
        })
        .collect()
}

pub fn diff_scan_results(before: &ScanResult, after: &ScanResult) -> ScanDiff {
    let before_by_path = flatten(before);
    let after_by_path = flatten(after);
    let before_paths: BTreeSet<String> = before_by_path.keys().cloned().collect();
    let after_paths: BTreeSet<String> = after_by_path.keys().cloned().collect();

    let mut unchanged_count = 0;
    let mut changed: Vec<ChangedTrack> = Vec::new();
    for path in before_paths.intersection(&after_paths) {
        let before_track = before_by_path.get(path).expect("path exists in before");
        let after_track = after_by_path.get(path).expect("path exists in after");
        let changed_fields = diff_fields(before_track, after_track);
        if changed_fields.is_empty() {
            unchanged_count += 1;
        } else {
            changed.push(ChangedTrack {
                path: path.clone(),
                filename: after_track.filename.clone(),
                identity: after_track
                    .identity
                    .clone()
                    .or_else(|| before_track.identity.clone()),
                changed_fields,
            });
        }
    }

    let removed_candidates: Vec<TrackSnapshot> = before_paths
        .difference(&after_paths)
        .filter_map(|path| before_by_path.get(path).cloned())
        .collect();
    let added_candidates: Vec<TrackSnapshot> = after_paths
        .difference(&before_paths)
        .filter_map(|path| after_by_path.get(path).cloned())
        .collect();

    let removed_by_identity = unique_identity_map(&removed_candidates);
    let added_by_identity = unique_identity_map(&added_candidates);
    let moved_identities: BTreeSet<String> = removed_by_identity
        .keys()
        .filter(|identity| added_by_identity.contains_key(*identity))
        .cloned()
        .collect();

    let mut moved: Vec<MovedTrack> = moved_identities
        .iter()
        .filter_map(|identity| {
            let before_track = removed_by_identity.get(identity)?;
            let after_track = added_by_identity.get(identity)?;
            Some(MovedTrack {
                from: before_track.path.clone(),
                to: after_track.path.clone(),
                filename: after_track.filename.clone(),
                size: after_track.size,
                identity: identity.clone(),
                changed_fields: diff_fields(before_track, after_track),
            })
        })
        .collect();

    let added: Vec<DiffTrack> = added_candidates
        .iter()
        .filter(|track| {
            track
                .identity
                .as_ref()
                .map(|identity| !moved_identities.contains(identity))
                .unwrap_or(true)
        })
        .map(diff_track)
        .collect();
    let removed: Vec<DiffTrack> = removed_candidates
        .iter()
        .filter(|track| {
            track
                .identity
                .as_ref()
                .map(|identity| !moved_identities.contains(identity))
                .unwrap_or(true)
        })
        .map(diff_track)
        .collect();

    moved.sort_by(|left, right| left.from.cmp(&right.from));

    ScanDiff {
        before_tracks: before_by_path.len(),
        after_tracks: after_by_path.len(),
        unchanged_count,
        added_count: added.len(),
        removed_count: removed.len(),
        moved_count: moved.len(),
        changed_count: changed.len(),
        added,
        removed,
        moved,
        changed,
    }
}

pub fn run_diff(before_path: PathBuf, after_path: PathBuf) {
    let before: ScanResult = match std::fs::read_to_string(&before_path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
    {
        Some(payload) => payload,
        None => {
            eprintln!("failed to read scan snapshot: {}", before_path.display());
            std::process::exit(2);
        }
    };
    let after: ScanResult = match std::fs::read_to_string(&after_path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
    {
        Some(payload) => payload,
        None => {
            eprintln!("failed to read scan snapshot: {}", after_path.display());
            std::process::exit(2);
        }
    };

    println!(
        "{}",
        serde_json::to_string(&diff_scan_results(&before, &after))
            .unwrap_or_else(|err| { json!({"error": err.to_string()}).to_string() })
    );
}
