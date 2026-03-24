#!/bin/bash
# Download Essentia TensorFlow models for audio analysis
MODEL_DIR="${1:-/app/models}"
BASE_URL="https://essentia.upf.edu/models"

mkdir -p "$MODEL_DIR"

download() {
    local url="$1"
    local dest="$2"
    if [ ! -f "$dest" ] || [ $(stat -c%s "$dest" 2>/dev/null || echo 0) -lt 1000 ]; then
        echo "Downloading: $(basename $dest)"
        curl -sfL "$url" -o "$dest"
        if [ $? -ne 0 ] || [ $(stat -c%s "$dest" 2>/dev/null || echo 0) -lt 1000 ]; then
            echo "  WARNING: Failed to download $(basename $dest)"
            rm -f "$dest"
        fi
    fi
}

# Discogs-EffNet feature extractor
download "$BASE_URL/feature-extractors/discogs-effnet/discogs-effnet-bs64-1.pb" "$MODEL_DIR/discogs-effnet-bs64-1.pb"
download "$BASE_URL/feature-extractors/discogs-effnet/discogs-effnet-bs64-1.json" "$MODEL_DIR/discogs-effnet-bs64-1.json"

# Classification heads (all use discogs-effnet embeddings)
for model in \
    "classification-heads/danceability/danceability-discogs-effnet-1" \
    "classification-heads/mood_aggressive/mood_aggressive-discogs-effnet-1" \
    "classification-heads/mood_happy/mood_happy-discogs-effnet-1" \
    "classification-heads/mood_sad/mood_sad-discogs-effnet-1" \
    "classification-heads/mood_relaxed/mood_relaxed-discogs-effnet-1" \
    "classification-heads/voice_instrumental/voice_instrumental-discogs-effnet-1" \
    "classification-heads/mood_acoustic/mood_acoustic-discogs-effnet-1" \
    "classification-heads/mood_electronic/mood_electronic-discogs-effnet-1" \
    "classification-heads/mood_party/mood_party-discogs-effnet-1"
do
    name=$(basename "$model")
    download "$BASE_URL/$model.pb" "$MODEL_DIR/$name.pb"
    download "$BASE_URL/$model.json" "$MODEL_DIR/$name.json"
done

echo "Models downloaded to $MODEL_DIR"
ls -la "$MODEL_DIR"
