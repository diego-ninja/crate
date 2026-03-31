import { useEffect, useRef, useState, useCallback } from "react";

const FFT_SIZE = 128;
const BAR_COUNT = FFT_SIZE / 2; // 64 bars

// AudioContext is stored on window.__crateAudioCtx (created by PlayerContext on user gesture).
// Source node is stored on the audio element itself to survive hot reloads.
let analyser: AnalyserNode | null = null;
let sourceNode: MediaElementAudioSourceNode | null = null;

const SRC_KEY = "__crateAudioSource" as const;
const CTX_KEY = "__crateAudioCtx" as const;

function getAudioCtx(): AudioContext | null {
  const w = window as unknown as Record<string, AudioContext>;
  return w[CTX_KEY] || null;
}

function ensureAudioContext(audio: HTMLAudioElement & { [SRC_KEY]?: MediaElementAudioSourceNode }) {
  let audioCtx = getAudioCtx();
  if (!audioCtx) {
    // Last resort: create here (may be suspended if no user gesture yet)
    audioCtx = new AudioContext();
    (window as unknown as Record<string, AudioContext>)[CTX_KEY] = audioCtx;
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  // Reuse existing source node if already attached (survives hot reload)
  if (audio[SRC_KEY]) {
    sourceNode = audio[SRC_KEY];
    return;
  }
  try {
    sourceNode = audioCtx.createMediaElementSource(audio);
    audio[SRC_KEY] = sourceNode;
  } catch {
    return;
  }
}

function connectAudio(audio: HTMLAudioElement): AnalyserNode | null {
  if (analyser && sourceNode) return analyser;
  const ctx = getAudioCtx();
  if (!ctx) return null;

  try {
    ensureAudioContext(audio);
    if (!sourceNode) return null;

    analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.8;

    sourceNode.connect(analyser);
    analyser.connect(ctx.destination);

    return analyser;
  } catch {
    return null;
  }
}

/**
 * Create an additional AnalyserNode connected to the shared audio source.
 * Used by the WebGL visualizer which needs its own AnalyserNode (higher fftSize).
 * Safe to call multiple times — reuses the same MediaElementSource.
 */
/**
 * Get or create an AnalyserNode for the WebGL visualizer.
 * Reuses the shared analyser from connectAudio but with higher fftSize.
 */
let vizAnalyser: AnalyserNode | null = null;

export function createAnalyserNode(audio: HTMLAudioElement, fftSize = 2048): AnalyserNode | null {
  // First ensure connectAudio has been called (sets up source → destination chain)
  const mainAnalyser = connectAudio(audio);
  if (!mainAnalyser) return null;

  const ctx = getAudioCtx();
  if (!ctx || !sourceNode) return null;

  if (vizAnalyser) {
    try { vizAnalyser.disconnect(); } catch { /* ignore */ }
    vizAnalyser = null;
  }

  try {
    vizAnalyser = ctx.createAnalyser();
    vizAnalyser.fftSize = fftSize;
    vizAnalyser.smoothingTimeConstant = 0.8;

    // Connect from the main analyser output (not sourceNode directly)
    // This ensures the audio chain: source → mainAnalyser → destination stays intact
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
