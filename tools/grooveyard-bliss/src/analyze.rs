use rayon::prelude::*;
use realfft::RealFftPlanner;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use crate::{collect_audio_files, parse_extensions};

const TARGET_SAMPLE_RATE: u32 = 22050;
const FFT_SIZE: usize = 2048;
const HOP_SIZE: usize = 512;

#[derive(Serialize)]
pub struct AnalysisResult {
    pub path: String,
    pub bpm: Option<f32>,
    pub key: Option<String>,
    pub scale: Option<String>,
    pub loudness: Option<f32>,
    pub energy: Option<f32>,
    pub dynamic_range: Option<f32>,
    pub spectral_centroid: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mood: Option<HashMap<String, f32>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub danceability: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub valence: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acousticness: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instrumentalness: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct BatchAnalysisResult {
    pub tracks: Vec<AnalysisResult>,
    pub total: usize,
    pub analyzed: usize,
    pub failed: usize,
}

fn decode_audio(path: &Path) -> Result<(Vec<f32>, u32), String> {
    let file = std::fs::File::open(path).map_err(|e| format!("open: {}", e))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("probe: {}", e))?;

    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| "no default track".to_string())?;
    let track_id = track.id;
    let sample_rate = track
        .codec_params
        .sample_rate
        .ok_or_else(|| "no sample rate".to_string())?;
    let channels = track
        .codec_params
        .channels
        .map(|c| c.count())
        .unwrap_or(1);

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("decoder: {}", e))?;

    let mut all_samples: Vec<f32> = Vec::new();

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(symphonia::core::errors::Error::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(_) => break,
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(_) => continue,
        };

        let spec = *decoded.spec();
        let num_frames = decoded.frames();
        let mut sample_buf = SampleBuffer::<f32>::new(num_frames as u64, spec);
        sample_buf.copy_interleaved_ref(decoded);
        let samples = sample_buf.samples();

        // Mix to mono
        if channels > 1 {
            for frame in 0..num_frames {
                let mut sum = 0.0f32;
                for ch in 0..channels {
                    sum += samples[frame * channels + ch];
                }
                all_samples.push(sum / channels as f32);
            }
        } else {
            all_samples.extend_from_slice(samples);
        }
    }

    // Resample to target rate if needed (simple linear interpolation)
    if sample_rate != TARGET_SAMPLE_RATE && !all_samples.is_empty() {
        let ratio = TARGET_SAMPLE_RATE as f64 / sample_rate as f64;
        let new_len = (all_samples.len() as f64 * ratio) as usize;
        let mut resampled = Vec::with_capacity(new_len);
        for i in 0..new_len {
            let src_pos = i as f64 / ratio;
            let idx = src_pos as usize;
            let frac = (src_pos - idx as f64) as f32;
            if idx + 1 < all_samples.len() {
                resampled.push(all_samples[idx] * (1.0 - frac) + all_samples[idx + 1] * frac);
            } else if idx < all_samples.len() {
                resampled.push(all_samples[idx]);
            }
        }
        return Ok((resampled, TARGET_SAMPLE_RATE));
    }

    Ok((all_samples, sample_rate))
}

/// Decode audio and return the original (pre-resample) mono samples + original sample rate.
/// Used when we need to resample to 32kHz for PANNs (not 22050).
fn decode_audio_original(path: &Path) -> Result<(Vec<f32>, u32), String> {
    let file = std::fs::File::open(path).map_err(|e| format!("open: {}", e))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("probe: {}", e))?;

    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| "no default track".to_string())?;
    let track_id = track.id;
    let sample_rate = track
        .codec_params
        .sample_rate
        .ok_or_else(|| "no sample rate".to_string())?;
    let channels = track
        .codec_params
        .channels
        .map(|c| c.count())
        .unwrap_or(1);

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("decoder: {}", e))?;

    let mut all_samples: Vec<f32> = Vec::new();

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(symphonia::core::errors::Error::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(_) => break,
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(_) => continue,
        };

        let spec = *decoded.spec();
        let num_frames = decoded.frames();
        let mut sample_buf = SampleBuffer::<f32>::new(num_frames as u64, spec);
        sample_buf.copy_interleaved_ref(decoded);
        let samples = sample_buf.samples();

        if channels > 1 {
            for frame in 0..num_frames {
                let mut sum = 0.0f32;
                for ch in 0..channels {
                    sum += samples[frame * channels + ch];
                }
                all_samples.push(sum / channels as f32);
            }
        } else {
            all_samples.extend_from_slice(samples);
        }
    }

    Ok((all_samples, sample_rate))
}

fn compute_rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f32 = samples.iter().map(|s| s * s).sum();
    (sum / samples.len() as f32).sqrt()
}

