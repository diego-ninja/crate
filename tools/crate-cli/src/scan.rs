use lofty::file::TaggedFileExt;
use lofty::prelude::*;
use lofty::tag::{Accessor, ItemKey, TagType};
use md5::{Digest, Md5};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

use crate::{collect_audio_files, parse_extensions};

#[derive(Clone, Deserialize, Serialize)]
pub struct ScanResult {
    pub artists: Vec<ArtistScan>,
    pub total_files: usize,
    pub total_size: u64,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct ArtistScan {
    pub name: String,
    pub path: String,
    pub albums: Vec<AlbumScan>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<String>,
    pub has_photo: bool,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct AlbumScan {
    pub name: String,
    pub path: String,
    pub tracks: Vec<TrackScan>,
    pub has_cover: bool,
    pub has_embedded_art: bool,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct TrackScan {
    pub path: String,
    pub filename: String,
    pub size: u64,
    pub tags: TrackTags,
}

#[derive(Clone, Deserialize, Serialize, Default)]
pub struct TrackTags {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album_artist: Option<String>,
    pub album: Option<String>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
    pub year: Option<String>,
    pub genre: Option<String>,
    pub musicbrainz_track_id: Option<String>,
    pub musicbrainz_album_id: Option<String>,
    pub duration_ms: Option<u64>,
    pub format: String,
    pub bitrate: Option<u32>,
    pub sample_rate: Option<u32>,
    pub bit_depth: Option<u32>,
    #[serde(default, skip_serializing_if = "CrateIdentityTags::is_empty")]
    pub crate_identity: CrateIdentityTags,
}

#[derive(Clone, Deserialize, Serialize, Default)]
pub struct CrateIdentityTags {
    pub crate_schema_version: Option<String>,
    pub crate_artist_uid: Option<String>,
    pub crate_album_uid: Option<String>,
    pub crate_track_uid: Option<String>,
    pub crate_audio_fingerprint: Option<String>,
    pub crate_audio_fingerprint_source: Option<String>,
}

impl CrateIdentityTags {
    fn is_empty(&self) -> bool {
        self.crate_schema_version.is_none()
            && self.crate_artist_uid.is_none()
            && self.crate_album_uid.is_none()
            && self.crate_track_uid.is_none()
            && self.crate_audio_fingerprint.is_none()
            && self.crate_audio_fingerprint_source.is_none()
    }
}

fn ext_to_format(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("unknown")
        .to_lowercase()
}

fn normalize_tag_key(raw: &str) -> String {
    let tail = raw.rsplit(':').next().unwrap_or(raw);
    tail.trim()
        .to_ascii_lowercase()
        .replace(' ', "_")
        .replace('-', "_")
}

fn mapped_item_key(tag_type: TagType, key: &ItemKey) -> String {
    key.map_key(tag_type, true)
        .map(normalize_tag_key)
        .unwrap_or_else(|| match key {
            ItemKey::Unknown(raw) => normalize_tag_key(raw),
            _ => String::new(),
        })
}

fn year_prefix(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        None
    } else if value.len() >= 4 {
        Some(value[..4].to_string())
    } else {
        Some(value.to_string())
    }
}

fn number_prefix(value: &str) -> Option<u32> {
    let raw = value.split('/').next().unwrap_or(value).trim();
    if raw.is_empty() {
        None
    } else {
        raw.parse::<u32>().ok()
    }
}

fn apply_text_item(tags: &mut TrackTags, key: &str, value: &str) {
    match normalize_tag_key(key).as_str() {
        "albumartist" | "album_artist" => {
            if tags.album_artist.is_none() {
                tags.album_artist = Some(value.to_string());
            }
        }
        "musicbrainz_trackid" | "musicbrainz_recordingid" => {
            if tags.musicbrainz_track_id.is_none() {
                tags.musicbrainz_track_id = Some(value.to_string());
            }
        }
        "musicbrainz_albumid" | "musicbrainz_releaseid" => {
            if tags.musicbrainz_album_id.is_none() {
                tags.musicbrainz_album_id = Some(value.to_string());
            }
        }
        "date" => {
            if let Some(year) = year_prefix(value) {
                tags.year = Some(year);
            }
        }
        "year" => {
            if tags.year.is_none() {
                tags.year = year_prefix(value);
            }
        }
        "discnumber" | "disc_number" | "disk" | "disknumber" | "disk_number" => {
            if tags.disc_number.is_none() {
                tags.disc_number = number_prefix(value);
            }
        }
        "crate_schema_version" => {
            tags.crate_identity.crate_schema_version = Some(value.to_string());
        }
        "crate_artist_uid" | "crate_artist_id" => {
            tags.crate_identity.crate_artist_uid = Some(value.to_string());
        }
        "crate_album_uid" | "crate_album_id" => {
            tags.crate_identity.crate_album_uid = Some(value.to_string());
        }
        "crate_track_uid" | "crate_track_id" => {
            tags.crate_identity.crate_track_uid = Some(value.to_string());
        }
        "crate_audio_fingerprint" | "audio_fingerprint" => {
            tags.crate_identity.crate_audio_fingerprint = Some(value.to_string());
        }
        "crate_audio_fingerprint_source" | "audio_fingerprint_source" => {
            tags.crate_identity.crate_audio_fingerprint_source = Some(value.to_string());
        }
        _ => {}
    }
}

pub fn read_tags(path: &Path) -> TrackTags {
    let tagged = match lofty::read_from_path(path) {
        Ok(t) => t,
        Err(_) => {
            return TrackTags {
                format: ext_to_format(path),
                disc_number: Some(1),
                ..Default::default()
            }
        }
    };

    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
    let props = tagged.properties();

    let mut tags = TrackTags::default();
    tags.format = ext_to_format(path);
    tags.duration_ms = Some(props.duration().as_millis() as u64);
    tags.bitrate = props
        .audio_bitrate()
        .map(|bitrate| bitrate.saturating_mul(1000));
    tags.sample_rate = props.sample_rate();
    tags.bit_depth = props.bit_depth().map(u32::from);

    if let Some(t) = tag {
        tags.title = t.title().map(|s| s.to_string());
        tags.artist = t.artist().map(|s| s.to_string());
        tags.album = t.album().map(|s| s.to_string());
        tags.track_number = t.track();
        tags.disc_number = t.disk();
        tags.genre = t.genre().map(|s| s.to_string());

        // Album artist and MusicBrainz IDs from tag items
        let tag_type = t.tag_type();
        for item in t.items() {
            let key = item.key();
            let value = match item.value() {
                lofty::tag::ItemValue::Text(s) => Some(s.as_str()),
                _ => None,
            };

            if let Some(val) = value {
                // Check known ItemKey variants via the key reference
                match key {
                    k if *k == lofty::tag::ItemKey::AlbumArtist => {
                        tags.album_artist = Some(val.to_string());
                    }
                    k if *k == lofty::tag::ItemKey::MusicBrainzRecordingId => {
                        tags.musicbrainz_track_id = Some(val.to_string());
                    }
                    k if *k == lofty::tag::ItemKey::MusicBrainzReleaseId => {
                        tags.musicbrainz_album_id = Some(val.to_string());
                    }
                    k if *k == lofty::tag::ItemKey::DiscNumber => {
                        tags.disc_number = number_prefix(val);
                    }
                    _ => {}
                }
                apply_text_item(&mut tags, &mapped_item_key(tag_type, key), val);
            }
        }

        if tags.year.is_none() {
            tags.year = t.year().map(|y| y.to_string());
        }
    }

    if tags.disc_number.is_none() {
        tags.disc_number = Some(1);
    }

    tags
}

fn has_cover_file(dir: &Path) -> bool {
    let cover_names = ["cover.jpg", "cover.png", "folder.jpg", "folder.png"];
    cover_names.iter().any(|name| dir.join(name).exists())
}

fn has_embedded_art(path: &Path) -> bool {
    match lofty::read_from_path(path) {
        Ok(tagged) => {
            if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
                tag.picture_count() > 0
            } else {
                false
            }
        }
        Err(_) => false,
    }
}

fn has_artist_photo(dir: &Path) -> bool {
    let photo_names = ["artist.jpg", "artist.png", "photo.jpg"];
    photo_names.iter().any(|name| dir.join(name).exists())
}

fn compute_dir_hash(dir: &Path) -> String {
    let mut entries: Vec<(String, u64)> = Vec::new();
    for entry in WalkDir::new(dir).into_iter().flatten() {
        if entry.file_type().is_file() {
            if let Ok(meta) = entry.metadata() {
                let rel = entry
                    .path()
                    .strip_prefix(dir)
                    .unwrap_or(entry.path())
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
}

fn is_m4a(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("m4a"))
        .unwrap_or(false)
}

fn is_flac(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("flac"))
        .unwrap_or(false)
}

fn has_hidden_component(path: &Path) -> bool {
    path.components().any(|component| match component {
        std::path::Component::Normal(name) => name
            .to_str()
            .map(|value| value.starts_with('.'))
            .unwrap_or(false),
        _ => false,
    })
}

fn album_structure_for_file(dir: &Path, file: &Path) -> Option<(String, PathBuf, String, PathBuf)> {
    let rel = file.strip_prefix(dir).ok()?;
    if has_hidden_component(rel) {
        return None;
    }

    let components: Vec<String> = rel
        .components()
        .filter_map(|c| {
            if let std::path::Component::Normal(s) = c {
                s.to_str().map(|value| value.to_string())
            } else {
                None
            }
        })
        .collect();

    if components.len() == 1 {
        let album_name = dir
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Unknown Album")
            .to_string();
        let artist_path = dir.parent().unwrap_or(dir).to_path_buf();
        let artist_name = artist_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Unknown Artist")
            .to_string();
        return Some((artist_name, artist_path, album_name, dir.to_path_buf()));
    }

    if components.len() == 2 {
        let artist_name = dir
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Unknown Artist")
            .to_string();
        let artist_path = dir.to_path_buf();
        let album_name = components[0].clone();
        let album_path = dir.join(&album_name);
        return Some((artist_name, artist_path, album_name, album_path));
    }

    let first_component_is_year =
        components[0].len() == 4 && components[0].chars().all(|c| c.is_ascii_digit());
    if first_component_is_year {
        let artist_name = dir
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Unknown Artist")
            .to_string();
        let artist_path = dir.to_path_buf();
        let album_name = components[1].clone();
        let album_path = dir.join(&components[0]).join(&album_name);
        return Some((artist_name, artist_path, album_name, album_path));
    }

    let artist_name = components[0].clone();
    let artist_path = dir.join(&artist_name);

    // Determine album: could be Artist/Album/track or Artist/Year/Album/track
    let (album_name, album_path) = if components.len() >= 4 {
        let maybe_year = &components[1];
        if maybe_year.len() == 4 && maybe_year.chars().all(|c| c.is_ascii_digit()) {
            (
                components[2].clone(),
                artist_path.join(maybe_year).join(&components[2]),
            )
        } else {
            (components[1].clone(), artist_path.join(&components[1]))
        }
    } else {
        (components[1].clone(), artist_path.join(&components[1]))
    };

    Some((artist_name, artist_path, album_name, album_path))
}

/// Detect library structure: root/Artist/[Year/]Album/tracks
/// Returns a map of artist_name -> (artist_path, albums_map)
/// where albums_map is album_name -> (album_path, track_paths)
fn detect_structure(
    dir: &Path,
    extensions: &[String],
) -> BTreeMap<String, (PathBuf, BTreeMap<String, (PathBuf, Vec<PathBuf>)>)> {
    let mut artists: BTreeMap<String, (PathBuf, BTreeMap<String, (PathBuf, Vec<PathBuf>)>)> =
        BTreeMap::new();

    let files = collect_audio_files(dir, extensions);
    let mut albums_with_flac: BTreeSet<PathBuf> = BTreeSet::new();

    for file in &files {
        if is_flac(file) {
            if let Some((_, _, _, album_path)) = album_structure_for_file(dir, file) {
                albums_with_flac.insert(album_path);
            }
        }
    }

    for file in files {
        let Some((artist_name, artist_path, album_name, album_path)) =
            album_structure_for_file(dir, &file)
        else {
            continue;
        };

        // Match LibrarySync semantics: when a scanned album tree contains FLAC
        // and M4A copies, keep the FLAC files and ignore the M4A sidecars.
        if is_m4a(&file) && albums_with_flac.contains(&album_path) {
            continue;
        }

        let entry = artists
            .entry(artist_name)
            .or_insert_with(|| (artist_path, BTreeMap::new()));
        let album_entry = entry
            .1
            .entry(album_name)
            .or_insert_with(|| (album_path, Vec::new()));
        album_entry.1.push(file);
    }

    artists
}

pub fn scan_directory(dir: PathBuf, extensions: String, hash: bool, covers: bool) -> ScanResult {
    let exts = parse_extensions(&extensions);
    let structure = detect_structure(&dir, &exts);

    let mut total_files: usize = 0;
    let mut total_size: u64 = 0;

    let artists: Vec<ArtistScan> = structure
        .into_iter()
        .map(|(artist_name, (artist_path, albums_map))| {
            let albums: Vec<AlbumScan> = albums_map
                .into_iter()
                .map(|(album_name, (album_path, track_paths))| {
                    let tracks: Vec<TrackScan> = track_paths
                        .par_iter()
                        .map(|tp| {
                            let size = std::fs::metadata(tp).map(|m| m.len()).unwrap_or(0);
                            let filename = tp
                                .file_name()
                                .unwrap_or_default()
                                .to_string_lossy()
                                .to_string();
                            let tags = read_tags(tp);
                            TrackScan {
                                path: tp.to_string_lossy().to_string(),
                                filename,
                                size,
                                tags,
                            }
                        })
                        .collect();

                    let has_cover_art = if covers {
                        has_cover_file(&album_path)
                    } else {
                        false
                    };

                    let embedded = if covers {
                        tracks
                            .first()
                            .map(|t| has_embedded_art(Path::new(&t.path)))
                            .unwrap_or(false)
                    } else {
                        false
                    };

                    AlbumScan {
                        name: album_name,
                        path: album_path.to_string_lossy().to_string(),
                        tracks,
                        has_cover: has_cover_art,
                        has_embedded_art: embedded,
                    }
                })
                .collect();

            let content_hash = if hash {
                Some(compute_dir_hash(&artist_path))
            } else {
                None
            };

            let photo = has_artist_photo(&artist_path);

            ArtistScan {
                name: artist_name,
                path: artist_path.to_string_lossy().to_string(),
                albums,
                content_hash,
                has_photo: photo,
            }
        })
        .collect();

    // Compute totals
    for artist in &artists {
        for album in &artist.albums {
            for track in &album.tracks {
                total_files += 1;
                total_size += track.size;
            }
        }
    }

    ScanResult {
        artists,
        total_files,
        total_size,
    }
}

pub fn run_scan(dir: PathBuf, extensions: String, hash: bool, covers: bool) {
    let result = scan_directory(dir, extensions, hash, covers);
    println!("{}", serde_json::to_string(&result).unwrap_or_default());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_portable_metadata_keys() {
        assert_eq!(normalize_tag_key("crate_track_uid"), "crate_track_uid");
        assert_eq!(normalize_tag_key("TXXX:crate-track-id"), "crate_track_id");
        assert_eq!(
            normalize_tag_key("----:com.crate:crate_audio_fingerprint"),
            "crate_audio_fingerprint"
        );
    }

    #[test]
    fn applies_crate_identity_text_items() {
        let mut tags = TrackTags::default();

        apply_text_item(&mut tags, "year", "2015");
        apply_text_item(&mut tags, "date", "2012-09-04");
        apply_text_item(&mut tags, "discnumber", "2/3");
        apply_text_item(&mut tags, "crate_schema_version", "1");
        apply_text_item(&mut tags, "crate_artist_uid", "artist-uid");
        apply_text_item(&mut tags, "crate_album_id", "album-uid");
        apply_text_item(&mut tags, "crate_track_uid", "track-uid");
        apply_text_item(&mut tags, "audio_fingerprint", "fingerprint");
        apply_text_item(&mut tags, "audio_fingerprint_source", "source");

        assert_eq!(
            tags.crate_identity.crate_schema_version.as_deref(),
            Some("1")
        );
        assert_eq!(
            tags.crate_identity.crate_artist_uid.as_deref(),
            Some("artist-uid")
        );
        assert_eq!(
            tags.crate_identity.crate_album_uid.as_deref(),
            Some("album-uid")
        );
        assert_eq!(
            tags.crate_identity.crate_track_uid.as_deref(),
            Some("track-uid")
        );
        assert_eq!(
            tags.crate_identity.crate_audio_fingerprint.as_deref(),
            Some("fingerprint")
        );
        assert_eq!(
            tags.crate_identity
                .crate_audio_fingerprint_source
                .as_deref(),
            Some("source")
        );
        assert_eq!(tags.year.as_deref(), Some("2012"));
        assert_eq!(tags.disc_number, Some(2));
    }
}
