use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::cache::{finalize_download_cache, CacheFinalizeResult, DownloadCachePolicy};
use crate::metadata::write_rich_tags;
use crate::progress::ProgressSink;
use crate::zip::StoredZipWriter;

#[derive(Debug, Deserialize)]
pub struct PackageJob {
    pub job_id: Option<String>,
    pub output_path: String,
    pub filename: Option<String>,
    pub progress_path: Option<String>,
    pub cancel_path: Option<String>,
    pub staging_dir: Option<String>,
    #[serde(default)]
    pub write_rich_tags: bool,
    pub cache: Option<DownloadCachePolicy>,
    pub primary_artwork_path: Option<String>,
    #[serde(default)]
    pub tracks: Vec<PackageEntry>,
    #[serde(default)]
    pub artwork_files: Vec<PackageEntry>,
    #[serde(default)]
    pub extra_files: Vec<PackageEntry>,
    pub sidecar_json: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub struct PackageEntry {
    pub source_path: String,
    pub relative_path: Option<String>,
    pub filename: Option<String>,
    pub kind: Option<String>,
    pub artwork_path: Option<String>,
    pub metadata: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub struct TrackArtifactJob {
    pub job_id: Option<String>,
    pub source_path: String,
    pub output_path: String,
    pub filename: Option<String>,
    pub progress_path: Option<String>,
    pub cancel_path: Option<String>,
    pub artwork_path: Option<String>,
    pub metadata: Option<Value>,
    pub package_json: Option<Value>,
    #[serde(default)]
    pub write_rich_tags: bool,
    pub cache: Option<DownloadCachePolicy>,
}

#[derive(Debug, Serialize)]
pub struct PackageResult {
    pub ok: bool,
    pub job_id: Option<String>,
    pub output_path: String,
    pub filename: Option<String>,
    pub entries: Vec<PackagedEntry>,
    pub bytes: u64,
    pub duration_ms: u128,
    pub cache: Option<CacheFinalizeResult>,
    pub errors: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct TrackArtifactResult {
    pub ok: bool,
    pub job_id: Option<String>,
    pub source_path: String,
    pub output_path: String,
    pub filename: Option<String>,
    pub bytes: u64,
    pub duration_ms: u128,
    pub tags: Vec<String>,
    pub cache: Option<CacheFinalizeResult>,
    pub errors: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct PackagedEntry {
    pub kind: String,
    pub name: String,
    pub source_path: Option<String>,
    pub bytes: u64,
}

pub fn build_album_package(job: PackageJob) -> PackageResult {
    let started = Instant::now();
    let output_path = PathBuf::from(&job.output_path);
    let progress = ProgressSink::new(
        job.job_id.clone(),
        job.progress_path.as_deref(),
        job.cancel_path.as_deref(),
    );
    let mut result = PackageResult {
        ok: false,
        job_id: job.job_id.clone(),
        output_path: job.output_path.clone(),
        filename: job.filename.clone(),
        entries: Vec::new(),
        bytes: 0,
        duration_ms: 0,
        cache: None,
        errors: Vec::new(),
    };
    progress.emit(
        "started",
        json!({
            "kind": "album",
            "output_path": job.output_path.clone(),
            "total_entries": job.tracks.len() + job.artwork_files.len() + job.extra_files.len() + usize::from(job.sidecar_json.is_some()),
        }),
    );

    if let Err(err) = progress.check_cancelled() {
        result.errors.push(err);
        return finish_result(result, started, &progress);
    }

    if let Err(err) = ensure_parent_dir(&output_path) {
        result
            .errors
            .push(format!("create output directory: {err}"));
        finish_result(result, started, &progress)
    } else {
        let tmp_path = temporary_output_path(&output_path);
        match build_zip(&job, &tmp_path, &mut result, &progress) {
            Ok(()) if result.errors.is_empty() => {
                if let Err(err) = fs::rename(&tmp_path, &output_path) {
                    result
                        .errors
                        .push(format!("publish package {}: {err}", output_path.display()));
                    let _ = fs::remove_file(&tmp_path);
                } else {
                    result.bytes = fs::metadata(&output_path)
                        .map(|meta| meta.len())
                        .unwrap_or(0);
                    result.ok = true;
                    if let Some(cache) = job.cache.as_ref() {
                        progress.emit("cache_started", json!({"kind": "album", "output_path": job.output_path.clone()}));
                        match finalize_download_cache(cache, &output_path, result.bytes) {
                            Ok(cache_result) => {
                                progress.emit(
                                    "cache_finished",
                                    json!({
                                        "kind": "album",
                                        "removed": cache_result.pruned.removed,
                                        "bytes_removed": cache_result.pruned.bytes_removed,
                                    }),
                                );
                                result.cache = Some(cache_result);
                            }
                            Err(err) => {
                                result.ok = false;
                                result.errors.push(format!("cache finalize: {err}"));
                                let _ = fs::remove_file(&output_path);
                            }
                        }
                    }
                }
            }
            Ok(()) => {
                let _ = fs::remove_file(&tmp_path);
            }
            Err(err) => {
                result.errors.push(err);
                let _ = fs::remove_file(&tmp_path);
            }
        }
        finish_result(result, started, &progress)
    }
}

pub fn build_track_artifact(job: TrackArtifactJob) -> TrackArtifactResult {
    let started = Instant::now();
    let source_path = PathBuf::from(&job.source_path);
    let output_path = PathBuf::from(&job.output_path);
    let progress = ProgressSink::new(
        job.job_id.clone(),
        job.progress_path.as_deref(),
        job.cancel_path.as_deref(),
    );
    let mut result = TrackArtifactResult {
        ok: false,
        job_id: job.job_id.clone(),
        source_path: job.source_path.clone(),
        output_path: job.output_path.clone(),
        filename: job.filename.clone(),
        bytes: 0,
        duration_ms: 0,
        tags: Vec::new(),
        cache: None,
        errors: Vec::new(),
    };
    progress.emit(
        "started",
        json!({
            "kind": "track",
            "source_path": job.source_path.clone(),
            "output_path": job.output_path.clone(),
        }),
    );

    if let Err(err) = progress.check_cancelled() {
        result.errors.push(err);
        return finish_track_result(result, started, &progress);
    }

    if !source_path.is_file() {
        result
            .errors
            .push(format!("source track not found: {}", source_path.display()));
        return finish_track_result(result, started, &progress);
    }
    if let Err(err) = ensure_parent_dir(&output_path) {
        result
            .errors
            .push(format!("create output directory: {err}"));
        return finish_track_result(result, started, &progress);
    }

    let tmp_path = temporary_audio_output_path(&output_path);
    progress.emit(
        "copy_started",
        json!({"source_path": source_path.display().to_string(), "target_path": tmp_path.display().to_string()}),
    );
    let should_cancel = || progress.is_cancelled();
    if let Err(err) = copy_file_checked(&source_path, &tmp_path, &should_cancel) {
        result.errors.push(format!(
            "copy {} to {}: {err}",
            source_path.display(),
            tmp_path.display()
        ));
        let _ = fs::remove_file(&tmp_path);
        return finish_track_result(result, started, &progress);
    }
    progress.emit(
        "copy_finished",
        json!({"target_path": tmp_path.display().to_string()}),
    );

    if job.write_rich_tags {
        if let Err(err) = progress.check_cancelled() {
            result.errors.push(err);
        }
        if result.errors.is_empty() {
            match job.metadata.as_ref() {
                Some(metadata) => {
                    let artwork = job.artwork_path.as_deref().map(Path::new);
                    progress.emit(
                        "metadata_started",
                        json!({"target_path": tmp_path.display().to_string()}),
                    );
                    match write_rich_tags(&tmp_path, metadata, job.package_json.as_ref(), artwork) {
                        Ok(tags) => {
                            result.tags = tags;
                            progress
                                .emit("metadata_finished", json!({"tags": result.tags.clone()}));
                        }
                        Err(err) => result.errors.push(format!("write rich tags: {err}")),
                    }
                }
                None => result
                    .errors
                    .push("rich track artifact is missing metadata".to_string()),
            }
        }
    }

    if result.errors.is_empty() {
        if let Err(err) = fs::rename(&tmp_path, &output_path) {
            result.errors.push(format!(
                "publish track artifact {}: {err}",
                output_path.display()
            ));
            let _ = fs::remove_file(&tmp_path);
        } else {
            result.bytes = fs::metadata(&output_path)
                .map(|meta| meta.len())
                .unwrap_or(0);
            result.ok = true;
            if let Some(cache) = job.cache.as_ref() {
                progress.emit("cache_started", json!({"kind": "track", "output_path": job.output_path.clone()}));
                match finalize_download_cache(cache, &output_path, result.bytes) {
                    Ok(cache_result) => {
                        progress.emit(
                            "cache_finished",
                            json!({
                                "kind": "track",
                                "removed": cache_result.pruned.removed,
                                "bytes_removed": cache_result.pruned.bytes_removed,
                            }),
                        );
                        result.cache = Some(cache_result);
                    }
                    Err(err) => {
                        result.ok = false;
                        result.errors.push(format!("cache finalize: {err}"));
                        let _ = fs::remove_file(&output_path);
                    }
                }
            }
        }
    } else {
        let _ = fs::remove_file(&tmp_path);
    }

    finish_track_result(result, started, &progress)
}

fn build_zip(
    job: &PackageJob,
    tmp_path: &Path,
    result: &mut PackageResult,
    progress: &ProgressSink,
) -> Result<(), String> {
    let file = File::create(tmp_path)
        .map_err(|err| format!("create temporary package {}: {err}", tmp_path.display()))?;
    let mut zip = StoredZipWriter::new(file);
    let mut names = HashSet::new();
    let staging_root = if job.write_rich_tags {
        Some(create_staging_root(job, tmp_path)?)
    } else {
        None
    };

    let build_result = (|| {
        let total_entries = job.tracks.len()
            + job.artwork_files.len()
            + job.extra_files.len()
            + usize::from(job.sidecar_json.is_some());
        let mut entry_index = 0usize;
        for entry in &job.tracks {
            add_source_entry(
                "track",
                entry,
                &mut names,
                &mut zip,
                result,
                staging_root.as_deref(),
                job.primary_artwork_path.as_deref(),
                job.sidecar_json.as_ref(),
                progress,
                total_entries,
                &mut entry_index,
            )?;
        }
        for entry in &job.artwork_files {
            add_source_entry(
                "artwork",
                entry,
                &mut names,
                &mut zip,
                result,
                None,
                None,
                None,
                progress,
                total_entries,
                &mut entry_index,
            )?;
        }
        for entry in &job.extra_files {
            add_source_entry(
                entry.kind.as_deref().unwrap_or("extra"),
                entry,
                &mut names,
                &mut zip,
                result,
                None,
                None,
                None,
                progress,
                total_entries,
                &mut entry_index,
            )?;
        }

        if let Some(sidecar) = &job.sidecar_json {
            progress.check_cancelled()?;
            let bytes = serde_json::to_vec_pretty(sidecar)
                .map_err(|err| format!("serialize sidecar metadata: {err}"))?;
            let name = unique_name(".crate/album.json", &mut names);
            entry_index += 1;
            progress.emit(
                "entry_started",
                json!({"kind": "sidecar", "name": name.clone(), "index": entry_index, "total": total_entries}),
            );
            let written = zip
                .add_bytes(&name, &bytes)
                .map_err(|err| format!("write sidecar {name}: {err}"))?;
            result.entries.push(PackagedEntry {
                kind: "sidecar".to_string(),
                name: name.clone(),
                source_path: None,
                bytes: written,
            });
            progress.emit(
                "entry_finished",
                json!({"kind": "sidecar", "name": name.clone(), "index": entry_index, "total": total_entries, "bytes": written}),
            );
        }

        if result.entries.is_empty() && result.errors.is_empty() {
            result
                .errors
                .push("package job contains no entries".to_string());
        }

        zip.finish()
            .map_err(|err| format!("finish package zip: {err}"))?;
        Ok(())
    })();

    if let Some(staging_root) = staging_root {
        let _ = fs::remove_dir_all(staging_root);
    }
    build_result
}

fn add_source_entry(
    default_kind: &str,
    entry: &PackageEntry,
    names: &mut HashSet<String>,
    zip: &mut StoredZipWriter<File>,
    result: &mut PackageResult,
    staging_root: Option<&Path>,
    primary_artwork_path: Option<&str>,
    package_payload: Option<&Value>,
    progress: &ProgressSink,
    total_entries: usize,
    entry_index: &mut usize,
) -> Result<(), String> {
    let source = PathBuf::from(&entry.source_path);
    let fallback = entry
        .filename
        .as_deref()
        .or_else(|| source.file_name().and_then(|value| value.to_str()))
        .unwrap_or("track");
    let requested_name = entry
        .relative_path
        .as_deref()
        .or(entry.filename.as_deref())
        .unwrap_or(fallback);
    let name = unique_name(&safe_entry_name(requested_name, fallback), names);
    let kind = entry.kind.as_deref().unwrap_or(default_kind).to_string();
    *entry_index += 1;
    progress.check_cancelled()?;
    progress.emit(
        "entry_started",
        json!({"kind": kind.clone(), "name": name.clone(), "index": *entry_index, "total": total_entries}),
    );

    if !source.is_file() {
        result.errors.push(format!(
            "missing source for {kind} {name}: {}",
            source.display()
        ));
        progress.emit(
            "entry_failed",
            json!({"kind": kind.clone(), "name": name.clone(), "index": *entry_index, "total": total_entries, "error": "missing source"}),
        );
        return Ok(());
    }

    let staged_path;
    let should_cancel = || progress.is_cancelled();
    let source_for_zip = if kind == "track" {
        if let Some(root) = staging_root {
            let metadata = entry
                .metadata
                .as_ref()
                .ok_or_else(|| format!("rich package track {name} is missing metadata"))?;
            staged_path = Some(stage_track_copy(&source, root, &name, &should_cancel)?);
            progress.check_cancelled()?;
            let artwork = entry.artwork_path.as_deref().or(primary_artwork_path);
            write_rich_tags(
                staged_path.as_ref().expect("staged track exists"),
                metadata,
                package_payload,
                artwork.map(Path::new),
            )
            .map_err(|err| format!("write rich tags for {name}: {err}"))?;
            staged_path.as_ref().expect("staged track exists")
        } else {
            &source
        }
    } else {
        &source
    };

    let written = zip
        .add_file_checked(&name, source_for_zip, Some(&should_cancel))
        .map_err(|err| format!("write {kind} {name}: {err}"))?;
    result.entries.push(PackagedEntry {
        kind,
        name,
        source_path: Some(source.display().to_string()),
        bytes: written,
    });
    if let Some(entry) = result.entries.last() {
        progress.emit(
            "entry_finished",
            json!({"kind": entry.kind.clone(), "name": entry.name.clone(), "index": *entry_index, "total": total_entries, "bytes": written}),
        );
    }
    Ok(())
}

fn create_staging_root(job: &PackageJob, tmp_path: &Path) -> Result<PathBuf, String> {
    let root = if let Some(staging_dir) = job.staging_dir.as_ref() {
        PathBuf::from(staging_dir)
    } else {
        let base = tmp_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(std::env::temp_dir);
        let job_id = safe_leaf_name(job.job_id.as_deref().unwrap_or("package"));
        base.join(".crate-media-worker-staging").join(job_id)
    };
    if root.exists() {
        fs::remove_dir_all(&root)
            .map_err(|err| format!("clear staging directory {}: {err}", root.display()))?;
    }
    fs::create_dir_all(&root)
        .map_err(|err| format!("create staging directory {}: {err}", root.display()))?;
    Ok(root)
}

fn stage_track_copy(
    source: &Path,
    staging_root: &Path,
    entry_name: &str,
    cancel_check: &dyn Fn() -> bool,
) -> Result<PathBuf, String> {
    let target = staging_root.join(entry_name);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("create staged parent {}: {err}", parent.display()))?;
    }
    copy_file_checked(source, &target, cancel_check)
        .map_err(|err| format!("copy {} to {}: {err}", source.display(), target.display()))?;
    Ok(target)
}

fn copy_file_checked(
    source: &Path,
    target: &Path,
    cancel_check: &dyn Fn() -> bool,
) -> std::io::Result<u64> {
    let mut reader = File::open(source)?;
    let mut writer = File::create(target)?;
    let mut buffer = [0_u8; 1024 * 1024];
    let mut written = 0_u64;
    loop {
        if cancel_check() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Interrupted,
                "job cancelled",
            ));
        }
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        writer.write_all(&buffer[..read])?;
        written += read as u64;
    }
    writer.flush()?;
    Ok(written)
}