fn compute_loudness_db(rms: f32) -> f32 {
    if rms > 0.0 {
        20.0 * rms.log10()
    } else {
        -80.0
    }
}

fn compute_energy(rms: f32) -> f32 {
    let db = compute_loudness_db(rms);
    ((db + 40.0) / 40.0).clamp(0.0, 1.0)
}

fn compute_dynamic_range(samples: &[f32]) -> f32 {
    let frame_size = 2048;
    let hop = 1024;
    let mut frame_rms: Vec<f32> = Vec::new();

    let mut pos = 0;
    while pos + frame_size <= samples.len() {
        let rms = compute_rms(&samples[pos..pos + frame_size]);
        let db = compute_loudness_db(rms);
        frame_rms.push(db);
        pos += hop;
    }

    if frame_rms.len() < 2 {
        return 0.0;
    }

    frame_rms.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let p5_idx = (frame_rms.len() as f32 * 0.05) as usize;
    let p95_idx = (frame_rms.len() as f32 * 0.95) as usize;
    let p95_idx = p95_idx.min(frame_rms.len() - 1);

    frame_rms[p95_idx] - frame_rms[p5_idx]
}

fn compute_magnitude_spectrum(
    samples: &[f32],
    fft_size: usize,
    planner: &mut RealFftPlanner<f32>,
) -> Vec<f32> {
    let fft = planner.plan_fft_forward(fft_size);
    let mut input = vec![0.0f32; fft_size];
    let len = samples.len().min(fft_size);
    input[..len].copy_from_slice(&samples[..len]);

    // Apply Hann window
    for (i, sample) in input.iter_mut().enumerate() {
        let w = 0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / fft_size as f32).cos());
        *sample *= w;
    }

    let mut spectrum = fft.make_output_vec();
    fft.process(&mut input, &mut spectrum).ok();

    spectrum.iter().map(|c| c.norm()).collect()
}

fn compute_spectral_centroid_value(magnitudes: &[f32], sample_rate: f32, fft_size: usize) -> f32 {
    let freq_resolution = sample_rate / fft_size as f32;
    let weighted_sum: f32 = magnitudes
        .iter()
        .enumerate()
        .map(|(i, &m)| i as f32 * freq_resolution * m)
        .sum();
    let total_magnitude: f32 = magnitudes.iter().sum();
    if total_magnitude > 0.0 {
        weighted_sum / total_magnitude
    } else {
        0.0
    }
}

fn estimate_bpm(samples: &[f32], sample_rate: u32) -> Option<f32> {
    if samples.len() < FFT_SIZE * 4 {
        return None;
    }

    let sr = sample_rate as f32;
    let mut planner = RealFftPlanner::<f32>::new();

    // Compute onset strength envelope (spectral flux)
    let mut onsets: Vec<f32> = Vec::new();
    let mut prev_spectrum: Vec<f32> = Vec::new();

    let mut pos = 0;
    while pos + FFT_SIZE <= samples.len() {
        let frame = &samples[pos..pos + FFT_SIZE];
        let spectrum = compute_magnitude_spectrum(frame, FFT_SIZE, &mut planner);

        if !prev_spectrum.is_empty() {
            let flux: f32 = spectrum
                .iter()
                .zip(prev_spectrum.iter())
                .map(|(curr, prev)| (curr - prev).max(0.0))
                .sum();
            onsets.push(flux);
        }

        prev_spectrum = spectrum;
        pos += HOP_SIZE;
    }

    if onsets.len() < 4 {
        return None;
    }

    // Autocorrelation of onset envelope
    let min_lag = (60.0 / 200.0 * sr / HOP_SIZE as f32) as usize; // 200 BPM
    let max_lag = (60.0 / 60.0 * sr / HOP_SIZE as f32) as usize; // 60 BPM
    let max_lag = max_lag.min(onsets.len() / 2);

    if min_lag >= max_lag {
        return None;
    }

    let mut best_lag = min_lag;
    let mut best_corr = 0.0f32;

    for lag in min_lag..max_lag {
        let corr: f32 = onsets
            .iter()
            .zip(onsets[lag..].iter())
            .map(|(a, b)| a * b)
            .sum();
        if corr > best_corr {
            best_corr = corr;
            best_lag = lag;
        }
    }

    if best_corr <= 0.0 {
        return None;
    }

    let bpm = 60.0 * sr / (best_lag as f32 * HOP_SIZE as f32);
    Some((bpm * 10.0).round() / 10.0)
}

