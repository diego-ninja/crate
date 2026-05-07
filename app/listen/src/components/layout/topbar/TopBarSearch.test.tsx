import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
  getApiBase: vi.fn(() => ""),
  getAuthToken: vi.fn(() => null),
}));

import { api } from "@/lib/api";
import { TopBarSearch } from "@/components/layout/topbar/TopBarSearch";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

function mockHoverPointer(matches: boolean) {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
}

describe("TopBarSearch", () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("starts collapsed, expands from the search icon, and closes on escape", async () => {
    renderWithListenProviders(<TopBarSearch />);

    const searchButton = screen.getByRole("button", { name: "Search" });
    expect(searchButton.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(searchButton);

    await waitFor(() => {
      expect(searchButton.getAttribute("aria-expanded")).toBe("true");
    });

    const input = screen.getByPlaceholderText("Search artists, albums, tracks...");
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });

    fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() => {
      expect(searchButton.getAttribute("aria-expanded")).toBe("false");
    });
  });

  it("opens on hover and collapses again when idle", async () => {
    mockHoverPointer(true);
    renderWithListenProviders(<TopBarSearch />);

    const searchButton = screen.getByRole("button", { name: "Search" });
    fireEvent.mouseEnter(searchButton);

    await waitFor(() => {
      expect(searchButton.getAttribute("aria-expanded")).toBe("true");
    });

    fireEvent.mouseLeave(searchButton);

    await waitFor(() => {
      expect(searchButton.getAttribute("aria-expanded")).toBe("false");
    });
  });

  it("ignores hover on touch-only devices", async () => {
    mockHoverPointer(false);
    renderWithListenProviders(<TopBarSearch />);

    const searchButton = screen.getByRole("button", { name: "Search" });
    fireEvent.mouseEnter(searchButton);

    expect(searchButton.getAttribute("aria-expanded")).toBe("false");
  });

  it("stays open after click even if mouseleave fires before focus settles", async () => {
    renderWithListenProviders(<TopBarSearch />);

    const searchButton = screen.getByRole("button", { name: "Search" });
    const container = searchButton.parentElement?.parentElement;
    expect(container).not.toBeNull();

    fireEvent.click(searchButton);
    fireEvent.mouseLeave(container!);

    await waitFor(() => {
      expect(searchButton.getAttribute("aria-expanded")).toBe("true");
    });

    const input = screen.getByPlaceholderText("Search artists, albums, tracks...");
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
  });

  it("renders fetched results after typing a query", async () => {
    vi.useFakeTimers();
    vi.mocked(api).mockResolvedValue({
      artists: [{ id: 52, slug: "high-vis", name: "High Vis" }],
      albums: [],
      tracks: [],
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 320,
      bottom: 44,
      width: 320,
      height: 44,
      toJSON: () => ({}),
    });

    renderWithListenProviders(<TopBarSearch />);

    const input = screen.getByPlaceholderText("Search artists, albums, tracks...");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "high" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    vi.useRealTimers();

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith("/api/search?q=high&limit=10");
      expect(screen.getByText("High Vis")).toBeTruthy();
    });
  });
});
