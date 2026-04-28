import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
}));

import { TopBarSearch } from "@/components/layout/topbar/TopBarSearch";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

describe("TopBarSearch", () => {
  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
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
});
