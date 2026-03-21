import { useEffect, useRef, useState, useCallback } from "react";

const FFT_SIZE = 128;
const BAR_COUNT = FFT_SIZE / 2; // 64 bars

// Singleton — one AudioContext and AnalyserNode shared across the app
let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let sourceNode: MediaElementAudioSourceNode | null = null;
let connectedElement: HTMLAudioElement | null = null;

function connectAudio(audio: HTMLAudioElement): AnalyserNode | null {
  if (connectedElement === audio && analyser) return analyser;

  try {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.8;

    // Only create source once per audio element
    if (connectedElement !== audio) {
      if (sourceNode) {
        try { sourceNode.disconnect(); } catch { /* ok */ }
      }
      sourceNode = audioCtx.createMediaElementSource(audio);
      connectedElement = audio;
    }

    sourceNode!.connect(analyser);
    analyser.connect(audioCtx.destination);

    return analyser;
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

  const tick = useCallback(() => {
    if (!analyserRef.current || !dataRef.current) return;
    analyserRef.current.getByteFrequencyData(dataRef.current);
    // Normalize to 0-1
    const bars: number[] = [];
    for (let i = 0; i < dataRef.current.length; i++) {
      bars.push(dataRef.current[i]! / 255);
    }
    setFrequencies(bars);
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
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [audioElement, enabled, tick]);

  return { frequencies, barCount: BAR_COUNT };
}