const KRUMHANSL_MAJOR: [f32; 12] = [
    6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const KRUMHANSL_MINOR: [f32; 12] = [
    6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];
const NOTE_NAMES: [&str; 12] = [
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

fn compute_chromagram(samples: &[f32], sample_rate: u32) -> [f32; 12] {
    let mut chroma = [0.0f32; 12];
    let sr = sample_rate as f32;
    let mut planner = RealFftPlanner::<f32>::new();

    let mut pos = 0;
    let mut frame_count = 0;

    while pos + FFT_SIZE <= samples.len() {
        let frame = &samples[pos..pos + FFT_SIZE];
        let magnitudes = compute_magnitude_spectrum(frame, FFT_SIZE, &mut planner);

        // Map each frequency bin to a pitch class
        for (bin, &mag) in magnitudes.iter().enumerate() {
            let freq = bin as f32 * sr / FFT_SIZE as f32;
            if freq < 20.0 || freq > 5000.0 {
                continue;
            }
            // Convert frequency to MIDI note, then to pitch class
            let midi = 69.0 + 12.0 * (freq / 440.0).log2();
            let pitch_class = ((midi.round() as i32 % 12) + 12) % 12;
            chroma[pitch_class as usize] += mag * mag; // Energy
        }

        pos += HOP_SIZE;
        frame_count += 1;
    }

    if frame_count > 0 {
        for c in &mut chroma {
            *c /= frame_count as f32;
        }
    }

    chroma
}

fn pearson_correlation(a: &[f32; 12], b: &[f32; 12]) -> f32 {
    let n = 12.0f32;
    let sum_a: f32 = a.iter().sum();
    let sum_b: f32 = b.iter().sum();
    let mean_a = sum_a / n;
    let mean_b = sum_b / n;

    let mut num = 0.0f32;
    let mut den_a = 0.0f32;
    let mut den_b = 0.0f32;

    for i in 0..12 {
        let da = a[i] - mean_a;
        let db = b[i] - mean_b;
        num += da * db;
        den_a += da * da;
        den_b += db * db;
    }

    let den = (den_a * den_b).sqrt();
    if den > 0.0 {
        num / den
    } else {
        0.0
    }
}

fn detect_key(samples: &[f32], sample_rate: u32) -> (String, String) {
    let chroma = compute_chromagram(samples, sample_rate);

    let mut best_key = 0usize;
    let mut best_scale = "major";
    let mut best_corr = f32::MIN;

    for shift in 0..12 {
        let mut rotated = [0.0f32; 12];
        for i in 0..12 {
            rotated[i] = chroma[(i + shift) % 12];
        }

        let major_corr = pearson_correlation(&rotated, &KRUMHANSL_MAJOR);
        let minor_corr = pearson_correlation(&rotated, &KRUMHANSL_MINOR);

        if major_corr > best_corr {
            best_corr = major_corr;
            best_key = shift;
            best_scale = "major";
        }
        if minor_corr > best_corr {
            best_corr = minor_corr;
            best_key = shift;
            best_scale = "minor";
        }
    }

    (NOTE_NAMES[best_key].to_string(), best_scale.to_string())
}

/// Analyze a single track. If `panns` is provided, also compute ML features.
#[cfg(feature = "ml")]
pub fn analyze_track_with_ml(
    path: &Path,
    panns: Option<&crate::ml::PannsModel>,
) -> AnalysisResult {
    let mut result = analyze_track(path);
    if result.error.is_some() {
        return result;
    }

    if let Some(model) = panns {
        match decode_audio_original(path) {
            Ok((orig_samples, orig_sr)) => {
                let waveform_32k = crate::ml::resample_linear(
                    &orig_samples,
                    orig_sr,
                    crate::ml::PANNS_SAMPLE_RATE,
                    crate::ml::PANNS_DURATION,
                );
                let ctx = crate::ml::SignalContext {
                    bpm: result.bpm,
                    scale: result.scale.clone(),
                    energy: result.energy,
                };
                match model.compute_features(&waveform_32k, &ctx) {
                    Ok(features) => {
                        result.mood = Some(features.mood);
                        result.danceability = Some(features.danceability);
                        result.valence = Some(features.valence);
                        result.acousticness = Some(features.acousticness);
                        result.instrumentalness = Some(features.instrumentalness);
                    }
                    Err(e) => {
                        eprintln!("ML inference failed for {}: {}", path.display(), e);
                    }
                }
            }
            Err(e) => {
                eprintln!("Decode for ML failed for {}: {}", path.display(), e);
            }
        }
    }

    result
}

pub fn analyze_track(path: &Path) -> AnalysisResult {
    let (samples, sample_rate) = match decode_audio(path) {
        Ok(r) => r,
        Err(e) => {
            return AnalysisResult {
                path: path.to_string_lossy().to_string(),
                bpm: None,
                key: None,
                scale: None,
                loudness: None,
                energy: None,
                dynamic_range: None,
                spectral_centroid: None,
                mood: None,
                danceability: None,
                valence: None,
                acousticness: None,
                instrumentalness: None,
                error: Some(e),
            }
        }
    };

    if samples.is_empty() {
        return AnalysisResult {
            path: path.to_string_lossy().to_string(),
            bpm: None,
            key: None,
            scale: None,
            loudness: None,
            energy: None,
            dynamic_range: None,
            spectral_centroid: None,
            mood: None,
            danceability: None,
            valence: None,
            acousticness: None,
            instrumentalness: None,
            error: Some("empty audio".to_string()),
        };
    }

    let rms = compute_rms(&samples);
    let loudness = compute_loudness_db(rms);
    let energy = compute_energy(rms);
    let dynamic_range = compute_dynamic_range(&samples);
    let bpm = estimate_bpm(&samples, sample_rate);
    let (key, scale) = detect_key(&samples, sample_rate);

    // Average spectral centroid
    let mut planner = RealFftPlanner::<f32>::new();
    let mut centroid_sum = 0.0f32;
    let mut centroid_count = 0;
    let mut pos = 0;
    while pos + FFT_SIZE <= samples.len() {
        let frame = &samples[pos..pos + FFT_SIZE];
        let magnitudes = compute_magnitude_spectrum(frame, FFT_SIZE, &mut planner);
        centroid_sum +=
            compute_spectral_centroid_value(&magnitudes, sample_rate as f32, FFT_SIZE);
        centroid_count += 1;
        pos += HOP_SIZE;
    }
    let spectral_centroid = if centroid_count > 0 {
        Some((centroid_sum / centroid_count as f32 * 10.0).round() / 10.0)
    } else {
        None
    };

    AnalysisResult {
        path: path.to_string_lossy().to_string(),
        bpm,
        key: Some(key),
        scale: Some(scale),
        loudness: Some((loudness * 10.0).round() / 10.0),
        energy: Some((energy * 1000.0).round() / 1000.0),
        dynamic_range: Some((dynamic_range * 10.0).round() / 10.0),
        spectral_centroid,
        mood: None,
        danceability: None,
        valence: None,
        acousticness: None,
        instrumentalness: None,
        error: None,
    }
}

pub fn run_analyze(
    file: Option<PathBuf>,
    dir: Option<PathBuf>,
    extensions: String,
    model_path: Option<PathBuf>,
) {
    let exts = parse_extensions(&extensions);

    // Load PANNs model if path provided and feature enabled
    #[cfg(feature = "ml")]
    let panns: Option<Arc<crate::ml::PannsModel>> = model_path.as_ref().and_then(|p| {
        if !p.exists() {
            eprintln!("Model file not found: {}", p.display());
            return None;
        }
        match crate::ml::PannsModel::load(p) {
            Ok(m) => {
                eprintln!("PANNs CNN14 model loaded from {}", p.display());
                Some(Arc::new(m))
            }
            Err(e) => {
                eprintln!("Failed to load PANNs model: {}", e);
                None
            }
        }
    });

    #[cfg(not(feature = "ml"))]
    let panns: Option<Arc<()>> = {
        let _ = model_path;
        None
    };

    if let Some(file_path) = file {
        #[cfg(feature = "ml")]
        let result = analyze_track_with_ml(
            &file_path,
            panns.as_ref().map(|m| m.as_ref()),
        );
        #[cfg(not(feature = "ml"))]
        let result = analyze_track(&file_path);

        println!("{}", serde_json::to_string(&result).unwrap_or_default());
        return;
    }

    if let Some(dir_path) = dir {
        let files = collect_audio_files(&dir_path, &exts);
        let total = files.len();
        eprintln!("Found {} files, analyzing...", total);

        #[cfg(feature = "ml")]
        let results: Vec<AnalysisResult> = if let Some(ref model) = panns {
            files
                .par_iter()
                .map(|f| analyze_track_with_ml(f, Some(model.as_ref())))
                .collect()
        } else {
            files.par_iter().map(|f| analyze_track(f)).collect()
        };

        #[cfg(not(feature = "ml"))]
        let results: Vec<AnalysisResult> = files.par_iter().map(|f| analyze_track(f)).collect();

        let analyzed = results.iter().filter(|r| r.error.is_none()).count();
        let batch = BatchAnalysisResult {
            tracks: results,
            total,
            analyzed,
            failed: total - analyzed,
        };
        println!("{}", serde_json::to_string(&batch).unwrap_or_default());
        return;
    }

    eprintln!("Usage: crate-cli analyze --file <path> or --dir <path>");
    std::process::exit(1);
}
