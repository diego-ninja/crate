mod common;

use common::create_test_wav;
use crate_cli::analyze::analyze_track;
use tempfile::TempDir;

#[test]
fn test_analyze_loudness() {
    let dir = TempDir::new().unwrap();

    // Loud sine wave (full amplitude)
    let loud = create_test_wav(&dir, "loud.wav", 440.0, 3.0);
    let loud_result = analyze_track(&loud);
    assert!(loud_result.error.is_none(), "Should analyze without error");
    assert!(loud_result.loudness.is_some());

    // Quiet sine wave - create manually with low amplitude
    let quiet_path = dir.path().join("quiet.wav");
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 22050,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(&quiet_path, spec).unwrap();
    let num_samples = (22050.0 * 3.0) as usize;
    for i in 0..num_samples {
        let t = i as f32 / 22050.0;
        let sample = (t * 440.0 * 2.0 * std::f32::consts::PI).sin() * 0.01;
        writer
            .write_sample((sample * i16::MAX as f32) as i16)
            .unwrap();
    }
    writer.finalize().unwrap();

    let quiet_result = analyze_track(&quiet_path);
    assert!(quiet_result.error.is_none());
    assert!(
        loud_result.loudness.unwrap() > quiet_result.loudness.unwrap(),
        "Loud signal ({:?}) should have higher loudness than quiet ({:?})",
        loud_result.loudness,
        quiet_result.loudness
    );
}

#[test]
fn test_analyze_energy_range() {
    let dir = TempDir::new().unwrap();
    let path = create_test_wav(&dir, "test.wav", 440.0, 3.0);
    let result = analyze_track(&path);
    assert!(result.error.is_none());

    let energy = result.energy.unwrap();
    assert!(
        (0.0..=1.0).contains(&energy),
        "Energy {} should be between 0 and 1",
        energy
    );
}

#[test]
fn test_analyze_key_detection() {
    let dir = TempDir::new().unwrap();
    // A440 should be detected as key A (major or minor)
    let path = create_test_wav(&dir, "a440.wav", 440.0, 5.0);
    let result = analyze_track(&path);
    assert!(result.error.is_none());
    assert!(result.key.is_some(), "Key should be detected");
    assert!(result.scale.is_some(), "Scale should be detected");

    let key = result.key.unwrap();
    let valid_keys = [
        "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
    ];
    assert!(
        valid_keys.contains(&key.as_str()),
        "Key '{}' should be a valid note name",
        key
    );
}

#[test]
fn test_analyze_batch_parallel() {
    let dir = TempDir::new().unwrap();
    create_test_wav(&dir, "t1.wav", 440.0, 2.0);
    create_test_wav(&dir, "t2.wav", 523.25, 2.0);
    create_test_wav(&dir, "t3.wav", 659.25, 2.0);

    let exts = crate_cli::parse_extensions("wav");
    let files = crate_cli::collect_audio_files(dir.path(), &exts);
    assert_eq!(files.len(), 3);

    use rayon::prelude::*;
    let results: Vec<_> = files.par_iter().map(|f| analyze_track(f)).collect();

    assert_eq!(results.len(), 3);
    for r in &results {
        assert!(r.error.is_none(), "All tracks should analyze: {:?}", r.error);
    }
}

#[test]
fn test_analyze_invalid_file() {
    let dir = TempDir::new().unwrap();
    let bad_path = dir.path().join("not_audio.txt");
    std::fs::write(&bad_path, b"this is not audio data").unwrap();

    let result = analyze_track(&bad_path);
    assert!(result.error.is_some(), "Non-audio file should produce error");
}

#[test]
fn test_analyze_empty_file() {
    let dir = TempDir::new().unwrap();
    let empty_path = dir.path().join("empty.wav");
    std::fs::write(&empty_path, b"").unwrap();

    let result = analyze_track(&empty_path);
    assert!(
        result.error.is_some(),
        "Empty file should produce error"
    );
}

#[test]
fn test_analyze_spectral_centroid() {
    let dir = TempDir::new().unwrap();
    // Low frequency
    let low = create_test_wav(&dir, "low.wav", 220.0, 3.0);
    // High frequency
    let high = create_test_wav(&dir, "high.wav", 2000.0, 3.0);

    let low_result = analyze_track(&low);
    let high_result = analyze_track(&high);

    assert!(low_result.error.is_none());
    assert!(high_result.error.is_none());
    assert!(low_result.spectral_centroid.is_some());
    assert!(high_result.spectral_centroid.is_some());

    assert!(
        high_result.spectral_centroid.unwrap() > low_result.spectral_centroid.unwrap(),
        "High freq ({:?}) should have higher centroid than low ({:?})",
        high_result.spectral_centroid,
        low_result.spectral_centroid
    );
}

#[test]
fn test_analyze_dynamic_range() {
    let dir = TempDir::new().unwrap();
    let path = create_test_wav(&dir, "test.wav", 440.0, 3.0);
    let result = analyze_track(&path);
    assert!(result.error.is_none());
    assert!(result.dynamic_range.is_some());

    let dr = result.dynamic_range.unwrap();
    assert!(dr >= 0.0, "Dynamic range should be non-negative: {}", dr);
}

#[test]
fn test_analyze_bpm_detection() {
    let dir = TempDir::new().unwrap();
    let path = create_test_wav(&dir, "sine.wav", 440.0, 5.0);
    let result = analyze_track(&path);
    assert!(result.error.is_none());
    // BPM may or may not be detected on a pure sine, but should not crash
    // If detected, it should be in a reasonable range
    if let Some(bpm) = result.bpm {
        assert!(
            (30.0..=300.0).contains(&bpm),
            "BPM {} should be in reasonable range",
            bpm
        );
    }
}
