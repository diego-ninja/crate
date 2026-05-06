use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const CACHE_VERSION: &str = "1";

#[derive(Clone, Debug, Deserialize)]
pub struct DownloadCachePolicy {
    pub root: String,
    pub kind: String,
    pub key: String,
    pub filename: String,
    #[serde(default)]
    pub max_bytes: u64,
    #[serde(default)]
    pub album_ttl_seconds: u64,
    #[serde(default)]
    pub track_ttl_seconds: u64,
    pub metadata: Option<Value>,
}

#[derive(Clone, Debug, Serialize)]
pub struct CacheFinalizeResult {
    pub registered: bool,
    pub manifest_path: String,
    pub pruned: CachePruneResult,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct CachePruneResult {
    pub removed: u64,
    pub bytes_removed: u64,
    pub bytes: u64,
    pub limit: u64,
}

struct CacheArtifact {
    dir: PathBuf,
    manifest: Value,
    bytes: u64,
}

pub fn finalize_download_cache(
    policy: &DownloadCachePolicy,
    artifact_path: &Path,
    bytes: u64,
) -> Result<CacheFinalizeResult, String> {
    if policy.kind.trim().is_empty() {
        return Err("cache kind is required".to_string());
    }
    if policy.key.trim().is_empty() {
        return Err("cache key is required".to_string());
    }
    if policy.filename.trim().is_empty() {
        return Err("cache filename is required".to_string());
    }
    if policy.max_bytes == 0 {
        let _ = fs::remove_file(artifact_path);
        return Err("download cache max bytes is zero".to_string());
    }
    if bytes > policy.max_bytes {
        let _ = fs::remove_file(artifact_path);
        return Err(format!(
            "artifact size {bytes} exceeds download cache limit {}",
            policy.max_bytes
        ));
    }
    if !artifact_path.is_file() {
        return Err(format!("cache artifact not found: {}", artifact_path.display()));
    }

    let manifest_path = artifact_path
        .parent()
        .ok_or_else(|| "cache artifact has no parent directory".to_string())?
        .join("manifest.json");
    let now = timestamp_seconds();
    let manifest = json!({
        "version": CACHE_VERSION,
        "kind": policy.kind,
        "key": policy.key,
        "filename": artifact_path.file_name().and_then(|value| value.to_str()).unwrap_or(&policy.filename),
        "bytes": bytes,
        "created_at": now,
        "last_accessed_at": now,
        "metadata": policy.metadata.clone().unwrap_or_else(|| json!({})),
    });
    write_json_atomic(&manifest_path, &manifest)?;

    let pruned = prune_download_cache(
        Path::new(&policy.root),
        policy.max_bytes,
        policy.album_ttl_seconds,
        policy.track_ttl_seconds,
        artifact_path.parent(),
    );

    Ok(CacheFinalizeResult {
        registered: true,
        manifest_path: manifest_path.display().to_string(),
        pruned,
    })
}

fn prune_download_cache(
    root: &Path,
    max_bytes: u64,
    album_ttl_seconds: u64,
    track_ttl_seconds: u64,
    protected_dir: Option<&Path>,
) -> CachePruneResult {
    let mut result = CachePruneResult {
        limit: max_bytes,
        ..CachePruneResult::default()
    };
    if max_bytes == 0 {
        let _ = fs::remove_dir_all(root);
        return result;
    }

    let now = timestamp_seconds();
    let mut survivors = Vec::new();
    for artifact in collect_artifacts(root) {
        let kind = artifact
            .manifest
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("");
        let ttl = if kind == "album" {
            album_ttl_seconds
        } else {
            track_ttl_seconds
        };
        let created_at = artifact
            .manifest
            .get("created_at")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        if ttl > 0 && created_at > 0.0 && now - created_at > ttl as f64 {
            result.removed += 1;
            result.bytes_removed += artifact.bytes;
            let _ = fs::remove_dir_all(&artifact.dir);
            continue;
        }
        survivors.push(artifact);
    }

    let mut total: u64 = survivors.iter().map(|artifact| artifact.bytes).sum();
    if total > max_bytes {
        survivors.sort_by(|a, b| {
            cache_sort_key(&a.manifest)
                .partial_cmp(&cache_sort_key(&b.manifest))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let protected = protected_dir.map(Path::to_path_buf);
        for artifact in survivors {
            if total <= max_bytes {
                break;
            }
            if protected
                .as_ref()
                .map(|dir| *dir == artifact.dir)
                .unwrap_or(false)
            {
                continue;
            }
            total = total.saturating_sub(artifact.bytes);
            result.removed += 1;
            result.bytes_removed += artifact.bytes;
            let _ = fs::remove_dir_all(&artifact.dir);
        }
    }
    result.bytes = total;
    result
}

fn collect_artifacts(root: &Path) -> Vec<CacheArtifact> {
    let mut manifests = Vec::new();
    collect_manifest_paths(root, &mut manifests);
    let mut artifacts = Vec::new();
    for manifest_path in manifests {
        let Ok(raw) = fs::read_to_string(&manifest_path) else {
            if let Some(parent) = manifest_path.parent() {
                let _ = fs::remove_dir_all(parent);
            }
            continue;
        };
        let Ok(manifest) = serde_json::from_str::<Value>(&raw) else {
            if let Some(parent) = manifest_path.parent() {
                let _ = fs::remove_dir_all(parent);
            }
            continue;
        };
        let Some(filename) = manifest.get("filename").and_then(Value::as_str) else {
            if let Some(parent) = manifest_path.parent() {
                let _ = fs::remove_dir_all(parent);
            }
            continue;
        };
        let Some(dir) = manifest_path.parent().map(Path::to_path_buf) else {
            continue;
        };
        let artifact_path = dir.join(filename);
        let Ok(meta) = fs::metadata(&artifact_path) else {
            let _ = fs::remove_dir_all(&dir);
            continue;
        };
        artifacts.push(CacheArtifact {
            dir,
            manifest,
            bytes: meta.len(),
        });
    }
    artifacts
}

fn collect_manifest_paths(root: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_manifest_paths(&path, out);
        } else if path.file_name().and_then(|value| value.to_str()) == Some("manifest.json") {
            out.push(path);
        }
    }
}

fn cache_sort_key(manifest: &Value) -> f64 {
    manifest
        .get("last_accessed_at")
        .and_then(Value::as_f64)
        .or_else(|| manifest.get("created_at").and_then(Value::as_f64))
        .unwrap_or(0.0)
}

fn write_json_atomic(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("create cache manifest directory {}: {err}", parent.display()))?;
    }
    let tmp_path = path.with_file_name(format!(
        ".{}.{}.tmp",
        path.file_name().and_then(|value| value.to_str()).unwrap_or("manifest.json"),
        std::process::id()
    ));
    let body = serde_json::to_string_pretty(value)
        .map_err(|err| format!("serialize cache manifest: {err}"))?
        + "\n";
    fs::write(&tmp_path, body)
        .map_err(|err| format!("write cache manifest {}: {err}", tmp_path.display()))?;
    fs::rename(&tmp_path, path)
        .map_err(|err| format!("publish cache manifest {}: {err}", path.display()))
}

