use std::fs;
use std::path::Path;

use lofty::config::WriteOptions;
use lofty::file::TaggedFileExt;
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::prelude::*;
use lofty::tag::{ItemKey, ItemValue, Tag, TagItem, TagType};
use serde_json::Value;

const TAG_SCHEMA_VERSION: &str = "1";

pub fn write_rich_tags(
    path: &Path,
    track_payload: &Value,
    package_payload: Option<&Value>,
    artwork_path: Option<&Path>,
) -> Result<Vec<String>, String> {
    if !path.is_file() {
        return Err(format!("track copy does not exist: {}", path.display()));
    }

    let tagged = lofty::read_from_path(path).map_err(|err| err.to_string())?;
    let existing_tag = tagged.primary_tag().or_else(|| tagged.first_tag());
    let tag_type = preferred_tag_type(path, existing_tag.map(|tag| tag.tag_type()))
        .ok_or_else(|| "unsupported audio tag type".to_string())?;
    if !supports_rich_writes(tag_type) {
        return Err(format!(
            "tag type {tag_type:?} does not support Crate rich export tags"
        ));
    }

    let mut tag = existing_tag
        .filter(|tag| tag.tag_type() == tag_type)
        .cloned()
        .unwrap_or_else(|| Tag::new(tag_type));

    let mut written = Vec::new();
    for (key, value) in rich_tags(track_payload, package_payload) {
        insert_custom_text(&mut tag, &key, value);
        written.push(key);
    }

    if let Some(plain) = text_at(track_payload, &["lyrics", "plain"])
        .or_else(|| text_at(track_payload, &["lyrics", "plainLyrics"]))
    {
        if tag.insert_text(ItemKey::Lyrics, plain) {
            written.push("lyrics".to_string());
        }
    }

    if let Some(artwork) = artwork_path.filter(|path| path.is_file()) {
        tag.remove_picture_type(PictureType::CoverFront);
        let mime_type = image_mime(artwork)
            .ok_or_else(|| format!("unsupported artwork format: {}", artwork.display()))?;
        tag.push_picture(Picture::new_unchecked(
            PictureType::CoverFront,
            Some(mime_type),
            Some("Cover".to_string()),
            fs::read(artwork)
                .map_err(|err| format!("read artwork {}: {err}", artwork.display()))?,
        ));
        written.push("artwork".to_string());
    }

    tag.save_to_path(path, WriteOptions::default())
        .map_err(|err| err.to_string())?;
    written.sort();
    Ok(written)
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
        _ => fallback,
    }
}

fn supports_rich_writes(tag_type: TagType) -> bool {
    matches!(
        tag_type,
        TagType::VorbisComments | TagType::Mp4Ilst | TagType::Id3v2 | TagType::Ape
    )
}

fn rich_tags(track_payload: &Value, package_payload: Option<&Value>) -> Vec<(String, String)> {
    let artist_uid = text_at(track_payload, &["artist_entity_uid"]).or_else(|| {
        package_payload.and_then(|payload| text_at(payload, &["artist", "entity_uid"]))
    });
    let album_uid = text_at(track_payload, &["album_entity_uid"])
        .or_else(|| package_payload.and_then(|payload| text_at(payload, &["album", "entity_uid"])));
    let track_uid = text_at(track_payload, &["entity_uid"]);

    let mut tags = vec![(
        "crate_schema_version".to_string(),
        TAG_SCHEMA_VERSION.to_string(),
    )];
    push_if_some(&mut tags, "crate_artist_uid", artist_uid);
    push_if_some(&mut tags, "crate_album_uid", album_uid);
    push_if_some(&mut tags, "crate_track_uid", track_uid);
    push_if_some(
        &mut tags,
        "crate_audio_fingerprint",
        text_at(track_payload, &["audio_fingerprint"]),
    );
    push_if_some(
        &mut tags,
        "crate_audio_fingerprint_source",
        text_at(track_payload, &["audio_fingerprint_source"]),
    );

    let plain = text_at(track_payload, &["lyrics", "plain"])
        .or_else(|| text_at(track_payload, &["lyrics", "plainLyrics"]));
    let synced = text_at(track_payload, &["lyrics", "synced"])
        .or_else(|| text_at(track_payload, &["lyrics", "syncedLyrics"]));
    push_if_some(&mut tags, "crate_plain_lyrics", plain.clone());
    push_if_some(&mut tags, "unsyncedlyrics", plain);
    push_if_some(&mut tags, "crate_synced_lyrics", synced.clone());
    push_if_some(&mut tags, "syncedlyrics", synced);

    if let Some(analysis) = object_at(track_payload, &["analysis"]) {
        if !analysis
            .as_object()
            .map(|value| value.is_empty())
            .unwrap_or(true)
        {
            push_if_some(
                &mut tags,
                "crate_analysis_json",
                serde_json::to_string(analysis).ok(),
            );
        }
    }
    if let Some(vector) = vector_at(track_payload, &["bliss", "vector"]) {
        push_if_some(&mut tags, "crate_bliss_vector", Some(vector));
    }

    tags.into_iter()
        .filter(|(_, value)| !value.trim().is_empty())
        .collect()
}

fn push_if_some(tags: &mut Vec<(String, String)>, key: &str, value: Option<String>) {
    if let Some(value) = value {
        let text = value.trim();
        if !text.is_empty() {
            tags.push((key.to_string(), text.to_string()));
        }
    }
}

fn insert_custom_text(tag: &mut Tag, key: &str, value: String) {
    let item_key = if tag.tag_type() == TagType::Mp4Ilst {
        ItemKey::Unknown(format!("----:com.crate:{key}"))
    } else {
        ItemKey::Unknown(key.to_string())
    };
    tag.insert_unchecked(TagItem::new(item_key, ItemValue::Text(value)));
}

fn text_at(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    match current {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

fn object_at<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.is_object().then_some(current)
}

fn vector_at(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    let values = current.as_array()?;
    if values.is_empty() {
        return None;
    }
    Some(
        values
            .iter()
            .filter_map(|value| match value {
                Value::Number(number) => Some(number.to_string()),
                Value::String(text) => Some(text.clone()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join(","),
    )
}

fn image_mime(path: &Path) -> Option<MimeType> {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => Some(MimeType::Jpeg),
        "png" => Some(MimeType::Png),
        "gif" => Some(MimeType::Gif),
        "bmp" => Some(MimeType::Bmp),
        "tif" | "tiff" => Some(MimeType::Tiff),
        _ => None,
    }
}
