import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiClient } from "../../../shared/web/api";

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
  };
}

describe("createApiClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dedupes identical non-abortable GET requests", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => jsonResponse({ ok: true }) as Response);

    const api = createApiClient();
    const [first, second] = await Promise.all([api("/api/ping"), api("/api/ping")]);

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("dedupes identical abortable GET requests without letting one abort cancel the shared fetch", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      const signal = init?.signal;
      return new Promise((resolve, reject) => {
        const finish = () => resolve(jsonResponse({ ok: true }) as Response);
        if (signal) {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("The request was aborted", "AbortError")),
            { once: true },
          );
        }
        setTimeout(finish, 0);
      });
    });

    const api = createApiClient();

    const firstController = new AbortController();
    const firstPromise = api("/api/artists/42", "GET", undefined, {
      signal: firstController.signal,
    });
    firstController.abort();

    const secondController = new AbortController();
    const secondPromise = api("/api/artists/42", "GET", undefined, {
      signal: secondController.signal,
    });

    await expect(firstPromise).rejects.toMatchObject({ name: "AbortError" });
    await expect(secondPromise).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not start a GET when its abort signal is already aborted", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => jsonResponse({ ok: true }) as Response);

    const api = createApiClient();
    const controller = new AbortController();
    controller.abort();

    await expect(
      api("/api/artists/99", "GET", undefined, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
