import Konva from "konva";
import type { Filter } from "konva/lib/Node";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Image as KonvaImage,
  Layer,
  Rect,
  Stage,
  Transformer,
} from "react-konva";
import {
  Crop,
  Expand,
  FlipHorizontal2,
  RefreshCcw,
  RotateCcw,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  ARTIST_HERO_DESKTOP_SIZE,
  ArtistHeroFrame,
  artistHeroArtworkFitClassName,
  type ArtistHeroArtworkBounds,
} from "@crate/ui/domain/ArtistHeroFrame";
import { ThemeScope } from "@crate/ui/primitives/ThemeScope";
import {
  DEFAULT_APPEARANCE_PREFERENCES,
  resolveAppearance,
  type AppearanceResolution,
} from "@crate/ui/lib/appearance-resolver";

import { cn } from "@/lib/utils";

import {
  centeredCropForAspect,
  clampFillScale,
  constrainCoverFrame,
  cropFrameForCanvas,
  cropFromCanvasFrame,
  fillPositionFromCanvas,
  fillSubjectFrame,
  zoomCrop,
  type CompositionSize,
  type HeroRecipe,
  type HeroRotation,
} from "./hero-composition-geometry";
import {
  pillowBrightnessFilter,
  pillowContrastFilter,
  pillowGrayscaleFilter,
} from "./hero-image-treatment";

interface HeroCompositionCanvasProps {
  sourceUrl: string | null;
  previewUrl?: string;
  artistName: string;
  composition: "desktop" | "mobile";
  aspect: number;
  recipe: HeroRecipe;
  editable?: boolean;
  previewOnly?: boolean;
  previewArtworkBounds?: ArtistHeroArtworkBounds;
  appearance?: AppearanceResolution;
  children?: ReactNode;
  onRecipeChange: (recipe: HeroRecipe) => void;
}

const MOBILE_PRESENTATION_VIEWPORT = { width: 430, height: 537.5 } as const;
const DEFAULT_HERO_PREVIEW_APPEARANCE = resolveAppearance(
  DEFAULT_APPEARANCE_PREFERENCES,
  { prefersColorSchemeDark: true, prefersReducedMotion: false },
);

function useLoadedImage(sourceUrl: string | null): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!sourceUrl) {
      setImage(null);
      return;
    }

    let active = true;
    const nextImage = new window.Image();
    nextImage.onload = () => {
      if (active) setImage(nextImage);
    };
    nextImage.onerror = () => {
      if (active) setImage(null);
    };
    nextImage.crossOrigin = "anonymous";
    nextImage.src = sourceUrl;
    return () => {
      active = false;
      nextImage.onload = null;
      nextImage.onerror = null;
    };
  }, [sourceUrl]);

  return image;
}

function useArtboardSize(
  aspect: number,
  composition: "desktop" | "mobile",
): [React.RefObject<HTMLDivElement | null>, CompositionSize] {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<CompositionSize>(() => {
    const width = composition === "desktop" ? 960 : 520;
    return { width, height: Math.round(width / aspect) };
  });

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const measure = () => {
      const width = Math.round(element.getBoundingClientRect().width);
      if (width <= 0) return;
      const height = Math.round(width / aspect);
      setSize((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height },
      );
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [aspect]);

  return [containerRef, size];
}

function sourceSizeForRotation(
  image: HTMLImageElement,
  rotation: HeroRotation,
): CompositionSize {
  const swapsAxes = rotation === 90 || rotation === 270;
  return {
    width: swapsAxes ? image.naturalHeight : image.naturalWidth,
    height: swapsAxes ? image.naturalWidth : image.naturalHeight,
  };
}

