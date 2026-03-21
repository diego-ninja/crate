use bliss_audio::Song;
use clap::Parser;
use rayon::prelude::*;
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

    /// Output distance matrix between all analyzed tracks
    #[arg(long)]
    distances: bool,

    /// Find N most similar tracks to the given file
    #[arg(long)]
    similar_to: Option<PathBuf>,

    /// Number of similar tracks to return
    #[arg(long, default_value = "10")]
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
    match Song::from_path(path) {
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

fn main() {
    let cli = Cli::parse();
    let extensions: Vec<String> = cli.extensions.split(',').map(|s| s.trim().to_string()).collect();

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

        eprintln!("Analyzing {} files...", total);

        let results: Vec<TrackResult> = files
            .par_iter()
            .enumerate()
            .map(|(i, path)| {
                if i % 10 == 0 {
                    eprintln!("  [{}/{}] {}", i + 1, total, path.display());
                }
                analyze_file(path)
            })
            .collect();

        let analyzed = results.iter().filter(|r| r.error.is_none()).count();
        let failed = results.iter().filter(|r| r.error.is_some()).count();

        // Find similar tracks mode
        if let Some(source_path) = &cli.similar_to {
            let source = match results.iter().find(|r| Path::new(&r.path) == source_path) {
                Some(r) if r.error.is_none() => r,
                _ => {
                    // Analyze the source file if not in batch
                    let r = analyze_file(source_path);
                    if r.error.is_some() {
                        eprintln!("Failed to analyze source: {:?}", r.error);
                        std::process::exit(1);
                    }
                    // Can't borrow, just re-analyze
                    let source_song = Song::from_path(source_path).unwrap();
                    let source_features = source_song.analysis.as_vec();

                    let mut distances: Vec<SimilarTrack> = results
                        .iter()
                        .filter(|r| r.error.is_none() && r.path != source_path.to_string_lossy().as_ref())
                        .map(|r| {
                            let dist = euclidean_distance(&source_features, &r.features);
                            SimilarTrack {
                                path: r.path.clone(),
                                distance: dist,
                            }
                        })
                        .collect();

                    distances.sort_by(|a, b| a.distance.partial_cmp(&b.distance).unwrap());
                    distances.truncate(cli.limit);

                    let result = SimilarResult {
                        source: source_path.to_string_lossy().to_string(),
                        similar: distances,
                    };
                    println!("{}", serde_json::to_string_pretty(&result).unwrap());
                    return;
                }
            };

            let source_features = &source.features;
            let mut distances: Vec<SimilarTrack> = results
                .iter()
                .filter(|r| r.error.is_none() && r.path != source.path)
                .map(|r| {
                    let dist = euclidean_distance(source_features, &r.features);
                    SimilarTrack {
                        path: r.path.clone(),
                        distance: dist,
                    }
                })
                .collect();

            distances.sort_by(|a, b| a.distance.partial_cmp(&b.distance).unwrap());
            distances.truncate(cli.limit);

            let result = SimilarResult {
                source: source.path.clone(),
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
    eprintln!("  --similar-to <path> --dir <path>  Find similar tracks");
    std::process::exit(1);
}

fn euclidean_distance(a: &[f32], b: &[f32]) -> f32 {
    a.iter()
        .zip(b.iter())
        .map(|(x, y)| (x - y).powi(2))
        .sum::<f32>()
        .sqrt()
}
