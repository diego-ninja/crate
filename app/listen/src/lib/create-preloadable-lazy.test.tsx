import { Suspense, type ComponentType } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createPreloadableLazy } from "@/lib/create-preloadable-lazy";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createPreloadableLazy", () => {
  it("shares a single loader promise between preload and render", async () => {
    const request = deferred<{ TestComponent: ComponentType<Record<string, never>> }>();
    const loader = vi.fn(() => request.promise);
    const { Component, preload } = createPreloadableLazy<Record<string, never>, { TestComponent: ComponentType<Record<string, never>> }>(
      loader,
      (module) => module.TestComponent,
    );

    const preloadPromise = preload();

    render(
      <Suspense fallback={<div>Loading…</div>}>
        <Component />
      </Suspense>,
    );

    expect(loader).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Loading…")).toBeTruthy();

    request.resolve({
      TestComponent: () => <div>Ready</div>,
    });

    await preloadPromise;
    await waitFor(() => {
      expect(screen.getByText("Ready")).toBeTruthy();
    });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("loads lazily on first render when preload was not called", async () => {
    const loader = vi.fn(async () => ({
      TestComponent: () => <div>Player surface</div>,
    }));
    const { Component } = createPreloadableLazy<Record<string, never>, { TestComponent: ComponentType<Record<string, never>> }>(
      loader,
      (module) => module.TestComponent,
    );

    render(
      <Suspense fallback={<div>Loading…</div>}>
        <Component />
      </Suspense>,
    );

    expect(loader).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByText("Player surface")).toBeTruthy();
    });
  });

  it("allows retry after a failed preload", async () => {
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error("chunk failed"))
      .mockResolvedValueOnce({
        TestComponent: () => <div>Recovered surface</div>,
      });
    const { Component, preload } = createPreloadableLazy<Record<string, never>, { TestComponent: ComponentType<Record<string, never>> }>(
      loader,
      (module) => module.TestComponent,
    );

    await expect(preload()).rejects.toThrow("chunk failed");

    render(
      <Suspense fallback={<div>Loading…</div>}>
        <Component />
      </Suspense>,
    );

    await waitFor(() => {
      expect(screen.getByText("Recovered surface")).toBeTruthy();
    });
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