function transformSourceImage(
  image: HTMLImageElement,
  rotation: HeroRotation,
  flipHorizontal: boolean,
): HTMLImageElement | HTMLCanvasElement {
  if (rotation === 0 && !flipHorizontal) return image;

  const size = sourceSizeForRotation(image, rotation);
  const transformed = document.createElement("canvas");
  transformed.width = size.width;
  transformed.height = size.height;
  const context = transformed.getContext("2d");
  if (!context) return image;

  context.translate(size.width / 2, size.height / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.scale(flipHorizontal ? -1 : 1, 1);
  context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  return transformed;
}

export function HeroCompositionCanvas({
  sourceUrl,
  previewUrl,
  artistName,
  composition,
  aspect,
  recipe,
  editable = true,
  previewOnly = false,
  previewArtworkBounds,
  appearance = DEFAULT_HERO_PREVIEW_APPEARANCE,
  children,
  onRecipeChange,
}: HeroCompositionCanvasProps) {
  const image = useLoadedImage(sourceUrl);
  const [containerRef, canvas] = useArtboardSize(aspect, composition);
  const subjectRef = useRef<Konva.Image>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const rotation = recipe.rotation ?? 0;
  const imageSize = useMemo(
    () => (image ? sourceSizeForRotation(image, rotation) : null),
    [image, rotation],
  );
  const renderedImage = useMemo(
    () =>
      image
        ? transformSourceImage(image, rotation, recipe.flip_horizontal)
        : null,
    [image, recipe.flip_horizontal, rotation],
  );
  const canCompose = Boolean(
    !previewOnly && editable && renderedImage && imageSize,
  );
  const brightness = Math.min(Math.max(recipe.brightness ?? 1, 0.5), 1.5);
  const contrast = Math.min(Math.max(recipe.contrast ?? 1, 0.5), 1.5);
  const imageFilters = useMemo(() => {
    const filters: Filter[] = [];
    if (recipe.grayscale) filters.push(pillowGrayscaleFilter);
    if (brightness !== 1) filters.push(pillowBrightnessFilter);
    if (contrast !== 1) filters.push(pillowContrastFilter);
    return filters;
  }, [brightness, contrast, recipe.grayscale]);

  const setRecipe = useCallback(
    (patch: Partial<HeroRecipe>) => onRecipeChange({ ...recipe, ...patch }),
    [onRecipeChange, recipe],
  );

  useEffect(() => {
    if (!imageSize || recipe.mode !== "crop") return;
    const crop = recipe.crop;
    const cropAspect = crop.width / Math.max(crop.height, 1);
    const cropIsValid =
      crop.width > 0 &&
      crop.height > 0 &&
      crop.x >= 0 &&
      crop.y >= 0 &&
      crop.x + crop.width <= imageSize.width + 1 &&
      crop.y + crop.height <= imageSize.height + 1 &&
      Math.abs(cropAspect - aspect) < 0.02;
    if (!cropIsValid) {
      // The canvas owns validation but the parent owns the persisted recipe.
      // react-doctor-disable-next-line no-pass-data-to-parent, no-pass-live-state-to-parent
      setRecipe({ crop: centeredCropForAspect(imageSize, aspect) });
    }
  }, [aspect, imageSize, recipe.crop, recipe.mode, setRecipe]);

  useEffect(() => {
    const subject = subjectRef.current;
    if (!subject) return;
    if (imageFilters.length > 0) subject.cache({ pixelRatio: 1 });
    else subject.clearCache();
    subject.getLayer()?.batchDraw();
  }, [
    canvas.height,
    canvas.width,
    imageFilters,
    brightness,
    contrast,
    recipe.mode,
    recipe.position_x,
    recipe.position_y,
    recipe.scale,
    renderedImage,
  ]);

  useEffect(() => {
    const transformer = transformerRef.current;
    const subject = subjectRef.current;
    if (!transformer || !subject || recipe.mode !== "extend" || !canCompose)
      return;
    transformer.nodes([subject]);
    transformer.forceUpdate();
    transformer.getLayer()?.batchDraw();
  }, [
    canCompose,
    canvas.height,
    canvas.width,
    recipe.mode,
    recipe.position_x,
    recipe.position_y,
    recipe.scale,
    renderedImage,
  ]);

  const applyZoom = useCallback(
    (factor: number) => {
      if (!imageSize || !canCompose) return;
      if (recipe.mode === "crop") {
        setRecipe({
          crop: zoomCrop(recipe.crop, imageSize, factor, aspect),
        });
        return;
      }
      setRecipe({
        scale: Math.round(clampFillScale(recipe.scale * factor) * 100) / 100,
      });
    },
    [
      aspect,
      canCompose,
      imageSize,
      recipe.crop,
      recipe.mode,
      recipe.scale,
      setRecipe,
    ],
  );

  const reset = () => {
    if (!image || !canCompose) return;
    const originalSize = sourceSizeForRotation(image, 0);
    onRecipeChange({
      ...recipe,
      crop: centeredCropForAspect(originalSize, aspect),
      position_x: 0.5,
      position_y: 0.5,
      scale: 1,
      flip_horizontal: false,
      rotation: 0,
    });
  };

  const rotate = (direction: -90 | 90) => {
    if (!image || !canCompose) return;
    const nextRotation = ((rotation + direction + 360) % 360) as HeroRotation;
    const nextImageSize = sourceSizeForRotation(image, nextRotation);
    onRecipeChange({
      ...recipe,
      rotation: nextRotation,
      crop: centeredCropForAspect(nextImageSize, aspect),
    });
  };

  const cropFrame =
    imageSize && recipe.mode === "crop"
      ? cropFrameForCanvas(imageSize, canvas, recipe.crop)
      : null;
  const subjectFrame =
    imageSize && recipe.mode === "extend"
      ? fillSubjectFrame(imageSize, canvas, {
          positionX: recipe.position_x,
          positionY: recipe.position_y,
          scale: recipe.scale,
        })
      : null;
  const computedArtworkBounds = subjectFrame
    ? {
        left: subjectFrame.x / canvas.width,
        top: subjectFrame.y / canvas.height,
        right: (subjectFrame.x + subjectFrame.width) / canvas.width,
        bottom: (subjectFrame.y + subjectFrame.height) / canvas.height,
      }
    : undefined;
  const artworkBounds =
    previewOnly && previewUrl && previewArtworkBounds
      ? previewArtworkBounds
      : computedArtworkBounds;
  const presentationViewport =
    composition === "desktop"
      ? ARTIST_HERO_DESKTOP_SIZE
      : MOBILE_PRESENTATION_VIEWPORT;
  const presentationScale = canvas.width / presentationViewport.width;

  return (
    <ThemeScope
      appearance={appearance}
      data-testid="hero-composition-theme-scope"
      className="min-w-0"
    >
      <div
        ref={containerRef}
        data-testid="hero-composition-canvas"
        data-canvas-width={canvas.width}
        data-canvas-height={canvas.height}
        className={cn(
          "relative mx-auto w-full overflow-hidden bg-transparent",
          previewOnly
            ? "border border-white/8"
            : "rounded-md border border-border shadow-[0_20px_60px_rgba(0,0,0,0.28)]",
          composition === "mobile" ? "max-w-[560px]" : "",
        )}
        style={{ aspectRatio: String(aspect) }}
      >
        <ArtistHeroFrame
          composition={composition}
          artworkBounds={artworkBounds}
          className="h-full"
          contentClassName="pointer-events-none"
          artwork={
            <div className="absolute inset-0">
              {renderedImage && imageSize && !(previewOnly && previewUrl) ? (
                <Stage
                  width={canvas.width}
                  height={canvas.height}
                  onWheel={
                    previewOnly
                      ? undefined
                      : (event) => {
                          event.evt.preventDefault();
                          applyZoom(event.evt.deltaY < 0 ? 1.12 : 1 / 1.12);
                        }
                  }
                >
                  <Layer listening={!previewOnly}>
                    {recipe.mode === "crop" && cropFrame ? (
                      <KonvaImage
                        ref={subjectRef}
                        image={renderedImage}
                        x={cropFrame.x}
                        y={cropFrame.y}
                        width={cropFrame.width}
                        height={cropFrame.height}
                        filters={imageFilters}
                        brightness={brightness}
                        contrast={contrast}
                        draggable={canCompose}
                        dragBoundFunc={(point) => {
                          const next = constrainCoverFrame(
                            { ...cropFrame, x: point.x, y: point.y },
                            canvas,
                          );
                          return { x: next.x, y: next.y };
                        }}
                        onDragEnd={(event) => {
                          setRecipe({
                            crop: cropFromCanvasFrame(imageSize, canvas, {
                              ...cropFrame,
                              x: event.target.x(),
                              y: event.target.y(),
                            }),
                          });
                        }}
                      />
                    ) : null}
                    {recipe.mode === "extend" && subjectFrame ? (
                      <>
                        <KonvaImage
                          ref={subjectRef}
                          name="fill-subject"
                          image={renderedImage}
                          x={subjectFrame.x}
                          y={subjectFrame.y}
                          width={subjectFrame.width}
                          height={subjectFrame.height}
                          filters={imageFilters}
                          brightness={brightness}
                          contrast={contrast}
                          draggable={canCompose}
                          onDragEnd={(event) => {
                            const position = fillPositionFromCanvas(
                              imageSize,
                              canvas,
                              recipe.scale,
                              { x: event.target.x(), y: event.target.y() },
                            );
                            setRecipe({
                              position_x: position.positionX,
                              position_y: position.positionY,
                            });
                          }}
                          onTransformEnd={(event) => {
                            const node = event.target;
                            const factor = Math.max(
                              Math.abs(node.scaleX()),
                              Math.abs(node.scaleY()),
                            );
                            const scale = clampFillScale(recipe.scale * factor);
                            const position = fillPositionFromCanvas(
                              imageSize,
                              canvas,
                              scale,
                              { x: node.x(), y: node.y() },
                            );
                            node.scaleX(1);
                            node.scaleY(1);
                            setRecipe({
                              scale: Math.round(scale * 100) / 100,
                              position_x: position.positionX,
                              position_y: position.positionY,
                            });
                          }}
                        />
                      </>
                    ) : null}
                    {!previewOnly ? (
                      <Rect
                        x={1}
                        y={1}
                        width={Math.max(0, canvas.width - 2)}
                        height={Math.max(0, canvas.height - 2)}
                        stroke="rgba(255,255,255,0.16)"
                        strokeWidth={1}
                        listening={false}
                      />
                    ) : null}
                    {recipe.mode === "extend" && canCompose ? (
                      <Transformer
                        ref={transformerRef}
                        rotateEnabled={false}
                        flipEnabled={false}
                        keepRatio
                        enabledAnchors={[
                          "top-left",
                          "top-right",
                          "bottom-left",
                          "bottom-right",
                        ]}
                        anchorFill="#06b6d4"
                        anchorStroke="#061014"
                        anchorSize={10}
                        borderStroke="rgba(6,182,212,0.9)"
                        boundBoxFunc={(oldBox, newBox) =>
                          newBox.width < 48 || newBox.height < 48
                            ? oldBox
                            : newBox
                        }
                      />
                    ) : null}
                  </Layer>
                </Stage>
              ) : previewUrl ? (
                <img
                  src={previewUrl}
                  alt={`${artistName} ${composition} hero`}
                  className={cn(
                    "h-full w-full",
                    artistHeroArtworkFitClassName(previewArtworkBounds),
                  )}
                />
              ) : (
                <div className="flex h-full min-h-[280px] items-center justify-center text-sm text-white/40">
                  Select a source to compose the hero
                </div>
              )}
            </div>
          }
        >
          {children ? (
            <div
              data-testid={`${composition}-hero-scaled-presentation`}
              className="absolute left-0 top-0"
              style={{
                width: presentationViewport.width,
                height: presentationViewport.height,
                transform: `scale(${presentationScale})`,
                transformOrigin: "top left",
              }}
            >
              {children}
            </div>
          ) : null}
        </ArtistHeroFrame>
        {!previewOnly ? (
          <div className="pointer-events-none absolute right-3 top-3 z-30 rounded-md border border-border-quiet bg-surface-overlay px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted backdrop-blur-md">
            {recipe.mode === "crop" ? "Crop" : "Fill preview"} · {composition}
          </div>
        ) : null}
      </div>

      {!previewOnly ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border border-border bg-background/35 p-1">
              <ToolButton
                label="Crop"
                pressed={recipe.mode === "crop"}
                disabled={!canCompose}
                onClick={() => setRecipe({ mode: "crop" })}
              >
                <Crop className="h-4 w-4" />
                Crop
              </ToolButton>
              <ToolButton
                label="Fill"
                pressed={recipe.mode === "extend"}
                disabled={!canCompose}
                onClick={() => setRecipe({ mode: "extend" })}
              >
                <Expand className="h-4 w-4" />
                Fill
              </ToolButton>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <IconToolButton
                label="Zoom out"
                disabled={!canCompose}
                onClick={() => applyZoom(1 / 1.12)}
              >
                <ZoomOut className="h-4 w-4" />
              </IconToolButton>
              <IconToolButton
                label="Zoom in"
                disabled={!canCompose}
                onClick={() => applyZoom(1.12)}
              >
                <ZoomIn className="h-4 w-4" />
              </IconToolButton>
              <IconToolButton
                label="Flip"
                disabled={!canCompose}
                pressed={recipe.flip_horizontal}
                onClick={() =>
                  setRecipe({ flip_horizontal: !recipe.flip_horizontal })
                }
              >
                <FlipHorizontal2 className="h-4 w-4" />
              </IconToolButton>
              <IconToolButton
                label="Rotate counterclockwise"
                disabled={!canCompose}
                onClick={() => rotate(-90)}
              >
                <RotateCcw className="h-4 w-4" />
              </IconToolButton>
              <IconToolButton
                label="Rotate clockwise"
                disabled={!canCompose}
                onClick={() => rotate(90)}
              >
                <RotateCw className="h-4 w-4" />
              </IconToolButton>
              <IconToolButton
                label="Reset"
                disabled={!canCompose}
                onClick={reset}
              >
                <RefreshCcw className="h-4 w-4" />
              </IconToolButton>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {recipe.mode === "crop"
              ? "Drag the image to choose the crop. Use the wheel or zoom controls to resize it."
              : "Drag and resize the image freely, including beyond the canvas. Empty space uses the app surface."}
          </p>
        </>
      ) : null}
    </ThemeScope>
  );
}

function ToolButton({
  label,
  pressed,
  disabled,
  onClick,
  children,
}: React.PropsWithChildren<{
  label: string;
  pressed: boolean;
  disabled: boolean;
  onClick: () => void;
}>) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        pressed
          ? "bg-primary/14 text-primary"
          : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function IconToolButton({
  label,
  pressed,
  disabled,
  onClick,
  children,
}: React.PropsWithChildren<{
  label: string;
  pressed?: boolean;
  disabled: boolean;
  onClick: () => void;
}>) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background/35 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40",
        pressed ? "border-primary/40 text-primary" : "",
      )}
    >
      {children}
    </button>
  );
}
