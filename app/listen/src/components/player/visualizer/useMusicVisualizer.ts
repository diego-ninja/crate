import { useRef, useEffect } from 'react';
import { MusicVisualizer } from './MusicVisualizer';
import { createAnalyserNode } from '@/hooks/use-audio-visualizer';
import { getAnalyserNode } from '@/lib/gapless-player';
import type { VisualizerMode } from '@/lib/player-visualizer-prefs';

function dbg(msg: string) {
  const d = document.getElementById('viz-debug');
  if (d) d.textContent = msg;
}

export function useMusicVisualizer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  trackKey: string | undefined,
  active: boolean,
  playbackState: { volume: number; isPlaying: boolean },
  mode: VisualizerMode = "spheres",
) {
  const vizRef = useRef<MusicVisualizer | null>(null);
  const playbackStateRef = useRef(playbackState);

  useEffect(() => {
    playbackStateRef.current = playbackState;
  }, [playbackState]);

  useEffect(() => {
    if (!active || !canvasRef.current) {
      dbg(`off: active=${active} canvas=${!!canvasRef.current} analyser=${!!getAnalyserNode()}`);
      return;
    }

    const canvas = canvasRef.current;
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

      const node = createAnalyserNode(2048);
      if (!node) {
        dbg(`attempt ${attempts}: no analyser, retrying`);
        if (attempts < 50) setTimeout(tryInit, 200);
        return;
      }

      if (vizRef.current) {
        vizRef.current.setAnalyser(node);
        vizRef.current.setMode(mode);
        dbg(`updated analyser ${w}x${h}`);
        return;
      }

      const forceResize = (viz: MusicVisualizer) => {
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
        const viz = new MusicVisualizer(canvas, node, () => playbackStateRef.current, mode);
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
    };
  }, [canvasRef, active, mode, trackKey]);

  useEffect(() => {
    if (!active && vizRef.current) {
      vizRef.current.stop();
      vizRef.current = null;
    }
  }, [active]);

  return vizRef;
}
