use std::env;
use std::fs;
use std::io::{self, Read};
use std::process;

use crate_media_worker::http;
use crate_media_worker::package::{
    build_album_package, build_track_artifact, PackageJob, TrackArtifactJob,
};

fn main() {
    if let Err(err) = run() {
        eprintln!("crate-media-worker: {err}");
        process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("package-album") => {
            let job_path =
                arg_value(&args, "--job").ok_or("package-album requires --job <path|->")?;
            let job = read_job(job_path)?;
            let result = build_album_package(job);
            println!("{}", serde_json::to_string_pretty(&result)?);
            if result.ok {
                Ok(())
            } else {
                Err("package-album failed".into())
            }
        }
        Some("package-track") => {
            let job_path =
                arg_value(&args, "--job").ok_or("package-track requires --job <path|->")?;
            let job = read_track_job(job_path)?;
            let result = build_track_artifact(job);
            println!("{}", serde_json::to_string_pretty(&result)?);
            if result.ok {
                Ok(())
            } else {
                Err("package-track failed".into())
            }
        }
        Some("serve") | None => {
            let addr = arg_value(&args, "--addr")
                .or_else(|| env::var("CRATE_MEDIA_WORKER_ADDR").ok())
                .unwrap_or_else(|| "0.0.0.0:8687".to_string());
            http::serve(&addr)?;
            Ok(())
        }
        Some("-h") | Some("--help") | Some("help") => {
            print_help();
            Ok(())
        }
        Some(command) => Err(format!("unknown command: {command}").into()),
    }
}

fn arg_value(args: &[String], name: &str) -> Option<String> {
    args.windows(2)
        .find_map(|pair| (pair[0] == name).then(|| pair[1].clone()))
}

fn read_job(path: String) -> Result<PackageJob, Box<dyn std::error::Error>> {
    let body = if path == "-" {
        let mut buffer = String::new();
        io::stdin().read_to_string(&mut buffer)?;
        buffer
    } else {
        fs::read_to_string(path)?
    };
    Ok(serde_json::from_str(&body)?)
}

fn read_track_job(path: String) -> Result<TrackArtifactJob, Box<dyn std::error::Error>> {
    let body = if path == "-" {
        let mut buffer = String::new();
        io::stdin().read_to_string(&mut buffer)?;
        buffer
    } else {
        fs::read_to_string(path)?
    };
    Ok(serde_json::from_str(&body)?)
}

fn print_help() {
    println!(
        "crate-media-worker\n\nCommands:\n  serve [--addr host:port]\n  package-album --job <path|->\n  package-track --job <path|->"
    );
}
