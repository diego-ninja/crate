use hound::{SampleFormat, WavSpec, WavWriter};
use std::path::PathBuf;
use tempfile::TempDir;

pub fn create_test_wav(
    dir: &TempDir,
    filename: &str,
    frequency: f32,
    duration_secs: f32,
) -> PathBuf {
    create_test_wav_at(dir.path(), filename, frequency, duration_secs)
}

pub fn create_test_wav_at(
    dir: &std::path::Path,
    filename: &str,
    frequency: f32,
    duration_secs: f32,
) -> PathBuf {
    let path = dir.join(filename);
    let spec = WavSpec {
        channels: 1,
        sample_rate: 22050,
        bits_per_sample: 16,
        sample_format: SampleFormat::Int,
    };
    let mut writer = WavWriter::create(&path, spec).unwrap();
    let num_samples = (spec.sample_rate as f32 * duration_secs) as usize;
    for i in 0..num_samples {
        let t = i as f32 / spec.sample_rate as f32;
        let sample = (t * frequency * 2.0 * std::f32::consts::PI).sin();
        writer
            .write_sample((sample * i16::MAX as f32) as i16)
            .unwrap();
    }
    writer.finalize().unwrap();
    path
}

#[allow(dead_code)]
pub fn create_test_library(dir: &TempDir) -> PathBuf {
    let lib = dir.path().join("library");
    let artist_dir = lib.join("Test Artist");
    let album_dir = artist_dir.join("2024").join("Test Album");
    std::fs::create_dir_all(&album_dir).unwrap();

    create_test_wav_at(&album_dir, "01 - Track One.wav", 440.0, 3.0);
    create_test_wav_at(&album_dir, "02 - Track Two.wav", 523.25, 3.0);
    create_test_wav_at(&album_dir, "03 - Track Three.wav", 659.25, 3.0);

    // Fake cover art
    std::fs::write(album_dir.join("cover.jpg"), b"fake jpeg data").unwrap();

    // Fake artist photo
    std::fs::write(artist_dir.join("artist.jpg"), b"fake photo").unwrap();

    lib
}
