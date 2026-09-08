import { useEffect, useRef, useState, useCallback } from "react";

import { getAnalyserNode } from "@/lib/gapless-player";
import {
  isMotionBlocked,
  subscribeToMotionAvailability,
} from "@/lib/motion-availability";

const BAR_COUNT = 64;

/**
 * Reuse Gapless-5's analyser directly so the visualizer always taps the
 * actual playback engine instead of an extra derived node.
 */
export function createAnalyserNode(fftSize = 2048): AnalyserNode | null {
  const analyser = getAnalyserNode();
  if (!analyser) return null;
  try {
    if (analyser.fftSize !== fftSize) {
      analyser.fftSize = fftSize;
    }
    return analyser;
  } catch {
    return null;
  }
}

export function useAudioVisualizer(
  enabled: boolean,
  trackKey?: string,
  analyserNode?: AnalyserNode | null,
) {
  const [frequenciesDb, setFrequenciesDb] = useState<number[]>([]);
  const [sampleRate, setSampleRate] = useState(44100);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  const dataRef = useRef<Float32Array<ArrayBuffer> | null>(null);

  const [waveform, setWaveform] = useState<number[]>([]);
  const waveRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  const frameCountRef = useRef(0);

  const tick = useCallback(() => {
    if (isMotionBlocked()) {
      rafRef.current = 0;
      return;
    }
    if (!analyserRef.current || !dataRef.current) return;
    frameCountRef.current++;
    // Throttle state updates to ~20fps (every 3rd frame at 60fps)
    const shouldUpdate = frameCountRef.current % 3 === 0;

    analyserRef.current.getFloatFrequencyData(dataRef.current);
    if (shouldUpdate) {
      const spectrum: number[] = [];
      for (let i = 0; i < dataRef.current.length; i++) {
        spectrum.push(dataRef.current[i]!);
      }
      setFrequenciesDb(spectrum);

      if (waveRef.current) {
        analyserRef.current.getByteTimeDomainData(waveRef.current);
        const wave: number[] = [];
        for (let i = 0; i < waveRef.current.length; i++) {
          wave.push((waveRef.current[i]! - 128) / 128);
        }
        setWaveform(wave);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    analyserRef.current = null;
    dataRef.current = null;
    waveRef.current = null;
    frameCountRef.current = 0;
    setFrequenciesDb([]);
    setWaveform([]);

    if (!enabled) {
      return;
    }

    const node = analyserNode || getAnalyserNode();
    if (!node) return;

    // Lower smoothing for more responsive peaks (default 0.8 flattens everything)
    node.smoothingTimeConstant = 0.55;
    node.minDecibels = -90;
    node.maxDecibels = -10;
    analyserRef.current = node;
    setSampleRate(node.context.sampleRate || 44100);
    dataRef.current = new Float32Array(node.frequencyBinCount);
    waveRef.current = new Uint8Array(node.fftSize);

    const startSampling = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      if (isMotionBlocked()) return;
      rafRef.current = requestAnimationFrame(tick);
    };
    const unsubscribeFromMotion = subscribeToMotionAvailability(startSampling);
    startSampling();

    return () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      unsubscribeFromMotion();
      analyserRef.current = null;
      dataRef.current = null;
      waveRef.current = null;
    };
  }, [analyserNode, enabled, tick, trackKey]);

  return { frequenciesDb, waveform, barCount: BAR_COUNT, sampleRate };
}
