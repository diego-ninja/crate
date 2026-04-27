# Audio Analysis Notes

This is a compact companion to the full technical docs. The detailed runtime
story now spans both the classic library tables and the newer pipeline read
models.

## Current architecture

Crate uses a hybrid analysis stack:

- **Essentia** for signal-processing features such as BPM, key, loudness,
  dynamic range, danceability, and spectral complexity
- **PANNs CNN14** when available for higher-level mood/classification signals
- **Bliss** (`grooveyard-bliss`) for 20-dimensional similarity vectors

## Storage model

The pipeline no longer relies only on columns inside `library_tracks`.

### Operational truth

- `track_processing_state` tracks claimable analysis/bliss work
- `track_analysis_features` stores structured analysis output
- `track_bliss_embeddings` stores vectors plus `pgvector` embeddings
- `track_popularity_features` stores popularity overlays

### Compatibility mirrors

Crate still writes selected results back into `library_tracks` for compatibility
with older queries and surfaces:

- `bpm`
- `audio_key`
- `audio_scale`
- `energy`
- `mood_json`
- `danceability`
- `valence`
- `acousticness`
- `instrumentalness`
- `loudness`
- `dynamic_range`
- `spectral_complexity`
- `bliss_vector`
- legacy `bliss_embedding`

The shadow tables are the preferred source for new runtime code; the legacy
columns exist so older surfaces do not break during the transition.

## Eventing

When pipeline work completes, the system emits semantic domain events:

- `track.analysis.updated`
- `track.bliss.updated`

Those events are consumed by the worker-side projector to warm affected admin
snapshots and ops surfaces.

## Similarity

Bliss vectors are stored in two forms:

- a plain vector/array form for compatibility
- a `pgvector` embedding in `track_bliss_embeddings` for current similarity
  queries and indexing

That makes the analysis pipeline useful both for explainable track metadata and
for fast candidate search.
