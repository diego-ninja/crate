import { useMemo, useState, type ChangeEvent } from "react";
import { Loader2, Music, Upload as UploadIcon, Archive, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";

interface UploadResponse {
  task_id: string;
  upload_id: string;
  file_count: number;
  total_bytes: number;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function Upload() {
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [lastUpload, setLastUpload] = useState<UploadResponse | null>(null);

  const totalBytes = useMemo(
    () => files.reduce((sum, file) => sum + file.size, 0),
    [files],
  );

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFiles(Array.from(event.target.files || []));
  }

  async function handleSubmit() {
    if (files.length === 0) return;

    const formData = new FormData();
    for (const file of files) {
      formData.append("files", file);
    }

    setSubmitting(true);
    try {
      const response = await api<UploadResponse>("/api/acquisition/upload", "POST", formData);
      setLastUpload(response);
      toast.success("Upload queued. Crate is importing your music in the background.");
      setFiles([]);
    } catch {
      toast.error("Failed to queue upload");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] uppercase tracking-wider text-white/45">
          <UploadIcon size={12} />
          Upload music
        </div>
        <h1 className="text-3xl font-bold text-foreground">Add music to your library</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Upload individual tracks or zipped albums. Crate will import them into the shared library,
          run the usual enrichment pipeline, and add what you uploaded to your collection automatically.
        </p>
      </div>

      <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-4">
            <label className="flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-[24px] border border-dashed border-white/15 bg-white/[0.03] px-6 py-10 text-center transition-colors hover:border-primary/40 hover:bg-white/[0.05]">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 text-primary">
                <UploadIcon size={24} />
              </div>
              <div className="text-base font-semibold text-foreground">Drop files here or choose files</div>
              <div className="mt-2 text-sm text-muted-foreground">
                FLAC, MP3, AAC, WAV, OGG, OPUS, ALAC, or ZIP
              </div>
              <input
                type="file"
                multiple
                accept=".flac,.mp3,.m4a,.ogg,.opus,.wav,.aac,.alac,.zip,audio/*,.zip"
                className="hidden"
                onChange={handleFileChange}
              />
            </label>

            {files.length > 0 ? (
              <div className="space-y-2 rounded-2xl border border-white/10 bg-[var(--gradient-bg-50)] p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-foreground">Ready to import</div>
                    <div className="text-xs text-muted-foreground">
                      {files.length} file{files.length === 1 ? "" : "s"} · {formatBytes(totalBytes)}
                    </div>
                  </div>
                  <button
                    onClick={() => setFiles([])}
                    className="text-xs text-white/45 transition-colors hover:text-white/70"
                  >
                    Clear
                  </button>
                </div>
                <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                  {files.map((file) => (
                    <div
                      key={`${file.name}-${file.size}-${file.lastModified}`}
                      className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-white/75"
                    >
                      {file.name.toLowerCase().endsWith(".zip") ? (
                        <Archive size={14} className="shrink-0 text-primary" />
                      ) : (
                        <Music size={14} className="shrink-0 text-primary" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{file.name}</span>
                      <span className="text-[11px] text-white/35">{formatBytes(file.size)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-4 rounded-[24px] border border-white/10 bg-[var(--gradient-bg-50)] p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-white/45">What happens next</h2>
            <ul className="space-y-3 text-sm leading-6 text-muted-foreground">
              <li>Crate imports the files into the shared library.</li>
              <li>Library sync and enrichment run in the background.</li>
              <li>Uploaded tracks are liked for you automatically.</li>
              <li>Uploaded albums are saved and artists are followed.</li>
            </ul>
            <button
              onClick={handleSubmit}
              disabled={submitting || files.length === 0}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <UploadIcon size={16} />}
              Import to library
            </button>
            {lastUpload ? (
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                <div className="flex items-center gap-2 font-medium">
                  <CheckCircle2 size={15} />
                  Upload queued
                </div>
                <div className="mt-1 text-xs text-emerald-100/80">
                  Task `{lastUpload.task_id}` is processing {lastUpload.file_count} file
                  {lastUpload.file_count === 1 ? "" : "s"}.
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
