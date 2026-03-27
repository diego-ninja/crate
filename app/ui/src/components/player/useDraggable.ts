import { useState, useRef, useEffect } from "react";

export function useDraggable(storageKey: string, defaultPos: { x: number; y: number }) {
  const [pos, setPos] = useState(() => {
    try {
      const saved = localStorage.getItem(`panel-pos-${storageKey}`);
      return saved ? JSON.parse(saved) : defaultPos;
    } catch {
      return defaultPos;
    }
  });
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });

  const onDragStart = (e: React.MouseEvent) => {
    dragging.current = true;
    offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.preventDefault();
  };

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current) return;
      setPos({ x: e.clientX - offset.current.x, y: e.clientY - offset.current.y });
    };
    const up = () => {
      if (dragging.current) {
        dragging.current = false;
        setPos((p: { x: number; y: number }) => {
          localStorage.setItem(`panel-pos-${storageKey}`, JSON.stringify(p));
          return p;
        });
      }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [storageKey]);

  return { pos, onDragStart };
}
