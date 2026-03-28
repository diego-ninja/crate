"""Export PANNs CNN14 to ONNX format for use in crate-cli.

Usage (inside the Docker container where PANNs is installed):
    python export_panns_onnx.py [output_path]

Default output: tools/grooveyard-bliss/models/panns_cnn14.onnx

The script loads the same CNN14 checkpoint used by audio_analysis.py
and exports it to ONNX with opset 17. Input: [batch, samples] float32
at 32000 Hz. Output: [batch, 527] class probabilities.
"""

import sys
from pathlib import Path

import torch
import torch.nn as nn

PANNS_DATA_DIR = Path("/app/panns_data")
CHECKPOINT = PANNS_DATA_DIR / "Cnn14_mAP=0.431.pth"
SAMPLE_RATE = 32000
DURATION_SEC = 30
NUM_SAMPLES = SAMPLE_RATE * DURATION_SEC  # 960000


def main():
    output_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
        "/app/models/panns_cnn14.onnx"
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # panns_inference uses AudioTagging which wraps Cnn14
    # We load the model the same way panns_inference does internally
    import panns_inference
    from panns_inference.models import Cnn14

    model = Cnn14(
        sample_rate=SAMPLE_RATE,
        window_size=1024,
        hop_size=320,
        mel_bins=64,
        fmin=50,
        fmax=14000,
        classes_num=527,
    )

    checkpoint = torch.load(str(CHECKPOINT), map_location="cpu", weights_only=False)
    model.load_state_dict(checkpoint["model"])
    model.eval()

    # The Cnn14 forward() returns a dict with 'clipwise_output', 'embedding'.
    # For ONNX export we need a simple tensor output.
    # Wrap it to return only clipwise_output (527 class probabilities).
    class Cnn14Wrapper(nn.Module):
        def __init__(self, model):
            super().__init__()
            self.model = model

        def forward(self, x):
            out = self.model(x)
            return out["clipwise_output"]

    wrapper = Cnn14Wrapper(model)
    wrapper.eval()

    dummy_input = torch.randn(1, NUM_SAMPLES)

    print(f"Exporting to {output_path} ...")
    torch.onnx.export(
        wrapper,
        dummy_input,
        str(output_path),
        opset_version=17,
        input_names=["waveform"],
        output_names=["clipwise_output"],
        dynamic_axes={
            "waveform": {0: "batch", 1: "samples"},
            "clipwise_output": {0: "batch"},
        },
    )

    size_mb = output_path.stat().st_size / (1024 * 1024)
    print(f"Exported: {output_path} ({size_mb:.1f} MB)")

    # Also export the AudioSet class labels as JSON for the Rust side
    labels_path = output_path.parent / "audioset_labels.json"
    import csv
    import json

    labels_csv = PANNS_DATA_DIR / "class_labels_indices.csv"
    if labels_csv.exists():
        with open(labels_csv) as f:
            reader = csv.reader(f)
            rows = list(reader)
        labels = [row[2] for row in rows[1:]]
        with open(labels_path, "w") as f:
            json.dump(labels, f)
        print(f"Labels: {labels_path} ({len(labels)} classes)")
    else:
        print(f"WARNING: {labels_csv} not found, labels not exported")


if __name__ == "__main__":
    main()
