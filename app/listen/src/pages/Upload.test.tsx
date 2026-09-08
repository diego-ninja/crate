import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
    success: vi.fn(),
  },
}));

import { ApiError, api } from "@/lib/api";
import { Upload, uploadMusicFiles } from "@/pages/Upload";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
  api: vi.fn(),
}));

describe("uploadMusicFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the existing multipart upload for small batches", async () => {
    vi.mocked(api).mockResolvedValueOnce({
      task_id: "task-1",
      upload_id: "upload-1",
      file_count: 1,
      total_bytes: 3,
    });

    const response = await uploadMusicFiles(
      [new File(["abc"], "track.mp3", { type: "audio/mpeg" })],
      { chunkedThresholdBytes: 10 },
    );

    expect(response.task_id).toBe("task-1");
    expect(api).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledWith(
      "/api/acquisition/upload",
      "POST",
      expect.any(FormData),
    );
  });

  it("splits large batches into chunked upload requests", async () => {
    vi.mocked(api)
      .mockResolvedValueOnce({
        upload_id: "abc123abc123",
        file_count: 1,
        chunk_size: 4,
      })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        task_id: "task-chunked",
        upload_id: "abc123abc123",
        file_count: 1,
        total_bytes: 7,
      });
    const onProgress = vi.fn();

    const response = await uploadMusicFiles(
      [new File(["abcdefg"], "album.zip", { type: "application/zip" })],
      { chunkedThresholdBytes: 4, onProgress },
    );

    expect(response.task_id).toBe("task-chunked");
    expect(api).toHaveBeenNthCalledWith(
      1,
      "/api/acquisition/upload/chunked",
      "POST",
      {
        files: [{ name: "album.zip", size: 7, type: "application/zip" }],
      },
    );

    const firstChunk = vi.mocked(api).mock.calls[1]?.[2] as FormData;
    expect(firstChunk.get("file_index")).toBe("0");
    expect(firstChunk.get("chunk_index")).toBe("0");

    const secondChunk = vi.mocked(api).mock.calls[2]?.[2] as FormData;
    expect(secondChunk.get("file_index")).toBe("0");
    expect(secondChunk.get("chunk_index")).toBe("1");

    expect(api).toHaveBeenNthCalledWith(
      4,
      "/api/acquisition/upload/chunked/abc123abc123/complete",
      "POST",
    );
    expect(onProgress).toHaveBeenLastCalledWith({ done: 2, total: 2 });
  });
});

describe("Upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("localizes the upload page chrome", () => {
    renderWithListenProviders(<Upload />, { locale: "es" });

    expect(screen.getByText("Subir música")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Añade música a tu biblioteca" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Arrastra archivos aquí o elige archivos"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Importar a la biblioteca" }),
    ).toBeInTheDocument();
  });

  it("localizes upload queue errors", async () => {
    vi.mocked(api).mockRejectedValueOnce(new ApiError(413, "Too large"));
    const { container } = renderWithListenProviders(<Upload />, {
      locale: "es",
    });

    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("Upload input missing");
    }

    fireEvent.change(input, {
      target: {
        files: [new File(["abc"], "album.zip", { type: "application/zip" })],
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Importar a la biblioteca" }),
    );

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "La subida es demasiado grande para una sola petición. Inténtalo de nuevo para que Crate pueda dividirla en fragmentos.",
      );
    });
  });

  it("uses the semantic canvas token for the pending upload queue", () => {
    const { container } = renderWithListenProviders(<Upload />, {
      locale: "es",
    });

    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("Upload input missing");
    }

    fireEvent.change(input, {
      target: {
        files: [new File(["abc"], "album.zip", { type: "application/zip" })],
      },
    });

    expect(container.innerHTML).toContain("bg-surface-canvas/50");
    expect(container.innerHTML).not.toContain("gradient-bg-50");
  });
});
