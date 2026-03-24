#!/bin/bash
# Download Essentia TensorFlow models + PANNs CNN14 for audio analysis
MODEL_DIR="${1:-/app/models}"
BASE_URL="https://essentia.upf.edu/models"

mkdir -p "$MODEL_DIR"

download() {
    local url="$1"
    local dest="$2"
    local min_size="${3:-1000}"
    if [ ! -f "$dest" ] || [ $(stat -c%s "$dest" 2>/dev/null || echo 0) -lt "$min_size" ]; then
        echo "Downloading: $(basename $dest)"
        curl -sfL "$url" -o "$dest"
        if [ $? -ne 0 ] || [ $(stat -c%s "$dest" 2>/dev/null || echo 0) -lt "$min_size" ]; then
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

echo "Essentia models downloaded to $MODEL_DIR"

# PANNs CNN14 model (~300MB) + AudioSet labels
PANNS_DIR="/app/panns_data"
mkdir -p "$PANNS_DIR"

download \
    "https://zenodo.org/record/3987831/files/Cnn14_mAP%3D0.431.pth?download=1" \
    "$PANNS_DIR/Cnn14_mAP=0.431.pth" \
    100000000

download \
    "http://storage.googleapis.com/us_audioset/youtube_corpus/v1/csv/class_labels_indices.csv" \
    "$PANNS_DIR/class_labels_indices.csv"

echo "PANNs model downloaded to $PANNS_DIR"

ls -la "$MODEL_DIR"
ls -la "$PANNS_DIR"
