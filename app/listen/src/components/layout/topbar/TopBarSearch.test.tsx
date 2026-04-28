import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
}));

import { api } from "@/lib/api";
import { TopBarSearch } from "@/components/layout/topbar/TopBarSearch";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

describe("TopBarSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    localStorage.clear();
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
    vi.mocked(api).mockResolvedValue({
      artists: [{ id: 52, slug: "high-vis", name: "High Vis" }],
      albums: [],
      tracks: [],
    });

    renderWithListenProviders(<TopBarSearch />);

    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    const input = await screen.findByPlaceholderText("Search artists, albums, tracks...");
    fireEvent.change(input, { target: { value: "high" } });

    vi.advanceTimersByTime(250);

    await waitFor(() => {
      expect(screen.getByText("High Vis")).toBeTruthy();
    });
  });
});
