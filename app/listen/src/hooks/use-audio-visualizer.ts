import { useEffect, useRef, useState, useCallback } from "react";

import { ensureGainNode, getSourceNode } from "@/lib/audio-engine";

const FFT_SIZE = 128;
const BAR_COUNT = FFT_SIZE / 2; // 64 bars

const CTX_KEY = "__crateAudioCtx" as const;

// Shared analyser nodes — survive hot reloads
let analyser: AnalyserNode | null = null;
let vizAnalyser: AnalyserNode | null = null;

function getAudioCtx(): AudioContext | null {
  return (window as unknown as Record<string, AudioContext>)[CTX_KEY] || null;
}

/**
 * Connect the analyser to the audio graph managed by audio-engine.
 *
 * Graph: source → gainNode → destination  (audio-engine owns this)
 *                ↘ analyser               (we tap from source, read-only)
 *
 * The analyser taps the source directly (before gain) so it reads
 * the unattenuated signal even during fades.
 */
function connectAudio(audio: HTMLAudioElement): AnalyserNode | null {
  if (analyser) return analyser;

  // Ensure audio-engine has set up the graph
  ensureGainNode(audio);
  const source = getSourceNode(audio);
  const ctx = getAudioCtx();
  if (!ctx || !source) return null;

  try {
    analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.8;
    // Tap source directly — doesn't affect the gain→destination chain
    source.connect(analyser);
    return analyser;
  } catch {
    return null;
  }
}

/**
 * Get or create a high-fftSize AnalyserNode for the WebGL visualizer.
 * Taps from the main analyser node.
 */
export function createAnalyserNode(audio: HTMLAudioElement, fftSize = 2048): AnalyserNode | null {
  const mainAnalyser = connectAudio(audio);
  if (!mainAnalyser) return null;

  const ctx = getAudioCtx();
  if (!ctx) return null;

  if (vizAnalyser) {
    try { vizAnalyser.disconnect(); } catch { /* ignore */ }
    vizAnalyser = null;
  }

  try {
    vizAnalyser = ctx.createAnalyser();
    vizAnalyser.fftSize = fftSize;
    vizAnalyser.smoothingTimeConstant = 0.8;
    mainAnalyser.connect(vizAnalyser);
    return vizAnalyser;
  } catch {
    return null;
  }
}

export function useAudioVisualizer(
  audioElement: HTMLAudioElement | null,
  enabled: boolean,
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
    if (!enabled || !audioElement) {
      setFrequencies([]);
      return;
    }

    const node = connectAudio(audioElement);
    if (!node) return;

    analyserRef.current = node;
    dataRef.current = new Uint8Array(node.frequencyBinCount);
    waveRef.current = new Uint8Array(node.fftSize);
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [audioElement, enabled, tick]);

  return { frequencies, waveform, barCount: BAR_COUNT };
}
