use bliss_audio::decoder::Decoder as DecoderTrait;
use bliss_audio::decoder::symphonia::SymphoniaDecoder;
use bliss_audio::Song;
use clap::Parser;
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Parser)]
#[command(name = "grooveyard-bliss", about = "Audio feature extraction for Grooveyard")]
struct Cli {
    /// Analyze a single file
    #[arg(short, long)]
    file: Option<PathBuf>,

    /// Analyze all audio files in a directory (recursive)
    #[arg(short, long)]
    dir: Option<PathBuf>,

    /// Find N most similar tracks to the given file
    #[arg(long)]
    similar_to: Option<PathBuf>,

    /// Number of similar tracks to return
    #[arg(long, default_value = "20")]
    limit: usize,

    /// Audio file extensions to include
    #[arg(long, default_value = "flac,mp3,m4a,ogg,opus,wav")]
    extensions: String,
}

#[derive(Serialize)]
struct TrackResult {
    path: String,
    features: Vec<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Serialize)]
struct SimilarResult {
    source: String,
    similar: Vec<SimilarTrack>,
}

#[derive(Serialize)]
struct SimilarTrack {
    path: String,
    distance: f32,
}

#[derive(Serialize)]
struct BatchResult {
    tracks: Vec<TrackResult>,
    total: usize,
    analyzed: usize,
    failed: usize,
}

fn collect_audio_files(dir: &Path, extensions: &[String]) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                files.extend(collect_audio_files(&path, extensions));
            } else if path.is_file() {
                if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    if extensions.iter().any(|e| e.eq_ignore_ascii_case(ext)) {
                        files.push(path);
                    }
                }
            }
        }
    }
    files.sort();
    files
}

fn analyze_file(path: &Path) -> TrackResult {
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

fn euclidean_distance(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() {
        return f32::MAX;
    }
    a.iter()
        .zip(b.iter())
        .map(|(x, y)| (x - y).powi(2))
        .sum::<f32>()
        .sqrt()
}

fn main() {
    let cli = Cli::parse();
    let extensions: Vec<String> = cli
        .extensions
        .split(',')
        .map(|s| s.trim().to_string())
        .collect();

    // Single file mode
    if let Some(file) = &cli.file {
        let result = analyze_file(file);
        println!("{}", serde_json::to_string(&result).unwrap());
        return;
    }

    // Directory batch mode
    if let Some(dir) = &cli.dir {
        let files = collect_audio_files(dir, &extensions);
        let total = files.len();
        eprintln!("Found {} files, analyzing...", total);

        // Use bliss batch analyze (internally parallelized)
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
        if let Some(source_path) = &cli.similar_to {
            let source_result = results
                .iter()
                .find(|r| Path::new(&r.path) == source_path && r.error.is_none());

            let source_features = if let Some(sr) = source_result {
                sr.features.clone()
            } else {
                // Analyze source separately if not in batch
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

            distances.sort_by(|a, b| a.distance.partial_cmp(&b.distance).unwrap_or(std::cmp::Ordering::Equal));
            distances.truncate(cli.limit);

            let result = SimilarResult {
                source: source_path.to_string_lossy().to_string(),
                similar: distances,
            };
            println!("{}", serde_json::to_string_pretty(&result).unwrap());
            return;
        }

        let batch = BatchResult {
            tracks: results,
            total,
            analyzed,
            failed,
        };
        println!("{}", serde_json::to_string(&batch).unwrap());
        return;
    }

    eprintln!("Usage: grooveyard-bliss --file <path> or --dir <path>");
    std::process::exit(1);
}
