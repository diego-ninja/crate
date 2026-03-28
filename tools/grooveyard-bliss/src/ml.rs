//! PANNs CNN14 inference via ONNX Runtime.
//!
//! Loads `panns_cnn14.onnx` and runs AudioSet 527-class tagging on raw waveforms.
//! Maps class probabilities to high-level features (mood, danceability, etc.)
//! using the same weighted label groups as the Python `audio_analysis.py`.

use ort::{session::Session, value::Value};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

/// Sample rate expected by CNN14.
pub const PANNS_SAMPLE_RATE: u32 = 32000;
/// Default analysis duration in seconds.
pub const PANNS_DURATION: usize = 30;

// ── AudioSet label-to-index mapping (527 classes) ──────────────────
// Built from class_labels_indices.csv. We only need the subset referenced
// by _LABEL_GROUPS. Indices are hardcoded to avoid shipping the CSV.
// Source: https://github.com/audioset/ontology

fn audioset_label_index() -> HashMap<&'static str, usize> {
    // Extracted from class_labels_indices.csv — only the labels we use.
    let pairs: &[(&str, usize)] = &[
        ("Heavy metal", 367),
        ("Punk rock", 365),
        ("Rock music", 354),
        ("Drum kit", 417),
        ("Electric guitar", 397),
        ("Drum", 416),
        ("Rock and roll", 356),
        ("Psychedelic rock", 358),
        ("Ambient music", 382),
        ("Classical music", 383),
        ("Silence", 95),
        ("Dance music", 369),
        ("Electronic dance music", 372),
        ("Techno", 370),
        ("House music", 371),
        ("Disco", 375),
        ("Drum and bass", 373),
        ("Funk", 377),
        ("Reggae", 380),
        ("Soul music", 378),
        ("Hip hop music", 368),
        ("Electronica", 374),
        ("Screaming", 55),
        ("Growling", 75),
        ("Acoustic guitar", 396),
        ("Piano", 406),
        ("Violin, fiddle", 408),
        ("Blues", 379),
        ("Electronic music", 381),
        ("Synthesizer", 403),
        ("Drum machine", 419),
        ("Singing", 47),
        ("Male singing", 50),
        ("Female singing", 49),
        ("Rapping", 51),
        ("Choir", 53),
        ("Speech", 0),
        ("Happy music", 388),
        ("Sad music", 390),
        ("Tender music", 392),
        ("Exciting music", 389),
        ("Angry music", 391),
        ("Scary music", 393),
        ("Lullaby", 385),
        ("Cacophony", 99),
    ];
    pairs.iter().copied().collect()
}

// ── Label groups (mirrors Python _LABEL_GROUPS) ───────────────────

struct LabelGroup {
    labels: &'static [(&'static str, f32)],
}

static ENERGY_HIGH: LabelGroup = LabelGroup {
    labels: &[
        ("Heavy metal", 1.5), ("Punk rock", 1.2), ("Rock music", 0.8),
        ("Exciting music", 1.0), ("Angry music", 1.2), ("Drum kit", 0.6),
        ("Electric guitar", 0.5), ("Scary music", 0.4), ("Drum", 0.4),
        ("Rock and roll", 0.4), ("Psychedelic rock", 0.3),
    ],
};

static ENERGY_LOW: LabelGroup = LabelGroup {
    labels: &[
        ("Ambient music", 1.5), ("Classical music", 0.8), ("Lullaby", 1.2),
        ("Tender music", 1.0), ("Silence", 2.0),
    ],
};

static DANCE: LabelGroup = LabelGroup {
    labels: &[
        ("Dance music", 1.5), ("Electronic dance music", 1.2), ("Techno", 1.0),
        ("House music", 1.0), ("Disco", 1.2), ("Drum and bass", 0.8),
        ("Funk", 0.8), ("Reggae", 0.6), ("Soul music", 0.5),
        ("Hip hop music", 0.6), ("Electronica", 0.5),
    ],
};

static AGGRESSIVE: LabelGroup = LabelGroup {
    labels: &[
        ("Heavy metal", 2.0), ("Punk rock", 1.2), ("Angry music", 2.0),
        ("Screaming", 1.5), ("Growling", 1.5), ("Scary music", 0.8),
        ("Drum kit", 0.5), ("Drum", 0.3), ("Cacophony", 1.0),
        ("Rock music", 0.4), ("Exciting music", 0.3),
    ],
};

static HAPPY: LabelGroup = LabelGroup {
    labels: &[
        ("Happy music", 2.0), ("Exciting music", 0.5),
        ("Disco", 0.3), ("Funk", 0.3),
    ],
};

static SAD: LabelGroup = LabelGroup {
    labels: &[
        ("Sad music", 2.0), ("Tender music", 0.5), ("Lullaby", 0.3),
    ],
};

