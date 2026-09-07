import { useMemo, useState, type ChangeEvent } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  Music,
  Upload as UploadIcon,
  Archive,
  CheckCircle2,
} from "@crate/ui/icons";
import { toast } from "sonner";

import { ApiError, api } from "@/lib/api";

interface UploadResponse {
  task_id: string;
  upload_id: string;
  file_count: number;
  total_bytes: number;
}

interface ChunkedUploadInitResponse {
  upload_id: string;
  file_count: number;
  chunk_size: number;
}

interface UploadProgress {
  done: number;
  total: number;
}

interface UploadMusicFilesOptions {
  chunkedThresholdBytes?: number;
  onProgress?: (progress: UploadProgress) => void;
}

const CHUNKED_UPLOAD_THRESHOLD_BYTES = 80 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${
    units[unitIndex]
  }`;
}

function totalFileBytes(files: File[]): number {
  return files.reduce((sum, file) => sum + file.size, 0);
}

function directUpload(files: File[]): Promise<UploadResponse> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }
  return api<UploadResponse>("/api/acquisition/upload", "POST", formData);
}

async function chunkedUpload(
  files: File[],
  onProgress?: (progress: UploadProgress) => void,
): Promise<UploadResponse> {
  const init = await api<ChunkedUploadInitResponse>(
    "/api/acquisition/upload/chunked",
    "POST",
    {
      files: files.map((file) => ({
        name: file.name,
        size: file.size,
        type: file.type || null,
      })),
    },
  );

  const totalChunks = files.reduce(
    (sum, file) => sum + Math.max(1, Math.ceil(file.size / init.chunk_size)),
    0,
  );
  let done = 0;

  for (const [fileIndex, file] of files.entries()) {
    const chunkCount = Math.max(1, Math.ceil(file.size / init.chunk_size));
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      const start = chunkIndex * init.chunk_size;
      const end = Math.min(file.size, start + init.chunk_size);
      const formData = new FormData();
      formData.append("file_index", String(fileIndex));
      formData.append("chunk_index", String(chunkIndex));
      formData.append(
        "chunk",
        file.slice(start, end),
        `${file.name}.part-${chunkIndex}`,
      );

      // Chunks are sent in order so the server can commit a deterministic upload.
      // react-doctor-disable-next-line async-await-in-loop
      await api(
        `/api/acquisition/upload/chunked/${init.upload_id}/chunk`,
        "POST",
        formData,
      );
      done += 1;
      onProgress?.({ done, total: totalChunks });
    }
  }

  return api<UploadResponse>(
    `/api/acquisition/upload/chunked/${init.upload_id}/complete`,
    "POST",
  );
}

export function uploadMusicFiles(
  files: File[],
  options: UploadMusicFilesOptions = {},
): Promise<UploadResponse> {
  const threshold =
    options.chunkedThresholdBytes ?? CHUNKED_UPLOAD_THRESHOLD_BYTES;
  if (totalFileBytes(files) > threshold) {
    return chunkedUpload(files, options.onProgress);
  }
  return directUpload(files);
}

function uploadErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiError && error.status === 413) {
    return t("upload.errors.tooLarge");
  }
  if (error instanceof ApiError && error.message) {
    return t("upload.errors.queueWithMessage", { message: error.message });
  }
  return t("upload.errors.queue");
}

export function Upload() {
  const { t } = useTranslation();
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [lastUpload, setLastUpload] = useState<UploadResponse | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(
    null,
  );

  const totalBytes = useMemo(
    () => files.reduce((sum, file) => sum + file.size, 0),
    [files],
  );

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFiles(Array.from(event.target.files || []));
  }

  async function handleSubmit() {
    if (files.length === 0) return;

    setSubmitting(true);
    setUploadProgress(null);
    try {
      const response = await uploadMusicFiles(files, {
        onProgress: setUploadProgress,
      });
      setLastUpload(response);
      toast.success(t("upload.toasts.queued"));
      setFiles([]);
    } catch (error) {
      toast.error(uploadErrorMessage(error, t));
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-border-quiet bg-text-primary/[0.04] px-3 py-1 text-xs uppercase tracking-wider text-text-muted">
          <UploadIcon size={12} />
          {t("upload.badge")}
        </div>
        <h1 className="text-3xl font-bold text-text-primary">
          {t("upload.title")}
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-text-muted">
          {t("upload.subtitle")}
        </p>
      </div>

      <div className="rounded-[12px] border border-border-quiet bg-text-primary/[0.04] p-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-4">
            <label className="flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-text-primary/15 bg-text-primary/[0.03] px-6 py-10 text-center transition-colors hover:border-accent-action/40 hover:bg-text-primary/[0.05]">
              <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-accent-action/15 text-accent-action">
                <UploadIcon size={24} />
              </div>
              <div className="text-base font-semibold text-text-primary">
                {t("upload.dropzone.title")}
              </div>
              <div className="mt-2 text-sm text-text-muted">
                {t("upload.dropzone.formats")}
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
              <div className="space-y-2 border-t border-border-quiet bg-surface-canvas/50 pt-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-text-primary">
                      {t("upload.ready.title")}
                    </div>
                    <div className="text-xs text-text-muted">
                      {t("upload.selectedFiles", {
                        count: files.length,
                        size: formatBytes(totalBytes),
                      })}
                    </div>
                  </div>
                  <button
                    onClick={() => setFiles([])}
                    className="text-xs text-text-muted transition-colors hover:text-text-primary/70"
                  >
                    {t("common.clear")}
                  </button>
                </div>
                <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                  {files.map((file) => (
                    <div
                      key={`${file.name}-${file.size}-${file.lastModified}`}
                      className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-text-primary/75"
                    >
                      {file.name.toLowerCase().endsWith(".zip") ? (
                        <Archive
                          size={14}
                          className="shrink-0 text-accent-action"
                        />
                      ) : (
                        <Music
                          size={14}
                          className="shrink-0 text-accent-action"
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate">
                        {file.name}
                      </span>
                      <span className="text-xs text-text-primary/40">
                        {formatBytes(file.size)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-4 border-l border-border-quiet pl-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-text-muted">
              {t("upload.next.title")}
            </h2>
            <ul className="space-y-3 text-sm leading-6 text-text-muted">
              <li>{t("upload.next.import")}</li>
              <li>{t("upload.next.enrichment")}</li>
              <li>{t("upload.next.liked")}</li>
              <li>{t("upload.next.saved")}</li>
              <li>{t("upload.next.attributed")}</li>
            </ul>
            <button
              onClick={handleSubmit}
              disabled={submitting || files.length === 0}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-accent-action px-4 py-3 text-sm font-semibold text-accent-action-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <UploadIcon size={16} />
              )}
              {uploadProgress
                ? t("upload.progress", {
                    done: uploadProgress.done,
                    total: uploadProgress.total,
                  })
                : t("upload.import")}
            </button>
            {lastUpload ? (
              <div className="border-l-2 border-state-success/40 bg-state-success/10 px-4 py-3 text-sm text-state-success-text">
                <div className="flex items-center gap-2 font-medium">
                  <CheckCircle2 size={15} />
                  {t("upload.status.queued")}
                </div>
                <div className="mt-1 text-xs text-state-success-text/80">
                  {t("upload.status.processing", {
                    taskId: lastUpload.task_id,
                    count: lastUpload.file_count,
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
