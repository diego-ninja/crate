import { useRef, useState, useCallback } from "react";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import { Button } from "@crate/ui/shadcn/button";
import { toast } from "sonner";
import { Camera, Loader2, X } from "lucide-react";

interface ImageCropUploadProps {
  endpoint: string;
  aspect: number;
  onUploaded?: () => void;
  className?: string;
  label?: string;
}

export function ImageCropUpload({ endpoint, aspect, onUploaded, className, label }: ImageCropUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);

  function handleFileSelect(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImageSrc(reader.result as string);
    reader.readAsDataURL(file);
  }

  const onCropComplete = useCallback((_: Area, croppedPixels: Area) => {
    setCroppedArea(croppedPixels);
  }, []);

  async function handleUpload() {
    if (!imageSrc || !croppedArea) return;
    setUploading(true);
    try {
      const blob = await getCroppedBlob(imageSrc, croppedArea);
      const form = new FormData();
      form.append("file", blob, "image.jpg");
      const res = await fetch(endpoint, { method: "POST", body: form, credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      // Wait for worker task to complete
      if (data.task_id) {
        toast.success("Processing image...");
        await waitForTask(data.task_id);
      }

      toast.success("Image saved");
      setImageSrc(null);
      onUploaded?.();
    } catch (e) {
      toast.error(`Upload failed: ${e instanceof Error ? e.message : "Unknown"}`);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function cancel() {
    setImageSrc(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <>
      <input ref={inputRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { if (e.target.files?.[0]) handleFileSelect(e.target.files[0]); }} />

      {/* Trigger button (overlay) */}
      <button
        className={className ?? "absolute bottom-1 right-1 p-1.5 rounded-md bg-black/60 text-white/70 hover:text-white hover:bg-black/80 opacity-0 group-hover/cover:opacity-100 transition-opacity"}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); inputRef.current?.click(); }}
        title="Upload image"
      >
        <Camera size={14} />
        {label ? <span>{label}</span> : null}
      </button>

      {/* Crop modal */}
      {imageSrc && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/80" onClick={cancel}>
          <div className="bg-card rounded-md shadow-2xl w-[90vw] max-w-[600px] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-sm font-medium">Crop Image</span>
              <button onClick={cancel} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
            </div>

            <div className="relative w-full" style={{ height: aspect >= 1 ? 400 : 500 }}>
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={aspect}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            </div>

            <div className="px-4 py-2 flex items-center gap-3">
              <span className="text-xs text-muted-foreground">Zoom</span>
              <input
                type="range"
                min={1} max={3} step={0.05}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="flex-1 accent-primary"
              />
            </div>

            <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
              <Button variant="outline" size="sm" onClick={cancel}>Cancel</Button>
              <Button size="sm" onClick={handleUpload} disabled={uploading}>
                {uploading ? <><Loader2 size={14} className="animate-spin mr-1" /> Uploading...</> : "Upload"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}


async function waitForTask(taskId: string, timeout = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch(`/api/tasks/${taskId}`, { credentials: "include" });
      if (!res.ok) continue;
      const task = await res.json();
      if (task.status === "completed") return;
      if (task.status === "failed") throw new Error(task.error || "Task failed");
    } catch (e) {
      if (e instanceof Error && e.message === "Task failed") throw e;
      // network error — keep polling
    }
  }
  // Timeout is OK — task is probably still processing, but close the modal anyway
}


async function getCroppedBlob(imageSrc: string, crop: Area): Promise<Blob> {
  const img = await createImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = crop.width;
  canvas.height = crop.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Canvas toBlob failed"));
    }, "image/jpeg", 0.92);
  });
}

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
