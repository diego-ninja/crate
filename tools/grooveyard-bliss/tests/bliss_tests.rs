mod common;

use common::create_test_wav;
use crate_cli::bliss::{analyze_file, euclidean_distance};
use tempfile::TempDir;

#[test]
fn test_bliss_single_file() {
    let dir = TempDir::new().unwrap();
    let path = create_test_wav(&dir, "test.wav", 440.0, 3.0);

    let result = analyze_file(&path);
    assert!(result.error.is_none(), "Should analyze without error: {:?}", result.error);
    assert!(
        !result.features.is_empty(),
        "Features should not be empty"
    );
    assert_eq!(result.features.len(), 20, "Bliss should produce 20 features");
}

#[test]
fn test_bliss_batch() {
    let dir = TempDir::new().unwrap();
    create_test_wav(&dir, "t1.wav", 440.0, 3.0);
    create_test_wav(&dir, "t2.wav", 523.25, 3.0);

    let exts = crate_cli::parse_extensions("wav");
    let files = crate_cli::collect_audio_files(dir.path(), &exts);
    assert_eq!(files.len(), 2);

    let results: Vec<_> = files.iter().map(|f| analyze_file(f)).collect();
    assert_eq!(results.len(), 2);
    for r in &results {
        assert!(r.error.is_none());
        assert_eq!(r.features.len(), 20);
    }
}

#[test]
fn test_bliss_similarity_ordering() {
    let dir = TempDir::new().unwrap();
    // Create three files: two similar (close frequencies), one different
    let a = create_test_wav(&dir, "a_440.wav", 440.0, 3.0);
    let b = create_test_wav(&dir, "b_445.wav", 445.0, 3.0); // Very close to A
    let c = create_test_wav(&dir, "c_2000.wav", 2000.0, 3.0); // Very different

    let ra = analyze_file(&a);
    let rb = analyze_file(&b);
    let rc = analyze_file(&c);

    assert!(ra.error.is_none());
    assert!(rb.error.is_none());
    assert!(rc.error.is_none());

    let dist_ab = euclidean_distance(&ra.features, &rb.features);
    let dist_ac = euclidean_distance(&ra.features, &rc.features);

    assert!(
        dist_ab < dist_ac,
        "Similar frequencies (440 vs 445, dist={}) should be closer than different (440 vs 2000, dist={})",
        dist_ab,
        dist_ac
    );
}

#[test]
fn test_bliss_invalid_file() {
    let dir = TempDir::new().unwrap();
    let bad_path = dir.path().join("garbage.flac");
    std::fs::write(&bad_path, b"not real audio").unwrap();

    let result = analyze_file(&bad_path);
    assert!(result.error.is_some(), "Invalid file should produce error");
    assert!(result.features.is_empty());
}

#[test]
fn test_euclidean_distance_identical() {
    let a = vec![1.0, 2.0, 3.0];
    let b = vec![1.0, 2.0, 3.0];
    let dist = euclidean_distance(&a, &b);
    assert!((dist - 0.0).abs() < f32::EPSILON, "Identical vectors should have 0 distance");
}

#[test]
fn test_euclidean_distance_different_lengths() {
    let a = vec![1.0, 2.0];
    let b = vec![1.0, 2.0, 3.0];
    let dist = euclidean_distance(&a, &b);
    assert_eq!(dist, f32::MAX, "Different-length vectors should return MAX");
}
