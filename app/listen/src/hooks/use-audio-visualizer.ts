import { useEffect, useRef, useState, useCallback } from "react";

import { getAnalyserNode } from "@/lib/gapless-player";

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
    analyser.smoothingTimeConstant = 0.8;
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
  const [frequencies, setFrequencies] = useState<number[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  const [waveform, setWaveform] = useState<number[]>([]);
  const waveRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  const frameCountRef = useRef(0);

  const tick = useCallback(() => {
    if (!analyserRef.current || !dataRef.current) return;
    frameCountRef.current++;
    // Throttle state updates to ~20fps (every 3rd frame at 60fps)
    const shouldUpdate = frameCountRef.current % 3 === 0;

    analyserRef.current.getByteFrequencyData(dataRef.current);
    if (shouldUpdate) {
      const bars: number[] = [];
      for (let i = 0; i < dataRef.current.length; i++) {
        bars.push(dataRef.current[i]! / 255);
      }
      setFrequencies(bars);

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
    if (!enabled) {
      setFrequencies([]);
      return;
    }

    const node = analyserNode || getAnalyserNode();
    if (!node) return;

    analyserRef.current = node;
    dataRef.current = new Uint8Array(node.frequencyBinCount);
    waveRef.current = new Uint8Array(node.fftSize);
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [analyserNode, enabled, tick, trackKey]);

  return { frequencies, waveform, barCount: BAR_COUNT };
}
