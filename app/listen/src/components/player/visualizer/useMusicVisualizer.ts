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

    const canvas = canvasRef.current;

    // Wait for canvas to have layout dimensions before creating WebGL context
    const initId = requestAnimationFrame(() => {
      if (!canvas.clientWidth || !canvas.clientHeight) return;

      const node = createAnalyserNode(audioElement, 2048);
      if (!node) return;
      analyserRef.current = node;

      try {
        const viz = new MusicVisualizer(canvas, node);
        vizRef.current = viz;
        viz.setSize(canvas.clientWidth, canvas.clientHeight);
        viz.start();
      } catch (e) {
        console.error('Failed to initialize WebGL visualizer:', e);
      }
    });

    return () => {
      cancelAnimationFrame(initId);
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

  return vizRef;
}