fn timestamp_seconds() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs_f64())
        .unwrap_or(0.0)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use serde_json::json;

    use super::{finalize_download_cache, DownloadCachePolicy};

    #[test]
    fn writes_manifest_and_prunes_lru_artifacts() {
        let root = test_dir("cache");
        let old_dir = root.join("album/aa/aa/old");
        fs::create_dir_all(&old_dir).unwrap();
        fs::write(old_dir.join("old.zip"), b"old bytes").unwrap();
        fs::write(
            old_dir.join("manifest.json"),
            json!({
                "kind": "album",
                "key": "old",
                "filename": "old.zip",
                "bytes": 9,
                "created_at": 1.0,
                "last_accessed_at": 1.0,
            })
            .to_string(),
        )
        .unwrap();

        let artifact_dir = root.join("album/bb/bb/new");
        fs::create_dir_all(&artifact_dir).unwrap();
        let artifact = artifact_dir.join("new.zip");
        fs::write(&artifact, b"new bytes").unwrap();

        let result = finalize_download_cache(
            &DownloadCachePolicy {
                root: root.display().to_string(),
                kind: "album".to_string(),
                key: "new".to_string(),
                filename: "new.zip".to_string(),
                max_bytes: 10,
                album_ttl_seconds: 3600,
                track_ttl_seconds: 3600,
                metadata: Some(json!({"engine": "crate-media-worker"})),
            },
            &artifact,
            9,
        )
        .unwrap();

        assert!(result.registered);
        assert!(artifact_dir.join("manifest.json").is_file());
        assert!(!old_dir.exists());
        assert_eq!(result.pruned.removed, 1);
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
}
