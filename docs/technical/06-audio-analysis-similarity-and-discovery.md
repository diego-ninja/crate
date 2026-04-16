# Audio Analysis, Similarity, and Discovery Intelligence

## Why this subsystem matters

Crate's discovery features are not only metadata-driven. They also depend on audio-derived signals and similarity vectors.

This layer powers:

- smart radio
- smooth transition logic
- playlist intelligence
- quality and analysis views
- mood/energy exploration

## Audio analysis pipeline

The main analysis entrypoint is [app/crate/audio_analysis.py](/Users/diego/Code/Ninja/musicdock/app/crate/audio_analysis.py).

Crate uses a layered strategy:

1. signal analysis via Rust and/or Python backends
2. PANNs classification for higher-level semantic attributes
3. heuristics and normalization for missing or derived fields

## Backend detection strategy

Crate prefers:

- Essentia when available
- librosa as a fallback

This choice is made dynamically at runtime.

Implications:

- production can benefit from better native DSP throughput
- development and ARM environments can still work with librosa
- analysis code must be tolerant of partial capabilities

## Rust-assisted analysis

The analysis entrypoints first try the Rust CLI through `crate-cli`.

Benefits:

- faster signal-level extraction
- shared native implementation for some metrics
- less Python overhead for common cases

If Rust returns only partial metrics, Python supplements the missing advanced fields instead of recomputing everything unnecessarily.

## Metrics produced

Typical analysis output includes:

- BPM
- key and scale
- energy
- loudness
- dynamic range
- spectral complexity
- danceability
- valence
- acousticness
- instrumentalness
- mood descriptors

These values are persisted on tracks and aggregated up into other surfaces.

## PANNs integration

Crate supports PANNs CNN14 for AudioSet-style label inference.

The code:

- lazily checks availability
- rewires label metadata from local model assets
- loads the model only when needed
- uses grouped weighted label families to derive product-oriented traits

This is important because Crate does not expose raw AudioSet classes directly as the final product language. It translates them into more useful listening concepts.

## Bliss and similarity

Similarity logic lives in [app/crate/bliss.py](/Users/diego/Code/Ninja/musicdock/app/crate/bliss.py).

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

- [Enrichment, Acquisition, and External Integrations](/Users/diego/Code/Ninja/musicdock/docs/technical/05-enrichment-acquisition-and-integrations.md)
- [Frontend Architecture: Admin and Listen](/Users/diego/Code/Ninja/musicdock/docs/technical/08-frontends-admin-and-listen.md)
- [Playback, Realtime, Visualizer, and Subsonic](/Users/diego/Code/Ninja/musicdock/docs/technical/09-playback-realtime-and-subsonic.md)
