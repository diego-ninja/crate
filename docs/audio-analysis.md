# Audio Analysis

Crate uses a three-tier hybrid approach for audio analysis, combining ML classification with signal processing.

## Architecture

```
Track audio file
  |
  +-- Essentia (signal processing, always runs)
  |     +-- BPM (RhythmExtractor2013)
  |     +-- Key + Scale (KeyExtractor)
  |     +-- Loudness (EBU R128, RMS fallback)
  |     +-- Dynamic Range (DynamicComplexity)
  |
  +-- PANNs CNN14 (classification, when available)
  |     +-- 527 AudioSet class probabilities
  |     +-- Weighted label groups --> mood dimensions
  |     +-- Blended with signal features
  |
  +-- Heuristics (fallback, when PANNs unavailable)
        +-- Mood from spectral features + key/tempo
```

## PANNs CNN14

Pre-trained Audio Neural Networks (CNN14) classify audio into 527 AudioSet categories. Crate maps these to musical dimensions using weighted label groups:

| Dimension | AudioSet Labels (weighted) | Scoring |
|-----------|---------------------------|---------|
| **energy** | Heavy metal (1.5), Punk rock (1.2), Rock music (0.8), Exciting music (1.0), Angry music (1.2), Drum kit (0.6) vs Ambient (1.5), Classical (0.8), Silence (2.0) | Ratio: high / (high + low + 0.1) |
| **aggressive** | Heavy metal (2.0), Angry music (2.0), Punk rock (1.2), Screaming (1.5), Cacophony (1.0), Drum kit (0.5) | Scale: sum / 0.8 |
| **dark** | Scary music (1.5), Sad music (0.8), Angry music (0.8), Heavy metal (0.8) | Scale: sum / 0.5 |
| **danceability** | Dance music (1.5), EDM (1.2), Disco (1.2), Techno (1.0), House (1.0), Funk (0.8) | 40% PANNs + 60% Essentia |
| **electronic** | Electronic music (1.2), Synthesizer (1.0), Drum machine (0.8), Techno (0.6) | Scale: sum / 0.8 |
| **acoustic** | Acoustic guitar (1.2), Piano (1.0), Violin (0.8), Classical (0.5) | Ratio vs electronic |

For **happy**, **sad**, **relaxed**, and **valence**, PANNs AudioSet labels are too narrow ("Happy music" doesn't capture all happy music). These use signal heuristics instead: major key = more happy, minor key = more sad, tempo and energy as modifiers.

### Model Files

- `/app/panns_data/Cnn14_mAP=0.431.pth` (~300MB) - CNN14 checkpoint
- `/app/panns_data/class_labels_indices.csv` - AudioSet label mapping

Downloaded at Docker build time via `scripts/download_models.sh`.

### Performance

- Single track: ~54s (with PANNs cold start)
- Batch of 4: ~16s (4s/track) after model is loaded
- Optimizations: 30s audio (not 120s), resample (not reload), frame sampling (1/4)

## Essentia Signal Processing

Always runs, provides the foundation for all tracks:

| Feature | Algorithm | Notes |
|---------|-----------|-------|
| BPM | RhythmExtractor2013 | 44.1kHz, up to 120s |
| Key + Scale | KeyExtractor | Camelot notation |
| Loudness | LoudnessEBUR128 | EBU R128 standard, RMS fallback |
| Dynamic Range | DynamicComplexity | |
| Danceability | Danceability() | Rescaled /2.0 (native returns 0-3+) |
| Energy | RMS in dB | Mapped -30...-6dB to 0...1 |
| Spectral Centroid | SpectralCentroidTime | Log-scale normalization |
| Spectral Complexity | SpectralComplexity | Frame-sampled (1/4 frames) |
| Instrumentalness | MFCC variance | Vocal range coefficients 2-6 |

## Heuristic Fallback

When PANNs is not available (ARM/dev, no torch):

| Mood | Formula |
|------|---------|
| aggressive | energy*0.45 + zcr*0.2 + centroid*0.2 + (1-valence)*0.15 |
| dark | (1-valence)*0.4 + energy*0.2 + minor_scale*0.4 |
| happy | valence*0.5 + tempo*0.25 + (1-energy)*0.25 |
| sad | (1-valence)*0.4 + (1-energy)*0.3 + minor_scale*0.3 |
| relaxed | (1-energy)*0.4 + acoustic*0.3 + (1-tempo)*0.3 |

Key improvements over naive approaches:
- Spectral centroid uses log-scale normalization (`log1p(centroid)/log1p(4000)`)
- Danceability rescaled from Essentia's 0-3+ range to 0-1
- Loudness has RMS fallback if EBU R128 fails

## Bliss Song Similarity

Separate from audio analysis. The `grooveyard-bliss` Rust CLI uses [bliss-rs](https://github.com/Polochon-street/bliss-rs) to compute 20-dimensional feature vectors:

```
[tempo, amplitude_1..5, frequency_1..5, timbre_1..5, chroma_1..5]
```

Stored in `library_tracks.bliss_vector` (PostgreSQL `float8[]`). Distance between tracks is Euclidean distance between vectors.

## Batch Processing

The worker processes tracks in batches of 4 for PANNs efficiency:

1. Load all 4 tracks (Essentia MonoLoader, 44.1kHz)
2. Extract signal features for each (BPM, key, loudness)
3. Resample to 32kHz (linear interpolation, 30s max)
4. Stack into batch tensor, run CNN14 once
5. Apply hybrid classification per track

Chunking: large operations split artists into groups of 10 for parallel processing across 5 worker slots.

## Database Fields

`library_tracks` analysis columns:

| Column | Type | Source |
|--------|------|--------|
| `bpm` | FLOAT | Essentia |
| `audio_key` | TEXT | Essentia |
| `audio_scale` | TEXT | Essentia (major/minor) |
| `energy` | FLOAT | PANNs + Essentia blend |
| `danceability` | FLOAT | PANNs + Essentia blend |
| `valence` | FLOAT | Key/tempo heuristic + PANNs |
| `acousticness` | FLOAT | PANNs ratio |
| `instrumentalness` | FLOAT | PANNs + MFCC blend |
| `loudness` | FLOAT | Essentia EBU R128 |
| `dynamic_range` | FLOAT | Essentia |
| `spectral_complexity` | FLOAT | Essentia |
| `mood_json` | JSONB | 8 dimensions (aggressive, dark, happy, sad, relaxed, party, electronic, acoustic) |
| `bliss_vector` | FLOAT8[] | bliss-rs (20 floats) |