fn finish_result(
    mut result: PackageResult,
    started: Instant,
    progress: &ProgressSink,
) -> PackageResult {
    result.duration_ms = started.elapsed().as_millis();
    if result.ok {
        progress.emit(
            "finished",
            json!({"kind": "album", "bytes": result.bytes, "duration_ms": result.duration_ms, "entries": result.entries.len()}),
        );
    } else if result.errors.iter().any(|error| error == "job cancelled") {
        progress.emit(
            "cancelled",
            json!({"kind": "album", "errors": result.errors.clone()}),
        );
    } else {
        progress.emit(
            "failed",
            json!({"kind": "album", "errors": result.errors.clone()}),
        );
    }
    result
}

fn finish_track_result(
    mut result: TrackArtifactResult,
    started: Instant,
    progress: &ProgressSink,
) -> TrackArtifactResult {
    result.duration_ms = started.elapsed().as_millis();
    if result.ok {
        progress.emit(
            "finished",
            json!({"kind": "track", "bytes": result.bytes, "duration_ms": result.duration_ms, "tags": result.tags.clone()}),
        );
    } else if result.errors.iter().any(|error| error == "job cancelled") {
        progress.emit(
            "cancelled",
            json!({"kind": "track", "errors": result.errors.clone()}),
        );
    } else {
        progress.emit(
            "failed",
            json!({"kind": "track", "errors": result.errors.clone()}),
        );
    }
    result
}

