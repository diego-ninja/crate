use lofty::file::TaggedFileExt;
use lofty::prelude::*;
use lofty::tag::Accessor;
use md5::{Digest, Md5};
use rayon::prelude::*;
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

use crate::{collect_audio_files, parse_extensions};

#[derive(Serialize)]
pub struct ScanResult {
    pub artists: Vec<ArtistScan>,
    pub total_files: usize,
    pub total_size: u64,
}

#[derive(Serialize)]
pub struct ArtistScan {
    pub name: String,
    pub path: String,
    pub albums: Vec<AlbumScan>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<String>,
    pub has_photo: bool,
}

#[derive(Serialize)]
pub struct AlbumScan {
    pub name: String,
    pub path: String,
    pub tracks: Vec<TrackScan>,
    pub has_cover: bool,
    pub has_embedded_art: bool,
}

#[derive(Serialize)]
pub struct TrackScan {
    pub path: String,
    pub filename: String,
    pub size: u64,
    pub tags: TrackTags,
}

#[derive(Serialize, Default)]
pub struct TrackTags {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album_artist: Option<String>,
    pub album: Option<String>,
    pub track_number: Option<u32>,
    pub year: Option<String>,
    pub genre: Option<String>,
    pub musicbrainz_track_id: Option<String>,
    pub musicbrainz_album_id: Option<String>,
    pub duration_ms: Option<u64>,
    pub format: String,
    pub bitrate: Option<u32>,
    pub sample_rate: Option<u32>,
}

fn ext_to_format(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("unknown")
        .to_lowercase()
}

fn read_tags(path: &Path) -> TrackTags {
    let tagged = match lofty::read_from_path(path) {
        Ok(t) => t,
        Err(_) => {
            return TrackTags {
                format: ext_to_format(path),
                ..Default::default()
            }
        }
    };

    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
    let props = tagged.properties();

    let mut tags = TrackTags::default();
    tags.format = ext_to_format(path);
    tags.duration_ms = Some(props.duration().as_millis() as u64);
    tags.bitrate = props.audio_bitrate();
    tags.sample_rate = props.sample_rate();

    if let Some(t) = tag {
        tags.title = t.title().map(|s| s.to_string());
        tags.artist = t.artist().map(|s| s.to_string());
        tags.album = t.album().map(|s| s.to_string());
        tags.track_number = t.track();
        tags.year = t.year().map(|y| y.to_string());
        tags.genre = t.genre().map(|s| s.to_string());

        // Album artist and MusicBrainz IDs from tag items
        for item in t.items() {
            let key = item.key().clone();
            let key_str = match &key {
                lofty::tag::ItemKey::Unknown(s) => s.as_str(),
                _ => "",
            };
            let value = match item.value() {
                lofty::tag::ItemValue::Text(s) => Some(s.as_str()),
                _ => None,
            };

            if let Some(val) = value {
                // Check known ItemKey variants via the key reference
                match &key {
                    k if *k == lofty::tag::ItemKey::AlbumArtist => {
                        tags.album_artist = Some(val.to_string());
                    }
                    k if *k == lofty::tag::ItemKey::MusicBrainzRecordingId => {
                        tags.musicbrainz_track_id = Some(val.to_string());
                    }
                    k if *k == lofty::tag::ItemKey::MusicBrainzReleaseId => {
                        tags.musicbrainz_album_id = Some(val.to_string());
                    }
                    _ => {
                        // Fallback for unknown keys (some tags use raw field names)
                        let upper = key_str.to_uppercase();
                        if upper == "ALBUMARTIST" && tags.album_artist.is_none() {
                            tags.album_artist = Some(val.to_string());
                        } else if upper == "MUSICBRAINZ_TRACKID"
                            && tags.musicbrainz_track_id.is_none()
                        {
                            tags.musicbrainz_track_id = Some(val.to_string());
                        } else if upper == "MUSICBRAINZ_ALBUMID"
                            && tags.musicbrainz_album_id.is_none()
                        {
                            tags.musicbrainz_album_id = Some(val.to_string());
                        }
                    }
                }
            }
        }
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

    for file in files {
        // Get path relative to library root
        let rel = match file.strip_prefix(dir) {
            Ok(r) => r,
            Err(_) => continue,
        };

        let components: Vec<&str> = rel
            .components()
            .filter_map(|c| {
                if let std::path::Component::Normal(s) = c {
                    s.to_str()
                } else {
                    None
                }
            })
            .collect();

        // We need at least: Artist/Album/track or Artist/Year/Album/track
        if components.len() < 3 {
            continue;
        }

        let artist_name = components[0].to_string();
        let artist_path = dir.join(&artist_name);

        // Determine album: could be Artist/Album/track or Artist/Year/Album/track
        let (album_name, album_path) = if components.len() >= 4 {
            // Check if second component looks like a year (4 digits)
            let maybe_year = components[1];
            if maybe_year.len() == 4 && maybe_year.chars().all(|c| c.is_ascii_digit()) {
                // Artist/Year/Album/track
                (
                    components[2].to_string(),
                    artist_path.join(maybe_year).join(components[2]),
                )
            } else {
                // Artist/SubDir/Album/track — treat second level as album
                (components[1].to_string(), artist_path.join(components[1]))
            }
        } else {
            // Artist/Album/track
            (components[1].to_string(), artist_path.join(components[1]))
        };

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

pub fn run_scan(dir: PathBuf, extensions: String, hash: bool, covers: bool) {
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

    let result = ScanResult {
        artists,
        total_files,
        total_size,
    };

    println!("{}", serde_json::to_string(&result).unwrap_or_default());
}
