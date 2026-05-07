# Audio Analysis, Similarity, and Discovery Intelligence

## Why this subsystem matters

Crate's discovery features are not only metadata-driven. They also depend on audio-derived signals and similarity vectors.

This layer powers:

- smart radio
- smooth transition logic
- playlist intelligence
- quality and analysis views
- mood/energy exploration

## Two parallel analysis tracks

Crate actually runs two independent analysis subsystems, each with its own
pipeline, output, and consumer:

1. **Per-track audio features** — BPM, key, loudness, dynamic range,
   spectral complexity, energy, danceability, valence, acousticness,
   instrumentalness, mood descriptors. Produced by
   [app/crate/audio_analysis.py](https://github.com/thecrateapp/crate/blob/main/app/crate/audio_analysis.py).
   Consumed by the UI analytics, radio curation, the adaptive equalizer,
   and anywhere else that needs a single-track signature.
2. **Bliss song-DNA vectors** — a 20-float vector per track used as the
   backbone for nearest-neighbour similarity. Produced by the Rust CLI at
   [tools/crate-cli](https://github.com/thecrateapp/crate/blob/main/tools/crate-cli),
   integrated via
   [app/crate/bliss.py](https://github.com/thecrateapp/crate/blob/main/app/crate/bliss.py).
   Consumed by radio continuation, transition scoring, and smart playlists.

Both run from the worker's dedicated daemons so the main task queue never
gets blocked on long DSP work.

## Feature analysis backends

`audio_analysis.py` selects a backend at import time:

- **Essentia** when the native bindings are available (x86_64 production
  containers). Uses C++ DSP for loudness (EBU R128), dynamic complexity,
  spectral features, and the PANNs classifier for semantic labels.
- **librosa** as a Python fallback for environments where Essentia cannot
  load (ARM dev laptops). Slower, missing PANNs, but functionally complete
  for the core metrics.

The choice is transparent to callers; the output schema is the same.

## PANNs integration

Crate supports PANNs CNN14 for AudioSet-style label inference.

The code:

- lazily checks availability
- rewires label metadata from local model assets
- loads the model only when needed
- uses grouped weighted label families to derive product-oriented traits

Crate does not expose raw AudioSet classes directly as the final product
language. It translates them into more useful listening concepts
(danceability, valence, acousticness, instrumentalness).

## Metric semantics worth knowing

A few of the persisted columns have non-obvious meanings:

- `spectral_complexity` is normalised into `[0, 1]` and doubles as a
  **brightness** indicator — the value the adaptive equalizer reads to
  decide whether to tame or lift the upper shelf.
- `loudness` is in LUFS (EBU R128 when Essentia is available), roughly
  `-30..-6`. Streaming targets sit around `-14`; modern loud masters reach
  `-8`.
- `dynamic_range` is a crest-style measure in dB, computed as the ratio of
  the 95th to the 10th percentile of frame-level RMS. Typical music sits
  in `4..20 dB`. An earlier version used `max/min` and exploded to `100+`
  on tracks with silent intros; the percentile version is robust.
- `danceability`, `valence`, `acousticness`, `instrumentalness` live in
  `[0, 1]` and follow the Spotify-style semantics.

These are exposed to the Listen frontend through
`/api/tracks/{id}/eq-features` so the adaptive equalizer can shape gains
per track.

## Bliss and similarity

Similarity logic lives in [app/crate/bliss.py](https://github.com/thecrateapp/crate/blob/main/app/crate/bliss.py).

This subsystem combines:

- `bliss-rs` vectors
- BPM proximity
- Camelot-style key compatibility
- energy proximity
- year proximity
- genre overlap
- artist similarity bonuses
- curation penalties for low-signal or alternate-version tracks

So "similarity" in Crate is not one number from one model. It is a composite ranking strategy.

## Why bliss is important

`bliss-rs` provides a compact song-DNA vector that is especially useful for:

- nearest-neighbor style lookup
- smooth-sequence generation
- radio continuation

Crate then wraps that with additional musical and editorial heuristics to make results more product-appropriate.

## Discovery surfaces fed by this subsystem

### Radio

Radio uses seed-aware similarity plus curation logic to avoid bad transitions and poor candidates.

### Home intelligence

Discovery sections in the Listen home surface use listening history, library signals, and recommendation heuristics assembled in backend DB helpers such as `db/home.py`.

### Analytics and insights

The admin app exposes derived insights based on:

- formats
- decades
- key distribution
- BPM
- mood and valence
- loudness
- danceability
- energy

### Similar artists and related discovery

Crate also combines:

- source-provided similar artists
- internal similarity tables
- listening/user behavior

to improve discovery and affinity features.

## Background execution

Analysis work is intentionally split across several execution patterns:

- normal tasks can request analysis-related work
- dedicated analysis daemons drain pending analysis needs
- bliss computation can be scheduled or reset independently

This keeps acquisition and sync responsive while still allowing the library to converge toward a fully analyzed state.

## Quality trade-offs

Crate prefers robustness over theoretical purity:

- partial analysis is acceptable and later can be supplemented
- missing models do not collapse the whole app
- heuristic scoring is used where "perfect" classification is unavailable

That is a good fit for self-hosted systems, where environments vary a lot.

## Design decisions in this layer

### Why mix multiple scoring dimensions

A single similarity model is rarely enough for satisfying playback transitions. Crate deliberately mixes:

- signal similarity
- music theory compatibility
- metadata context
- curation heuristics

This makes the output more editorial and less mechanically "nearest vector".

### Why keep analytics and radio close to the library

Crate does not depend on a remote recommendation service. It builds intelligence locally from:

- your own files
- your own play behavior
- your own enrichment graph

That local-first posture is one of the project's core product ideas.

## Related documents

- [Enrichment, Acquisition, and External Integrations](/technical/enrichment-acquisition-and-integrations)
- [Frontend Architecture: Admin and Listen](/technical/frontends-admin-and-listen)
- [Playback, Realtime, Visualizer, and Subsonic](/technical/playback-realtime-and-subsonic)
