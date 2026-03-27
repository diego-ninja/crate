use bliss_audio::decoder::symphonia::SymphoniaDecoder;
use bliss_audio::decoder::Decoder as DecoderTrait;
use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::{collect_audio_files, parse_extensions};

#[derive(Serialize)]
pub struct TrackResult {
    pub path: String,
    pub features: Vec<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct SimilarResult {
    pub source: String,
    pub similar: Vec<SimilarTrack>,
}

#[derive(Serialize)]
pub struct SimilarTrack {
    pub path: String,
    pub distance: f32,
}

#[derive(Serialize)]
pub struct BatchResult {
    pub tracks: Vec<TrackResult>,
    pub total: usize,
    pub analyzed: usize,
    pub failed: usize,
}

pub fn analyze_file(path: &Path) -> TrackResult {
    match SymphoniaDecoder::song_from_path(path) {
        Ok(song) => TrackResult {
            path: path.to_string_lossy().to_string(),
            features: song.analysis.as_vec(),
            error: None,
        },
        Err(e) => TrackResult {
            path: path.to_string_lossy().to_string(),
            features: Vec::new(),
            error: Some(format!("{}", e)),
        },
    }
}

pub fn euclidean_distance(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() {
        return f32::MAX;
    }
    a.iter()
        .zip(b.iter())
        .map(|(x, y)| (x - y).powi(2))
        .sum::<f32>()
        .sqrt()
}

pub fn run_bliss(
    file: Option<PathBuf>,
    dir: Option<PathBuf>,
    similar_to: Option<PathBuf>,
    limit: usize,
    extensions: String,
) {
    let exts = parse_extensions(&extensions);

    // Single file mode
    if let Some(file_path) = &file {
        let result = analyze_file(file_path);
        println!("{}", serde_json::to_string(&result).unwrap_or_default());
        return;
    }

    // Directory batch mode
    if let Some(dir_path) = &dir {
        let files = collect_audio_files(dir_path, &exts);
        let total = files.len();
        eprintln!("Found {} files, analyzing...", total);

        let paths: Vec<&Path> = files.iter().map(|p| p.as_path()).collect();
        let results: Vec<TrackResult> = SymphoniaDecoder::analyze_paths(&paths)
            .enumerate()
            .map(|(i, result)| {
                if i % 50 == 0 {
                    eprintln!("  [{}/{}]", i + 1, total);
                }
                let (path, song_result) = result;
                match song_result {
                    Ok(song) => TrackResult {
                        path: path.to_string_lossy().to_string(),
                        features: song.analysis.as_vec(),
                        error: None,
                    },
                    Err(e) => TrackResult {
                        path: path.to_string_lossy().to_string(),
                        features: Vec::new(),
                        error: Some(format!("{}", e)),
                    },
                }
            })
            .collect();

        let analyzed = results.iter().filter(|r| r.error.is_none()).count();
        let failed = total - analyzed;

        // Similar tracks mode
        if let Some(source_path) = &similar_to {
            let source_result = results
                .iter()
                .find(|r| Path::new(&r.path) == source_path && r.error.is_none());

            let source_features = if let Some(sr) = source_result {
                sr.features.clone()
            } else {
                let sr = analyze_file(source_path);
                if sr.error.is_some() || sr.features.is_empty() {
                    eprintln!("Failed to analyze source: {:?}", sr.error);
                    std::process::exit(1);
                }
                sr.features
            };

            let mut distances: Vec<SimilarTrack> = results
                .iter()
                .filter(|r| {
                    r.error.is_none()
                        && !r.features.is_empty()
                        && r.path != source_path.to_string_lossy().as_ref()
                })
                .map(|r| SimilarTrack {
                    path: r.path.clone(),
                    distance: euclidean_distance(&source_features, &r.features),
                })
                .collect();

            distances.sort_by(|a, b| {
                a.distance
                    .partial_cmp(&b.distance)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            distances.truncate(limit);

            let result = SimilarResult {
                source: source_path.to_string_lossy().to_string(),
                similar: distances,
            };
            println!("{}", serde_json::to_string_pretty(&result).unwrap_or_default());
            return;
        }

        let batch = BatchResult {
            tracks: results,
            total,
            analyzed,
            failed,
        };
        println!("{}", serde_json::to_string(&batch).unwrap_or_default());
        return;
    }

    eprintln!("Usage: crate-cli bliss --file <path> or --dir <path>");
    std::process::exit(1);
}
