import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: vi.fn(),
    getApiBase: vi.fn(() => ""),
    getAuthToken: vi.fn(() => null),
  };
});

const navigateMock = vi.fn();
vi.mock("react-router", async () => {
  const actual =
    await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

import { api, ApiError } from "@/lib/api";
import { TopBarSearch } from "@/components/layout/topbar/TopBarSearch";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { TOP_BAR_SEARCH_RECENTS_STORAGE_KEY } from "./topbar-search-model";

function mockHoverPointer(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function mockSearchBoxRect() {
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
    const user = userEvent.setup();
    renderWithListenProviders(<TopBarSearch />);

    const searchButton = screen.getByRole("button", { name: "Search" });
    expect(searchButton.getAttribute("aria-expanded")).toBe("false");

    await user.click(searchButton);

    await waitFor(() => {
      expect(searchButton.getAttribute("aria-expanded")).toBe("true");
    });

    const input = screen.getByPlaceholderText(
      "Search artists, albums, tracks...",
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(searchButton.getAttribute("aria-expanded")).toBe("false");
    });
  });

  it("keeps the collapsed mobile search affordance visible", () => {
    renderWithListenProviders(<TopBarSearch />);

    const searchButton = screen.getByRole("button", { name: "Search" });

    expect(searchButton.getAttribute("aria-expanded")).toBe("false");
    expect(searchButton).toHaveTextContent("Search");
  });

  it("localizes the search affordance and input", async () => {
    const user = userEvent.setup();
    renderWithListenProviders(<TopBarSearch />, { locale: "es" });

    const searchButton = screen.getByRole("button", { name: "Buscar" });
    expect(searchButton).toHaveTextContent("Buscar");

    await user.click(searchButton);

    expect(
      screen.getByPlaceholderText("Buscar artistas, álbumes, pistas..."),
    ).toBeInTheDocument();
  });

  it("uses the shared glass surface for the mobile search shell", () => {
    mockHoverPointer(false);
    renderWithListenProviders(<TopBarSearch />);

    const searchButton = screen.getByRole("button", { name: "Search" });

    expect(searchButton.closest(".listen-glass-panel")).toBeInTheDocument();
  });

  it("keeps the desktop search shell on the non-glass main style", () => {
    mockHoverPointer(true);
    renderWithListenProviders(<TopBarSearch />);

    const searchButton = screen.getByRole("button", { name: "Search" });
    const searchShell = searchButton.parentElement?.parentElement;

    expect(searchShell).toBeInTheDocument();
    expect(searchShell).toHaveClass("bg-transparent", "border-0");
    expect(searchShell).not.toHaveClass(
      "listen-glass-panel",
      "listen-search-glass",
    );
  });

  it("keeps the collapsed desktop search trigger fully transparent", async () => {
    mockHoverPointer(true);
    renderWithListenProviders(<TopBarSearch />);

    const searchButton = screen.getByRole("button", { name: "Search" });
    const searchShell = searchButton.closest('div[data-state="closed"]');

    await waitFor(() => {
      expect(searchShell).toHaveClass(
        "border-0",
        "bg-transparent",
        "shadow-none",
        "backdrop-blur-0",
      );
      expect(searchButton).toHaveClass(
        "border-0",
        "bg-transparent",
        "shadow-none",
        "backdrop-blur-0",
      );
    });
  });

  it("opens on hover and collapses again when idle", async () => {
    const user = userEvent.setup();
    mockHoverPointer(true);
    renderWithListenProviders(<TopBarSearch />);

    const searchButton = screen.getByRole("button", { name: "Search" });
    await user.hover(searchButton);

    await waitFor(() => {
      expect(searchButton.getAttribute("aria-expanded")).toBe("true");
    });

    await user.unhover(searchButton);

    await waitFor(() => {
      expect(searchButton.getAttribute("aria-expanded")).toBe("false");
    });
  });

  it("ignores hover on touch-only devices", async () => {
    const user = userEvent.setup();
    mockHoverPointer(false);
    renderWithListenProviders(<TopBarSearch />);

    const searchButton = screen.getByRole("button", { name: "Search" });
    await user.hover(searchButton);

    expect(searchButton.getAttribute("aria-expanded")).toBe("false");
  });

  it("stays open after click even if mouseleave fires before focus settles", async () => {
    const user = userEvent.setup();
    renderWithListenProviders(<TopBarSearch />);

    const searchButton = screen.getByRole("button", { name: "Search" });
    const container = searchButton.parentElement?.parentElement;
    expect(container).not.toBeNull();

    await user.click(searchButton);
    await user.unhover(container!);

    await waitFor(() => {
      expect(searchButton.getAttribute("aria-expanded")).toBe("true");
    });

    const input = screen.getByPlaceholderText(
      "Search artists, albums, tracks...",
    );
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
    mockSearchBoxRect();

    renderWithListenProviders(<TopBarSearch />);

    const input = screen.getByPlaceholderText(
      "Search artists, albums, tracks...",
    );
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "high" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    vi.useRealTimers();

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith("/api/catalog/search?q=high&limit=10");
      expect(screen.getByText("High Vis")).toBeTruthy();
    });

    expect(screen.getByText("High Vis")).toHaveClass("text-text-primary/80");
    expect(screen.getByText("High Vis").closest(".z-app-dropdown")).toHaveClass(
      "listen-glass-panel",
      "rounded-[12px]",
    );
  });

  it("labels canonical results that are only available remotely", async () => {
    vi.useFakeTimers();
    vi.mocked(api).mockResolvedValue({
      artists: [
        {
          global_artist_uid: "artist-global-1",
          name: "High Vis",
          availability: {
            catalog: true,
            stream: true,
            import: false,
            local: false,
            remote: true,
          },
        },
      ],
      albums: [],
      tracks: [],
    });
    mockSearchBoxRect();

    renderWithListenProviders(<TopBarSearch />);

    const input = screen.getByPlaceholderText(
      "Search artists, albums, tracks...",
    );
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "high" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    vi.useRealTimers();

    expect(await screen.findByText("Remote")).toBeInTheDocument();
  });

  it("opens local albums through local human routes when search returns global uids", async () => {
    vi.useFakeTimers();
    vi.mocked(api).mockResolvedValue({
      artists: [],
      albums: [
        {
          id: 3,
          name: "Gris Klein",
          artist: "Birds In Row",
          global_album_uid: "785621b5-738e-5922-b6e3-108984976091",
          entity_uid: "904e7879-9549-5f49-81c0-59843a562968",
          has_cover: true,
        },
      ],
      tracks: [],
    });
    mockSearchBoxRect();

    renderWithListenProviders(<TopBarSearch />);

    const input = screen.getByPlaceholderText(
      "Search artists, albums, tracks...",
    );
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "gris" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    vi.useRealTimers();

    fireEvent.click(await screen.findByText("Gris Klein"));

    expect(navigateMock).toHaveBeenCalledWith(
      "/artists/birds-in-row/gris-klein",
    );
  });

  it("shows a clear empty state when a query returns no music", async () => {
    vi.useFakeTimers();
    vi.mocked(api).mockResolvedValue({
      artists: [],
      albums: [],
      tracks: [],
    });
    mockSearchBoxRect();

    renderWithListenProviders(<TopBarSearch />);

    const input = screen.getByPlaceholderText(
      "Search artists, albums, tracks...",
    );
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "zzzz" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    vi.useRealTimers();

    await waitFor(() => {
      expect(screen.getByText("No music found")).toBeInTheDocument();
    });
  });

  it("shows an error state instead of no results when search fails", async () => {
    vi.useFakeTimers();
    vi.mocked(api).mockRejectedValue(new ApiError(401, "Not authenticated"));
    mockSearchBoxRect();

    renderWithListenProviders(<TopBarSearch />);

    const input = screen.getByPlaceholderText(
      "Search artists, albums, tracks...",
    );
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "high" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    vi.useRealTimers();

    await waitFor(() => {
      expect(screen.getByText("Search unavailable")).toBeInTheDocument();
    });
    expect(screen.queryByText("No music found")).not.toBeInTheDocument();
  });

  it("does not show the empty state before the current query completes", async () => {
    vi.useFakeTimers();
    vi.mocked(api).mockReturnValue(new Promise(() => {}));
    mockSearchBoxRect();

    renderWithListenProviders(<TopBarSearch />);

    const input = screen.getByPlaceholderText(
      "Search artists, albums, tracks...",
    );
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "high" } });

    expect(screen.queryByText("No music found")).not.toBeInTheDocument();
  });

  it("clears the query from the clear search button", async () => {
    const user = userEvent.setup();
    vi.mocked(api).mockResolvedValue({
      artists: [],
      albums: [],
      tracks: [],
    });
    renderWithListenProviders(<TopBarSearch />);

    const searchButton = screen.getByRole("button", { name: "Search" });
    await user.click(searchButton);

    const input = screen.getByPlaceholderText(
      "Search artists, albums, tracks...",
    );
    await user.type(input, "converge");

    await user.click(
      await screen.findByRole("button", { name: "Clear search" }),
    );

    expect(input).toHaveValue("");
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
  });

  it("navigates directly when a recent entry has a destination", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      TOP_BAR_SEARCH_RECENTS_STORAGE_KEY,
      JSON.stringify([
        { label: "High Vis", type: "artist", navigateTo: "/artists/high-vis" },
      ]),
    );
    renderWithListenProviders(<TopBarSearch />);

    const searchButton = screen.getByRole("button", { name: "Search" });
    await user.click(searchButton);

    await user.click(await screen.findByText("High Vis"));

    expect(navigateMock).toHaveBeenCalledWith("/artists/high-vis");
  });

  it("keeps query search behaviour for legacy plain recent entries", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      TOP_BAR_SEARCH_RECENTS_STORAGE_KEY,
      JSON.stringify(["Converge"]),
    );
    renderWithListenProviders(<TopBarSearch />);

    const searchButton = screen.getByRole("button", { name: "Search" });
    await user.click(searchButton);

    await user.click(await screen.findByText("Converge"));

    const input = screen.getByPlaceholderText(
      "Search artists, albums, tracks...",
    );
    expect(input).toHaveValue("Converge");
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