static ACOUSTIC_INST: LabelGroup = LabelGroup {
    labels: &[
        ("Acoustic guitar", 1.2), ("Piano", 1.0), ("Violin, fiddle", 0.8),
        ("Classical music", 0.5), ("Blues", 0.3),
    ],
};

static ELECTRONIC_INST: LabelGroup = LabelGroup {
    labels: &[
        ("Electronic music", 1.2), ("Synthesizer", 1.0), ("Drum machine", 0.8),
        ("Techno", 0.6), ("Electronica", 0.5), ("Electronic dance music", 0.4),
    ],
};

static VOCAL: LabelGroup = LabelGroup {
    labels: &[
        ("Singing", 1.0), ("Male singing", 0.5), ("Female singing", 0.5),
        ("Rapping", 0.8), ("Choir", 0.6), ("Speech", 0.3),
    ],
};

static DARK: LabelGroup = LabelGroup {
    labels: &[
        ("Scary music", 1.5), ("Sad music", 0.8), ("Angry music", 0.8),
        ("Heavy metal", 0.8), ("Cacophony", 0.5),
    ],
};

fn weighted_sum(probs: &[f32], group: &LabelGroup, lb_to_ix: &HashMap<&str, usize>) -> f32 {
    let mut total = 0.0f32;
    for &(label, weight) in group.labels {
        if let Some(&idx) = lb_to_ix.get(label) {
            if idx < probs.len() {
                total += probs[idx] * weight;
            }
        }
    }
    total
}

// ── Public types ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct MlFeatures {
    pub mood: HashMap<String, f32>,
    pub danceability: f32,
    pub valence: f32,
    pub acousticness: f32,
    pub instrumentalness: f32,
}

/// Holds the ONNX session for PANNs CNN14 inference.
pub struct PannsModel {
    session: Session,
    lb_to_ix: HashMap<&'static str, usize>,
}

impl PannsModel {
    /// Load the ONNX model from disk.
    pub fn load(model_path: &Path) -> Result<Self, String> {
        let session = Session::builder()
            .map_err(|e| format!("ort session builder: {e}"))?
            .with_intra_threads(4)
            .map_err(|e| format!("ort threads: {e}"))?
            .commit_from_file(model_path)
            .map_err(|e| format!("ort load model: {e}"))?;
        Ok(Self {
            session,
            lb_to_ix: audioset_label_index(),
        })
    }

    /// Run inference on a raw waveform (mono, 32kHz).
    /// Returns 527-class probability vector.
    fn predict_raw(&self, waveform: &[f32]) -> Result<Vec<f32>, String> {
        let n = waveform.len();
        let input = Value::from_array(([1usize, n], waveform.to_vec()))
            .map_err(|e| format!("ort input: {e}"))?;

        let outputs = self.session.run(ort::inputs![input].map_err(|e| format!("ort inputs: {e}"))?)
            .map_err(|e| format!("ort run: {e}"))?;

        let output = outputs
            .get("clipwise_output")
            .ok_or_else(|| "missing clipwise_output".to_string())?;

        let tensor = output
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("ort extract: {e}"))?;

