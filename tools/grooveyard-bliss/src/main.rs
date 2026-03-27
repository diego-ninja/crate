use clap::Parser;
use std::path::PathBuf;

use crate_cli::analyze;
use crate_cli::bliss;
use crate_cli::scan;

#[derive(Parser)]
#[command(name = "crate-cli", about = "Audio analysis and library management CLI for Crate")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(clap::Subcommand)]
enum Command {
    /// Analyze bliss features for similarity
    Bliss {
        #[arg(short, long)]
        file: Option<PathBuf>,
        #[arg(short, long)]
        dir: Option<PathBuf>,
        #[arg(long)]
        similar_to: Option<PathBuf>,
        #[arg(long, default_value = "20")]
        limit: usize,
        #[arg(long, default_value = "flac,mp3,m4a,ogg,opus,wav")]
        extensions: String,
    },
    /// Scan directory for audio files with tags and metadata
    Scan {
        #[arg(short, long)]
        dir: PathBuf,
        #[arg(long, default_value = "flac,mp3,m4a,ogg,opus,wav")]
        extensions: String,
        /// Include content hash for change detection
        #[arg(long)]
        hash: bool,
        /// Check for cover art (file + embedded)
        #[arg(long)]
        covers: bool,
    },
    /// Analyze audio features (BPM, key, loudness, energy)
    Analyze {
        #[arg(short, long)]
        file: Option<PathBuf>,
        #[arg(short, long)]
        dir: Option<PathBuf>,
        #[arg(long, default_value = "flac,mp3,m4a,ogg,opus,wav")]
        extensions: String,
    },
}

fn main() {
    match Cli::parse().command {
        Command::Bliss {
            file,
            dir,
            similar_to,
            limit,
            extensions,
        } => bliss::run_bliss(file, dir, similar_to, limit, extensions),
        Command::Scan {
            dir,
            extensions,
            hash,
            covers,
        } => scan::run_scan(dir, extensions, hash, covers),
        Command::Analyze {
            file,
            dir,
            extensions,
        } => analyze::run_analyze(file, dir, extensions),
    }
}
