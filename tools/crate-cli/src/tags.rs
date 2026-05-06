use serde::Serialize;
use std::path::Path;
use std::path::PathBuf;

use lofty::config::WriteOptions;
use lofty::file::TaggedFileExt;
use lofty::prelude::*;
use lofty::tag::{ItemKey, ItemValue, Tag, TagItem, TagType};

use crate::scan::{read_tags, TrackTags};
use crate::{collect_audio_files, parse_extensions};

#[derive(Serialize)]
pub struct TagInspectTrack {
    pub path: String,
    pub filename: String,
    pub size: u64,
    pub tags: TrackTags,
}

#[derive(Serialize)]
pub struct TagInspectResult {
    pub tracks: Vec<TagInspectTrack>,
}

#[derive(Clone, Debug)]
pub struct IdentityTagInput {
    pub schema_version: String,
    pub artist_uid: String,
    pub album_uid: String,
    pub track_uid: String,
    pub audio_fingerprint: Option<String>,
    pub audio_fingerprint_source: Option<String>,
    pub dry_run: bool,
}

#[derive(Serialize)]
pub struct TagWriteIdentityResult {
    pub path: String,
    pub written: bool,
    pub dry_run: bool,
    pub tag_type: Option<String>,
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub fn inspect_file(path: PathBuf) -> TagInspectTrack {
    let size = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
    let filename = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    TagInspectTrack {
        path: path.to_string_lossy().to_string(),
        filename,
        size,
        tags: read_tags(&path),
    }
}

pub fn inspect_paths(
    file: Option<PathBuf>,
    dir: Option<PathBuf>,
    extensions: String,
) -> Option<TagInspectResult> {
    let tracks = if let Some(file_path) = file {
        vec![inspect_file(file_path)]
    } else if let Some(dir_path) = dir {
        let exts = parse_extensions(&extensions);
        collect_audio_files(&dir_path, &exts)
            .into_iter()
            .map(inspect_file)
            .collect()
    } else {
        return None;
    };

    Some(TagInspectResult { tracks })
}

fn tag_type_name(tag_type: TagType) -> String {
    format!("{tag_type:?}")
}

fn preferred_tag_type(path: &Path, fallback: Option<TagType>) -> Option<TagType> {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "flac" | "ogg" | "opus" => Some(TagType::VorbisComments),
        "m4a" | "mp4" | "aac" | "alac" => Some(TagType::Mp4Ilst),
        "mp3" => Some(TagType::Id3v2),
        "wav" => Some(TagType::RiffInfo),
        "aif" | "aiff" => Some(TagType::AiffText),
        _ => fallback,
    }
}

fn supports_identity_writes(tag_type: TagType) -> bool {
    matches!(
        tag_type,
        TagType::VorbisComments | TagType::Mp4Ilst | TagType::Id3v2 | TagType::Ape
    )
}

fn identity_tags(input: &IdentityTagInput) -> Vec<(String, String)> {
    let mut tags = vec![
        (
            "crate_schema_version".to_string(),
            input.schema_version.trim().to_string(),
        ),
        (
            "crate_artist_uid".to_string(),
            input.artist_uid.trim().to_string(),
        ),
        (
            "crate_album_uid".to_string(),
            input.album_uid.trim().to_string(),
        ),
        (
            "crate_track_uid".to_string(),
            input.track_uid.trim().to_string(),
        ),
    ];
    if let Some(value) = input.audio_fingerprint.as_ref().map(|value| value.trim()) {
        if !value.is_empty() {
            tags.push(("crate_audio_fingerprint".to_string(), value.to_string()));
        }
    }
    if let Some(value) = input
        .audio_fingerprint_source
        .as_ref()
        .map(|value| value.trim())
    {
        if !value.is_empty() {
            tags.push((
                "crate_audio_fingerprint_source".to_string(),
                value.to_string(),
            ));
        }
    }
    tags.into_iter()
        .filter(|(_, value)| !value.is_empty())
        .collect()
}

