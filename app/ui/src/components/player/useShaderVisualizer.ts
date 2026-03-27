import { useRef, useEffect, useCallback } from 'react';
import { ShaderEngine, PresetName, AudioUniforms } from './ShaderEngine';

function avg(arr: number[], from: number, to: number): number {
  let sum = 0;
  const end = Math.min(to, arr.length);
  for (let i = from; i < end; i++) sum += arr[i] ?? 0;
  return end > from ? sum / (end - from) : 0;
}

export function useShaderVisualizer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  frequencies: number[],
  audioMeta: { bpm?: number; energy?: number } | null,
  active: boolean,
) {
  const engineRef = useRef<ShaderEngine | null>(null);
  const beatRef = useRef(0);
  const prevBassRef = useRef(0);
  const bassHistoryRef = useRef<number[]>([]);

  useEffect(() => {
    if (!canvasRef.current || !active) return;
    const engine = new ShaderEngine(canvasRef.current);
    engine.loadPreset('nebula');
    engine.start();
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [canvasRef, active]);

  useEffect(() => {
    if (!engineRef.current || !active || frequencies.length === 0) return;

    const bass = avg(frequencies, 0, 8);
    const mids = avg(frequencies, 8, 40);
    const treble = avg(frequencies, 40, Math.min(frequencies.length, 128));

    // Beat detection: bass spike vs moving average
    bassHistoryRef.current.push(bass);
    if (bassHistoryRef.current.length > 30) bassHistoryRef.current.shift();
    const bassAvg =
      bassHistoryRef.current.reduce((a, b) => a + b, 0) /
      bassHistoryRef.current.length;
    if (
      bass > bassAvg * 1.4 &&
      bass > 0.3 &&
      bass - prevBassRef.current > 0.05
    ) {
      beatRef.current = 1.0;
    }
    beatRef.current *= 0.92;
    prevBassRef.current = bass;

    const uniforms: AudioUniforms = {
      bpm: audioMeta?.bpm || 120,
      energy: audioMeta?.energy || 0.5,
      bass,
      mids,
      treble,
      beat: beatRef.current,
    };

    engineRef.current.updateAudio(frequencies, uniforms);
  }, [frequencies, audioMeta, active]);

  const nextPreset = useCallback((): PresetName | null => {
    return engineRef.current?.nextPreset() ?? null;
  }, []);

  const prevPreset = useCallback((): PresetName | null => {
    return engineRef.current?.prevPreset() ?? null;
  }, []);

  const getPreset = useCallback((): PresetName => {
    return engineRef.current?.getPreset() ?? 'nebula';
  }, []);

  return { nextPreset, prevPreset, getPreset };
}
