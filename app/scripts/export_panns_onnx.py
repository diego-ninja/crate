"""Export PANNs CNN14 to ONNX format for use in crate-cli.

Usage (inside the Docker container where PANNs is installed):
    python scripts/export_panns_onnx.py [output_path]

Default output: /app/models/panns_cnn14.onnx

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

    if not CHECKPOINT.exists():
        print(f"PANNs checkpoint not found at {CHECKPOINT}, skipping ONNX export")
        return

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

    print(f"Exporting PANNs CNN14 to {output_path} ...")
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
    print(f"PANNs ONNX exported: {output_path} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