fn custom_item_key(tag_type: TagType, key: &str) -> ItemKey {
    if tag_type == TagType::Mp4Ilst {
        ItemKey::Unknown(format!("----:com.crate:{key}"))
    } else {
        ItemKey::Unknown(key.to_string())
    }
}

fn insert_identity_tag(tag: &mut Tag, key: &str, value: String) {
    tag.insert_unchecked(TagItem::new(
        custom_item_key(tag.tag_type(), key),
        ItemValue::Text(value),
    ));
}

pub fn write_identity_file(path: PathBuf, input: IdentityTagInput) -> TagWriteIdentityResult {
    let tags = identity_tags(&input);
    let tag_names = tags.iter().map(|(key, _)| key.clone()).collect::<Vec<_>>();
    let path_text = path.to_string_lossy().to_string();

    if !path.is_file() {
        return TagWriteIdentityResult {
            path: path_text,
            written: false,
            dry_run: input.dry_run,
            tag_type: None,
            tags: tag_names,
            error: Some("file not found".to_string()),
        };
    }
    if tags.is_empty() {
        return TagWriteIdentityResult {
            path: path_text,
            written: false,
            dry_run: input.dry_run,
            tag_type: None,
            tags: tag_names,
            error: Some("no identity tags to write".to_string()),
        };
    }

    let tagged = match lofty::read_from_path(&path) {
        Ok(tagged) => tagged,
        Err(error) => {
            return TagWriteIdentityResult {
                path: path_text,
                written: false,
                dry_run: input.dry_run,
                tag_type: None,
                tags: tag_names,
                error: Some(error.to_string()),
            };
        }
    };
    let existing_tag = tagged.primary_tag().or_else(|| tagged.first_tag());
    let tag_type = preferred_tag_type(&path, existing_tag.map(|tag| tag.tag_type()));
    let Some(tag_type) = tag_type else {
        return TagWriteIdentityResult {
            path: path_text,
            written: false,
            dry_run: input.dry_run,
            tag_type: None,
            tags: tag_names,
            error: Some("unsupported audio tag type".to_string()),
        };
    };
    if !supports_identity_writes(tag_type) {
        return TagWriteIdentityResult {
            path: path_text,
            written: false,
            dry_run: input.dry_run,
            tag_type: Some(tag_type_name(tag_type)),
            tags: tag_names,
            error: Some("tag type does not support Crate identity custom keys".to_string()),
        };
    }

    if input.dry_run {
        return TagWriteIdentityResult {
            path: path_text,
            written: false,
            dry_run: true,
            tag_type: Some(tag_type_name(tag_type)),
            tags: tag_names,
            error: None,
        };
    }

    let mut tag = existing_tag
        .filter(|tag| tag.tag_type() == tag_type)
        .cloned()
        .unwrap_or_else(|| Tag::new(tag_type));
    for (key, value) in tags {
        insert_identity_tag(&mut tag, &key, value);
    }

    match tag.save_to_path(&path, WriteOptions::default()) {
        Ok(()) => TagWriteIdentityResult {
            path: path_text,
            written: true,
            dry_run: false,
            tag_type: Some(tag_type_name(tag_type)),
            tags: tag_names,
            error: None,
        },
        Err(error) => TagWriteIdentityResult {
            path: path_text,
            written: false,
            dry_run: false,
            tag_type: Some(tag_type_name(tag_type)),
            tags: tag_names,
            error: Some(error.to_string()),
        },
    }
}

pub fn run_tags_inspect(file: Option<PathBuf>, dir: Option<PathBuf>, extensions: String) {
    match inspect_paths(file, dir, extensions) {
        Some(result) => println!("{}", serde_json::to_string(&result).unwrap_or_default()),
        None => {
            eprintln!("provide --file or --dir");
            std::process::exit(2);
        }
    }
}

pub fn run_tags_write_identity(file: PathBuf, input: IdentityTagInput) {
    let result = write_identity_file(file, input);
    let failed = result.error.is_some() && !result.dry_run;
    println!("{}", serde_json::to_string(&result).unwrap_or_default());
    if failed {
        std::process::exit(1);
    }
}
