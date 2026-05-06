use clap::Parser;
use std::path::PathBuf;

#[cfg(feature = "analysis")]
use crate_cli::analyze;
#[cfg(feature = "bliss")]
use crate_cli::bliss;
use crate_cli::diff;
use crate_cli::fingerprint;
use crate_cli::quality;
use crate_cli::scan;
use crate_cli::tags;

#[derive(Parser)]
#[command(
    name = "crate-cli",
    about = "Audio analysis and library management CLI for Crate"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(clap::Subcommand)]
enum Command {
    /// Analyze bliss features for similarity
    #[cfg(feature = "bliss")]
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
    /// Probe audio technical metadata without running full analysis
    Quality {
        #[arg(short, long)]
        file: Option<PathBuf>,
        #[arg(short, long)]
        dir: Option<PathBuf>,
        #[arg(long, default_value = "flac,mp3,m4a,ogg,opus,wav")]
        extensions: String,
    },
    /// Diff two scan JSON snapshots and emit filesystem change facts
    Diff {
        #[arg(long)]
        before: PathBuf,
        #[arg(long)]
        after: PathBuf,
    },
    /// Inspect normalized audio tags and Crate identity metadata
    Tags {
        #[command(subcommand)]
        command: TagsCommand,
    },
    /// Compute compact file fingerprints for identity/rebuild helpers
    Fingerprint {
        #[arg(short, long)]
        file: Option<PathBuf>,
        #[arg(short, long)]
        dir: Option<PathBuf>,
        #[arg(long, default_value = "flac,mp3,m4a,ogg,opus,wav")]
        extensions: String,
        #[arg(long, default_value = "quick")]
        mode: String,
    },
    /// Analyze audio features (BPM, key, loudness, energy, mood, danceability)
    #[cfg(feature = "analysis")]
    Analyze {
        #[arg(short, long)]
        file: Option<PathBuf>,
        #[arg(short, long)]
        dir: Option<PathBuf>,
        #[arg(long, default_value = "flac,mp3,m4a,ogg,opus,wav")]
        extensions: String,
        /// Path to PANNs CNN14 ONNX model for ML features (mood, danceability, etc.)
        #[arg(long)]
        model_path: Option<PathBuf>,
    },
}

#[derive(clap::Subcommand)]
enum TagsCommand {
    /// Inspect tags from a file or directory
    Inspect {
        #[arg(short, long)]
        file: Option<PathBuf>,
        #[arg(short, long)]
        dir: Option<PathBuf>,
        #[arg(long, default_value = "flac,mp3,m4a,ogg,opus,wav")]
        extensions: String,
    },
    /// Write Crate identity tags to one audio file
    WriteIdentity {
        #[arg(short, long)]
        file: PathBuf,
        #[arg(long, default_value = "1")]
        schema_version: String,
        #[arg(long)]
        artist_uid: String,
        #[arg(long)]
        album_uid: String,
        #[arg(long)]
        track_uid: String,
        #[arg(long)]
        audio_fingerprint: Option<String>,
        #[arg(long)]
        audio_fingerprint_source: Option<String>,
        #[arg(long)]
        dry_run: bool,
    },
}

fn main() {
    match Cli::parse().command {
        #[cfg(feature = "bliss")]
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
        Command::Quality {
            file,
            dir,
            extensions,
        } => quality::run_quality(file, dir, extensions),
        Command::Diff { before, after } => diff::run_diff(before, after),
        Command::Tags { command } => match command {
            TagsCommand::Inspect {
                file,
                dir,
                extensions,
            } => tags::run_tags_inspect(file, dir, extensions),
            TagsCommand::WriteIdentity {
                file,
                schema_version,
                artist_uid,
                album_uid,
                track_uid,
                audio_fingerprint,
                audio_fingerprint_source,
                dry_run,
            } => tags::run_tags_write_identity(
                file,
                tags::IdentityTagInput {
                    schema_version,
                    artist_uid,
                    album_uid,
                    track_uid,
                    audio_fingerprint,
                    audio_fingerprint_source,
                    dry_run,
                },
            ),
        },
        Command::Fingerprint {
            file,
            dir,
            extensions,
            mode,
        } => fingerprint::run_fingerprint(file, dir, extensions, mode),
        #[cfg(feature = "analysis")]
        Command::Analyze {
            file,
            dir,
            extensions,
            model_path,
        } => analyze::run_analyze(file, dir, extensions, model_path),
    }
}