        Ok(tensor.iter().copied().collect())
    }

    /// Compute high-level ML features from audio + signal analysis context.
    ///
    /// `signal` provides BPM, key/scale, energy, and RMS from the signal analysis
    /// pass so the hybrid formulas can blend PANNs predictions with signal features.
    pub fn compute_features(
        &self,
        waveform_32k: &[f32],
        signal: &SignalContext,
    ) -> Result<MlFeatures, String> {
        let probs = self.predict_raw(waveform_32k)?;
        Ok(self.apply_hybrid(&probs, signal))
    }

    /// Port of Python `_apply_hybrid_from_probs` — blends PANNs class probs
    /// with signal-level features to produce final values.
    fn apply_hybrid(&self, probs: &[f32], ctx: &SignalContext) -> MlFeatures {
        let ws = |group: &LabelGroup| weighted_sum(probs, group, &self.lb_to_ix);

        let tempo_val = ctx.bpm.unwrap_or(120.0);
        let tempo_norm = (tempo_val / 200.0).min(1.0);
        let is_minor = ctx.scale.as_deref() == Some("minor");
        let mode_weight = if ctx.scale.as_deref() == Some("major") { 0.65 } else { 0.2 };

        let energy_signal = ctx.energy.unwrap_or(0.5);

        // Danceability signal: Python uses Essentia Danceability() / 2.0.
        // In Rust we don't have that algorithm, so use a tempo-based proxy.
        let dance_signal = {
            let tempo_score = 1.0 - ((tempo_val - 120.0).abs() / 80.0).min(1.0).max(0.0);
            (tempo_score * 0.6 + energy_signal * 0.4).clamp(0.0, 1.0)
        };

        // Energy: PANNs genre ratio + signal blend
        let e_high = ws(&ENERGY_HIGH);
        let e_low = ws(&ENERGY_LOW);
        let energy_panns = e_high / (e_high + e_low + 0.1);
        let energy_final = (energy_panns * 0.5 + energy_signal * 0.5).clamp(0.0, 1.0);

        // Danceability: PANNs + signal rhythm
        let dance_panns = ws(&DANCE) / 1.2;
        let danceability = (dance_panns * 0.4 + dance_signal * 0.6).clamp(0.0, 1.0);

        // Valence: key/tempo heuristic + PANNs modifier
        let valence_signal = mode_weight * 0.5 + tempo_norm * 0.25 + (1.0 - energy_signal) * 0.25;
        let happy_s = ws(&HAPPY);
        let sad_s = ws(&SAD);
        let valence_panns = if (happy_s + sad_s) > 0.01 {
            happy_s / (happy_s + sad_s + 0.05)
        } else {
            0.5
        };
        let valence = (valence_signal * 0.6 + valence_panns * 0.4).clamp(0.0, 1.0);

        // Acousticness: PANNs acoustic vs electronic
        let ac_s = ws(&ACOUSTIC_INST);
        let el_s = ws(&ELECTRONIC_INST);
        let acousticness = (ac_s / (ac_s + el_s + 0.1)).clamp(0.0, 1.0);

        // Instrumentalness: PANNs vocal detection
        // Python blends with MFCC analysis; in Rust we use PANNs-only for now.
        let vocal_s = ws(&VOCAL);
        let instrumentalness = (1.0 - vocal_s / 0.8).clamp(0.0, 1.0);

        // Mood
        let minor_w: f32 = if is_minor { 0.7 } else { 0.2 };
        let mut mood = HashMap::new();
        mood.insert("aggressive".into(), round3((ws(&AGGRESSIVE) / 0.8).min(1.0)));
        mood.insert("dark".into(), round3((ws(&DARK) / 0.5).min(1.0)));
        mood.insert("happy".into(), round3(
            (valence * 0.5 + tempo_norm * 0.25 + (1.0 - energy_final) * 0.25).clamp(0.0, 1.0)
        ));
        mood.insert("sad".into(), round3(
            ((1.0 - valence) * 0.4 + (1.0 - energy_final) * 0.3 + minor_w * 0.3).clamp(0.0, 1.0)
        ));
        mood.insert("relaxed".into(), round3(
            ((1.0 - energy_final) * 0.4 + acousticness * 0.3 + (1.0 - tempo_norm) * 0.3).clamp(0.0, 1.0)
        ));
        mood.insert("party".into(), round3(
            (danceability * 0.35 + tempo_norm * 0.25 + energy_final * 0.2 + valence * 0.2).clamp(0.0, 1.0)
        ));
        mood.insert("electronic".into(), round3((el_s / 0.8).min(1.0)));
        mood.insert("acoustic".into(), round3((ac_s / 0.8).min(1.0)));

        MlFeatures {
            mood,
            danceability: round3(danceability),
            valence: round3(valence),
            acousticness: round3(acousticness),
            instrumentalness: round3(instrumentalness),
        }
    }
}

/// Signal-level context passed from the main analysis to the ML feature mapper.
pub struct SignalContext {
    pub bpm: Option<f32>,
    pub scale: Option<String>,
    pub energy: Option<f32>,
}

/// Resample audio from `orig_sr` to `target_sr` using linear interpolation.
/// Truncates to `max_duration_sec` before resampling.
pub fn resample_linear(
    samples: &[f32],
    orig_sr: u32,
    target_sr: u32,
    max_duration_sec: usize,
) -> Vec<f32> {
    let max_samples = orig_sr as usize * max_duration_sec;
    let src = if samples.len() > max_samples {
        &samples[..max_samples]
    } else {
        samples
    };

    if orig_sr == target_sr {
        return src.to_vec();
    }

    let ratio = target_sr as f64 / orig_sr as f64;
    let target_len = (src.len() as f64 * ratio) as usize;
    let mut out = Vec::with_capacity(target_len);

    for i in 0..target_len {
        let src_pos = i as f64 / ratio;
        let idx = src_pos as usize;
        let frac = (src_pos - idx as f64) as f32;
        if idx + 1 < src.len() {
            out.push(src[idx] * (1.0 - frac) + src[idx + 1] * frac);
        } else if idx < src.len() {
            out.push(src[idx]);
        }
    }
    out
}

fn round3(v: f32) -> f32 {
    (v * 1000.0).round() / 1000.0
}
