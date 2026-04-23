export interface VisualizerCanvasRect {
  top: number;
  left: number;
  width: number;
  height: number;
  referenceSize: number;
}

interface MeasureVisualizerCanvasOptions {
  baseScale: number;
  edgePadding?: number;
  bufferScale?: number;
}

export function measureVisualizerCanvasRect(
  anchorRect: DOMRect,
  containerRect: DOMRect,
  {
    baseScale,
    edgePadding = 24,
    bufferScale = 1.28,
  }: MeasureVisualizerCanvasOptions,
): VisualizerCanvasRect | null {
  const centerX = anchorRect.left - containerRect.left + anchorRect.width / 2;
  const centerY = anchorRect.top - containerRect.top + anchorRect.height / 2;

  const horizontalRadius = Math.min(centerX - edgePadding, containerRect.width - centerX - edgePadding);
  const verticalRadius = Math.min(centerY - edgePadding, containerRect.height - centerY - edgePadding);
  const maxSize = Math.floor(Math.max(0, Math.min(horizontalRadius, verticalRadius) * 2));

  if (maxSize <= 0) return null;

  const referenceSize = Math.max(anchorRect.width, anchorRect.height) * baseScale;
  const bufferedSize = referenceSize * bufferScale;
  const size = Math.max(referenceSize, Math.min(maxSize, bufferedSize));

  return {
    top: centerY - size / 2,
    left: centerX - size / 2,
    width: size,
    height: size,
    referenceSize,
  };
}
