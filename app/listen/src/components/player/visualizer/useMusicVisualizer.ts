import { useRef, useEffect } from 'react';
import { MusicVisualizer } from './MusicVisualizer';
import { createAnalyserNode } from '@/hooks/use-audio-visualizer';
import type { VisualizerMode } from '@/lib/player-visualizer-prefs';

function dbg(msg: string) {
  const d = document.getElementById('viz-debug');
  if (d) d.textContent = msg;
}

export function useMusicVisualizer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  audioElement: HTMLAudioElement | null,
  active: boolean,
  mode: VisualizerMode,
) {
  const vizRef = useRef<MusicVisualizer | null>(null);

  useEffect(() => {
    if (!active || !canvasRef.current || !audioElement) {
      dbg(`off: active=${active} canvas=${!!canvasRef.current} audio=${!!audioElement}`);
      return;
    }

    const canvas = canvasRef.current;
    if (vizRef.current) {
      vizRef.current.stop();
      vizRef.current = null;
    }

    // Retry until canvas has layout dimensions (display:none → visible transition)
    let cancelled = false;
    let attempts = 0;

    const tryInit = () => {
      if (cancelled) return;
      attempts++;

      const w = canvas.clientWidth;
      const h = canvas.clientHeight;

      if (!w || !h) {
        dbg(`attempt ${attempts}: ${w}x${h} waiting...`);
        if (attempts < 50) requestAnimationFrame(tryInit);
        return;
      }

      // Get or create analyser node
      const node = createAnalyserNode(audioElement, 2048);
      if (!node) {
        dbg(`attempt ${attempts}: no analyser, retrying`);
        if (attempts < 50) setTimeout(tryInit, 200);
        return;
      }

      const forceResize = (viz: MusicVisualizer) => {
        // Physically jiggle the canvas to force WebGL to recalculate
        const origW = canvas.style.width;
        canvas.style.width = (canvas.clientWidth - 1) + 'px';
        requestAnimationFrame(() => {
          canvas.style.width = origW;
          requestAnimationFrame(() => {
            const cw = canvas.clientWidth;
            const ch = canvas.clientHeight;
            if (cw > 0 && ch > 0) viz.setSize(cw, ch);
          });
        });
      };

      try {
        const viz = new MusicVisualizer(canvas, node, mode);
        vizRef.current = viz;
        viz.start();
        setTimeout(() => forceResize(viz), 100);
        dbg(`created ${w}x${h}`);
      } catch (e) {
        dbg(`FAIL: ${e}`);
      }
    };

    // Small delay to let the DOM settle after display:none → visible
    const id = setTimeout(tryInit, 50);

    return () => {
      cancelled = true;
      clearTimeout(id);
      if (vizRef.current) {
        vizRef.current.stop();
      }
    };
  }, [canvasRef, audioElement, active, mode]);

  return vizRef;
}
