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
    if (!active || !canvasRef.current || !audioElement) {
      if (vizRef.current) {
        vizRef.current.destroy();
        vizRef.current = null;
      }
      analyserRef.current = null;
      return;
    }

    const canvas = canvasRef.current;
    let cancelled = false;
    let attempts = 0;

    const tryInit = () => {
      if (cancelled) return;
      attempts += 1;

      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) {
        if (attempts < 50) requestAnimationFrame(tryInit);
        return;
      }

      const node = createAnalyserNode(audioElement, 2048);
      if (!node) {
        if (attempts < 50) window.setTimeout(tryInit, 200);
        return;
      }
      analyserRef.current = node;

      try {
        const viz = new MusicVisualizer(canvas, node);
        vizRef.current = viz;
        viz.start();
        window.setTimeout(() => {
          if (!cancelled && vizRef.current) {
            const nextWidth = canvas.clientWidth;
            const nextHeight = canvas.clientHeight;
            if (nextWidth > 0 && nextHeight > 0) {
              vizRef.current.setSize(nextWidth, nextHeight);
            }
          }
        }, 100);
      } catch (e) {
        console.error('Failed to initialize WebGL visualizer:', e);
      }
    };

    const initId = window.setTimeout(tryInit, 50);

    return () => {
      cancelled = true;
      clearTimeout(initId);
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
