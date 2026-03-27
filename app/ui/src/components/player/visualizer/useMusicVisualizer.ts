import { useRef, useEffect } from 'react';
import { MusicVisualizer } from './MusicVisualizer';
import { createAnalyserNode } from '@/hooks/use-audio-visualizer';

export function useMusicVisualizer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  audioElement: HTMLAudioElement | null,
  active: boolean,
) {
  const vizRef = useRef<MusicVisualizer | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !audioElement || !active) {
      if (vizRef.current) {
        vizRef.current.destroy();
        vizRef.current = null;
      }
      analyserRef.current = null;
      return;
    }

    const node = createAnalyserNode(audioElement, 2048);
    if (!node) return;
    analyserRef.current = node;

    try {
      const viz = new MusicVisualizer(canvasRef.current, node);
      vizRef.current = viz;
      viz.start();
    } catch (e) {
      console.error('Failed to initialize WebGL visualizer:', e);
      return;
    }

    return () => {
      if (vizRef.current) {
        vizRef.current.destroy();
        vizRef.current = null;
      }
      if (analyserRef.current) {
        try { analyserRef.current.disconnect(); } catch { /* ok */ }
        analyserRef.current = null;
      }
    };
  }, [canvasRef, audioElement, active]);
}
