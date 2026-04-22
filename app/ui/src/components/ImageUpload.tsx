import { useRef, useState } from "react";
import { Button } from "@crate-ui/shadcn/button";
import { toast } from "sonner";
import { Upload, Loader2 } from "lucide-react";

interface ImageUploadProps {
  endpoint: string;
  label?: string;
  accept?: string;
  onUploaded?: () => void;
}

export function ImageUpload({ endpoint, label = "Upload Image", accept = "image/*", onUploaded }: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(endpoint, { method: "POST", body: form, credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Image uploaded");
      onUploaded?.();
    } catch (e) {
      toast.error(`Upload failed: ${e instanceof Error ? e.message : "Unknown"}`);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? <Loader2 size={14} className="animate-spin mr-1" /> : <Upload size={14} className="mr-1" />}
        {label}
      </Button>
    </>
  );
}