fn ensure_parent_dir(path: &Path) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    Ok(())
}

fn temporary_output_path(path: &Path) -> PathBuf {
    let filename = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("package.zip");
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    path.with_file_name(format!(".{filename}.{}.{}.tmp", process::id(), millis))
}

fn temporary_audio_output_path(path: &Path) -> PathBuf {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("track");
    let extension = path.extension().and_then(|value| value.to_str());
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let tmp_name = match extension {
        Some(extension) if !extension.is_empty() => {
            format!(".{stem}.{}.{}.tmp.{extension}", process::id(), millis)
        }
        _ => format!(".{stem}.{}.{}.tmp", process::id(), millis),
    };
    path.with_file_name(tmp_name)
}

fn unique_name(raw: &str, names: &mut HashSet<String>) -> String {
    let mut candidate = raw.to_string();
    if names.insert(candidate.clone()) {
        return candidate;
    }

    let path = Path::new(raw);
    let parent = path.parent().and_then(|value| value.to_str()).unwrap_or("");
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(raw);
    let extension = path.extension().and_then(|value| value.to_str());
    for index in 2.. {
        let leaf = match extension {
            Some(extension) if !extension.is_empty() => format!("{stem} ({index}).{extension}"),
            _ => format!("{stem} ({index})"),
        };
        candidate = if parent.is_empty() {
            leaf
        } else {
            format!("{parent}/{leaf}")
        };
        if names.insert(candidate.clone()) {
            return candidate;
        }
    }
    unreachable!()
}

fn safe_entry_name(raw: &str, fallback: &str) -> String {
    let normalized = raw.replace('\\', "/");
    if normalized.trim().is_empty() || normalized.starts_with('/') || normalized.contains('\0') {
        return safe_leaf_name(fallback);
    }

    let mut parts = Vec::new();
    for component in Path::new(&normalized).components() {
        match component {
            Component::Normal(value) => {
                let part = value.to_string_lossy();
                let safe = safe_leaf_name(&part);
                if !safe.is_empty() {
                    parts.push(safe);
                }
            }
            Component::CurDir => {}
            _ => return safe_leaf_name(fallback),
        }
    }

    if parts.is_empty() {
        safe_leaf_name(fallback)
    } else {
        parts.join("/")
    }
}

fn safe_leaf_name(raw: &str) -> String {
    let sanitized: String = raw
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' if cfg!(windows) => '_',
            '/' | '\\' | '\0' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect();
    let trimmed = sanitized.trim_matches('.').trim();
    if trimmed.is_empty() {
        "entry".to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use serde_json::json;

    use crate::cache::DownloadCachePolicy;

    use super::{
        build_album_package, build_track_artifact, PackageEntry, PackageJob, TrackArtifactJob,
    };

    #[test]
    fn builds_album_zip_with_sidecar() {
        let root = test_dir("album_zip");
        fs::create_dir_all(&root).unwrap();
        let track = root.join("track.flac");
        let cover = root.join("cover.jpg");
        fs::write(&track, b"fake flac").unwrap();
        fs::write(&cover, b"fake jpg").unwrap();
        let output = root.join("Artist - Album.zip");

        let result = build_album_package(PackageJob {
            job_id: Some("job-1".to_string()),
            output_path: output.display().to_string(),
            filename: Some("Artist - Album.zip".to_string()),
            progress_path: None,
            cancel_path: None,
            staging_dir: None,
            write_rich_tags: false,
            cache: None,
            primary_artwork_path: None,
            tracks: vec![PackageEntry {
                source_path: track.display().to_string(),
                relative_path: Some("01 - Song.flac".to_string()),
                filename: None,
                kind: None,
                artwork_path: None,
                metadata: None,
            }],
            artwork_files: vec![PackageEntry {
                source_path: cover.display().to_string(),
                relative_path: Some("cover.jpg".to_string()),
                filename: None,
                kind: None,
                artwork_path: None,
                metadata: None,
            }],
            extra_files: Vec::new(),
            sidecar_json: Some(json!({"album": {"title": "Album"}})),
        });

        assert!(result.ok, "{result:#?}");
        assert_eq!(result.entries.len(), 3);
        assert!(output.is_file());
        let bytes = fs::read(&output).unwrap();
        assert!(bytes.starts_with(b"PK\x03\x04"));
        assert!(contains(&bytes, b"01 - Song.flac"));
        assert!(contains(&bytes, b"cover.jpg"));
        assert!(contains(&bytes, b".crate/album.json"));
    }

    #[test]
    fn sanitizes_traversal_paths() {
        let root = test_dir("traversal");
        fs::create_dir_all(&root).unwrap();
        let track = root.join("track.flac");
        fs::write(&track, b"fake flac").unwrap();
        let output = root.join("album.zip");

        let result = build_album_package(PackageJob {
            job_id: None,
            output_path: output.display().to_string(),
            filename: None,
            progress_path: None,
            cancel_path: None,
            staging_dir: None,
            write_rich_tags: false,
            cache: None,
            primary_artwork_path: None,
            tracks: vec![PackageEntry {
                source_path: track.display().to_string(),
                relative_path: Some("../outside.flac".to_string()),
                filename: Some("safe.flac".to_string()),
                kind: None,
                artwork_path: None,
                metadata: None,
            }],
            artwork_files: Vec::new(),
            extra_files: Vec::new(),
            sidecar_json: None,
        });

        assert!(result.ok, "{result:#?}");
        assert_eq!(result.entries[0].name, "safe.flac");
        let bytes = fs::read(&output).unwrap();
        assert!(contains(&bytes, b"safe.flac"));
        assert!(!contains(&bytes, b"../outside.flac"));
    }

    #[test]
    fn album_package_registers_download_cache_manifest() {
        let root = test_dir("album_cache");
        let cache_root = root.join("cache");
        fs::create_dir_all(&root).unwrap();
        let track = root.join("track.flac");
        fs::write(&track, b"fake flac").unwrap();
        let output = cache_root.join("album/cc/cc/cache-key/Album.zip");

        let result = build_album_package(PackageJob {
            job_id: Some("cache-key".to_string()),
            output_path: output.display().to_string(),
            filename: Some("Album.zip".to_string()),
            progress_path: None,
            cancel_path: None,
            staging_dir: None,
            write_rich_tags: false,
            cache: Some(DownloadCachePolicy {
                root: cache_root.display().to_string(),
                kind: "album".to_string(),
                key: "cache-key".to_string(),
                filename: "Album.zip".to_string(),
                max_bytes: 1024 * 1024,
                album_ttl_seconds: 3600,
                track_ttl_seconds: 3600,
                metadata: Some(json!({"engine": "crate-media-worker"})),
            }),
            primary_artwork_path: None,
            tracks: vec![PackageEntry {
                source_path: track.display().to_string(),
                relative_path: Some("01 Song.flac".to_string()),
                filename: None,
                kind: None,
                artwork_path: None,
                metadata: None,
            }],
            artwork_files: Vec::new(),
            extra_files: Vec::new(),
            sidecar_json: None,
        });

        assert!(result.ok, "{result:#?}");
        assert!(result.cache.is_some());
        assert!(output.with_file_name("manifest.json").is_file());
    }

    #[test]
    fn builds_track_artifact_copy() {
        let root = test_dir("track_artifact");
        fs::create_dir_all(&root).unwrap();
        let source = root.join("source.flac");
        let output = root.join("track.flac");
        fs::write(&source, b"fake flac").unwrap();

        let result = build_track_artifact(TrackArtifactJob {
            job_id: Some("track-job".to_string()),
            source_path: source.display().to_string(),
            output_path: output.display().to_string(),
            filename: Some("track.flac".to_string()),
            progress_path: None,
            cancel_path: None,
            artwork_path: None,
            metadata: None,
            package_json: None,
            write_rich_tags: false,
            cache: None,
        });

        assert!(result.ok, "{result:#?}");
        assert_eq!(result.bytes, 9);
        assert_eq!(fs::read(&output).unwrap(), b"fake flac");
    }

    #[test]
    fn emits_progress_events_and_honors_cancel_file() {
        let root = test_dir("progress");
        fs::create_dir_all(&root).unwrap();
        let source = root.join("source.flac");
        let output = root.join("track.flac");
        let progress_path = root.join("progress.jsonl");
        let cancel_path = root.join("cancel");
        fs::write(&source, b"fake flac").unwrap();
        fs::write(&cancel_path, b"cancel").unwrap();

        let result = build_track_artifact(TrackArtifactJob {
            job_id: Some("cancelled-track".to_string()),
            source_path: source.display().to_string(),
            output_path: output.display().to_string(),
            filename: Some("track.flac".to_string()),
            progress_path: Some(progress_path.display().to_string()),
            cancel_path: Some(cancel_path.display().to_string()),
            artwork_path: None,
            metadata: None,
            package_json: None,
            write_rich_tags: false,
            cache: None,
        });

        assert!(!result.ok);
        assert_eq!(result.errors, vec!["job cancelled"]);
        let events = fs::read_to_string(progress_path).unwrap();
        assert!(events.contains("\"event\":\"started\""));
        assert!(events.contains("\"event\":\"cancelled\""));
    }

    fn test_dir(name: &str) -> PathBuf {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();
        std::env::temp_dir().join(format!(
            "crate-media-worker-{name}-{}-{millis}",
            std::process::id()
        ))
    }

    fn contains(haystack: &[u8], needle: &[u8]) -> bool {
        haystack
            .windows(needle.len())
            .any(|window| window == needle)
    }
}
