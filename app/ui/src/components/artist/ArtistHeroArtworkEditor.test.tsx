import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ArtistHeroArtworkEditor } from "./ArtistHeroArtworkEditor";
import type { HeroRecipe } from "./hero-composition-geometry";
import { waitForTask } from "@/lib/tasks";

vi.mock("./HeroCompositionCanvas", async () => {
  const { ArtistHeroFrame } = await import("@crate/ui/domain/ArtistHeroFrame");

  return {
    HeroCompositionCanvas: ({
      artistName,
      composition,
      sourceUrl,
      previewUrl,
      recipe,
      editable,
      previewOnly,
      onRecipeChange,
      children,
    }: {
      artistName: string;
      composition: "desktop" | "mobile";
      sourceUrl: string | null;
      previewUrl?: string;
      recipe: HeroRecipe;
      editable: boolean;
      previewOnly?: boolean;
      onRecipeChange: (nextRecipe: HeroRecipe) => void;
      children?: React.ReactNode;
    }) => (
      <div
        data-testid="hero-composition-canvas"
        data-preview-only={previewOnly ? "true" : "false"}
      >
        <ArtistHeroFrame
          composition={composition}
          contentClassName="pointer-events-none"
          artwork={
            <>
              <output data-testid="canvas-source-url">{sourceUrl}</output>
              <output data-testid="canvas-recipe-mode">{recipe.mode}</output>
              <output data-testid="canvas-recipe-scale">{recipe.scale}</output>
              <output data-testid="canvas-recipe-position">
                {recipe.position_x},{recipe.position_y}
              </output>
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt={`${artistName} ${composition} hero`}
                />
              ) : null}
            </>
          }
        >
          {children}
        </ArtistHeroFrame>
        <button
          type="button"
          aria-label="Crop"
          aria-pressed={recipe.mode === "crop"}
          disabled={!editable}
          onClick={() => onRecipeChange({ ...recipe, mode: "crop" })}
        >
          Crop
        </button>
        <button
          type="button"
          aria-label="Fill"
          aria-pressed={recipe.mode === "extend"}
          disabled={!editable}
          onClick={() => onRecipeChange({ ...recipe, mode: "extend" })}
        >
          Fill
        </button>
        {["Zoom out", "Zoom in", "Flip", "Reset"].map((label) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            disabled={!editable}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          aria-label="Simulate adjusted framing"
          disabled={!editable}
          onClick={() =>
            onRecipeChange({
              ...recipe,
              mode: "extend",
              scale: 1.37,
              position_x: 0.21,
              position_y: 0.77,
            })
          }
        >
          Simulate adjusted framing
        </button>
      </div>
    ),
  };
});

vi.mock("@/lib/tasks", () => ({
  waitForTask: vi.fn(async () => ({ status: "completed" })),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

function recipe(mode: "crop" | "extend"): HeroRecipe {
  return {
    mode,
    crop: { x: 0, y: 0, width: 1600, height: 1000 },
    position_x: 0.5,
    position_y: 0.5,
    scale: 1,
    flip_horizontal: false,
    rotation: 0,
    blur: 32,
    feather: 28,
    gradient: 0.45,
    grayscale: false,
    brightness: 1,
    contrast: 1,
  };
}

function derivedProfile() {
  return {
    artist_id: 7,
    provenance: "derived_background",
    review_status: "unreviewed",
    source_width: 2400,
    source_height: 1200,
    desktop_recipe: recipe("extend"),
    mobile_recipe: recipe("crop"),
    revision: "rev-1",
    updated_at: "2026-08-01T09:00:00Z",
  };
}

function manualProfile() {
  return {
    ...derivedProfile(),
    provenance: "manual" as const,
    review_status: "approved" as const,
  };
}

function adjustedProfile() {
  return {
    ...manualProfile(),
    revision: "rev-2",
    desktop_recipe: {
      ...recipe("extend"),
      scale: 1.37,
      position_x: 0.21,
      position_y: 0.77,
    },
  };
}

function featuredReadyProfile() {
  return {
    ...manualProfile(),
    is_featured: false,
    featured_devices: ["desktop"],
  };
}

describe("ArtistHeroArtworkEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uploads one source with independent framing and shared image treatment", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, init });
        if (!init?.method) return new Response("not found", { status: 404 });
        return Response.json({ status: "queued", task_id: "hero-task-1" });
      }),
    );
    const onUploaded = vi.fn();
    const user = userEvent.setup();

    render(
      <ArtistHeroArtworkEditor
        artistId={7}
        artistName="Converge"
        canEdit
        onUploaded={onUploaded}
      />,
    );

    await waitFor(() => expect(requests[0]?.init?.cache).toBe("no-store"));

    await user.upload(
      screen.getByLabelText("Source image"),
      new File(["image"], "converge.jpg", { type: "image/jpeg" }),
    );
    await user.click(screen.getByRole("button", { name: "Fill" }));
    await user.click(screen.getByRole("switch", { name: "Grayscale" }));
    fireEvent.change(screen.getByRole("slider", { name: "Brightness" }), {
      target: { value: "0.8" },
    });
    fireEvent.change(screen.getByRole("slider", { name: "Contrast" }), {
      target: { value: "1.2" },
    });
    await user.click(
      screen.getByRole("button", { name: "Generate hero artwork" }),
    );

    await waitFor(() => expect(onUploaded).toHaveBeenCalled());
    const upload = requests.find((request) => request.init?.method === "POST");
    expect(upload?.url).toBe("/api/artwork/artists/7/upload-hero");
    const form = upload?.init?.body as FormData;
    const desktopRecipe = JSON.parse(String(form.get("desktop_recipe")));
    const mobileRecipe = JSON.parse(String(form.get("mobile_recipe")));
    expect(desktopRecipe.mode).toBe("extend");
    expect(mobileRecipe.mode).toBe("crop");
    expect(desktopRecipe).toMatchObject({
      grayscale: true,
      brightness: 0.8,
      contrast: 1.2,
    });
    expect(mobileRecipe).toMatchObject({
      grayscale: true,
      brightness: 0.8,
      contrast: 1.2,
    });
    expect(form.get("file")).toBeInstanceOf(File);
    expect(form.get("composition")).toBe("desktop");
  });

  it("recomposes a persisted source without requiring another upload", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, init });
        if (init?.method === "POST") {
          return Response.json({ status: "queued", task_id: "hero-task-2" });
        }
        return Response.json(manualProfile());
      }),
    );

    render(
      <ArtistHeroArtworkEditor
        artistId={7}
        artistName="Converge"
        genres={["hardcore", "mathcore"]}
        canEdit
      />,
    );

    const generate = await screen.findByRole("button", {
      name: "Generate hero artwork",
    });
    expect(generate).toBeEnabled();
    await userEvent.click(generate);

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.url === "/api/artwork/artists/7/compose-hero" &&
            request.init?.method === "POST",
        ),
      ).toBe(true),
    );
    const compose = requests.find(
      (request) => request.url === "/api/artwork/artists/7/compose-hero",
    );
    expect(JSON.parse(String(compose?.init?.body))).toEqual({
      desktop_recipe: recipe("extend"),
      mobile_recipe: recipe("crop"),
      composition: "desktop",
    });
  });

  it("uses the background fallback as an editable source", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/hero-profile")) {
          return new Response("not found", { status: 404 });
        }
        if (url.includes("/background")) {
          return new Response("background", {
            headers: { "Content-Type": "image/jpeg" },
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    render(
      <ArtistHeroArtworkEditor artistId={7} artistName="Converge" canEdit />,
    );

    expect(await screen.findByText("Background fallback")).toBeInTheDocument();
    expect(screen.getByTestId("canvas-source-url")).toHaveTextContent(
      "/api/artists/7/background?size=1280",
    );
    expect(
      screen.getByRole("button", { name: "Preview result" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Generate hero artwork" }),
    ).toBeEnabled();
  });

  it("sends the background fallback file when previewing a new hero", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.mocked(waitForTask).mockResolvedValue({
      status: "completed",
      result: {
        preview_url: "/api/artwork/artists/7/hero-preview/fallback-preview",
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, init });
        if (url.endsWith("/hero-profile")) {
          return new Response("not found", { status: 404 });
        }
        if (url.includes("/background")) {
          return new Response("background", {
            headers: { "Content-Type": "image/jpeg" },
          });
        }
        if (init?.method === "POST") {
          return Response.json({
            status: "queued",
            task_id: "preview-fallback",
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    render(
      <ArtistHeroArtworkEditor artistId={7} artistName="Converge" canEdit />,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Preview result" }),
    );

    const previewRequest = await waitFor(() => {
      const request = requests.find((item) =>
        item.url.endsWith("/preview-hero"),
      );
      expect(request).toBeDefined();
      return request;
    });
    const form = previewRequest?.init?.body as FormData;
    expect(form.get("file")).toBeInstanceOf(File);
    expect(form.get("composition")).toBe("desktop");
  });

  it("sends the adjusted framing when generating an uploaded source", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, init });
        if (init?.method === "POST") {
          return Response.json({ status: "queued", task_id: "hero-task-3" });
        }
        return Response.json(manualProfile());
      }),
    );
    const user = userEvent.setup();

    render(
      <ArtistHeroArtworkEditor
        artistId={7}
        artistName="Birds in Row"
        canEdit
      />,
    );

    await user.upload(
      screen.getByLabelText("Source image"),
      new File(["image"], "birds-in-row.jpg", { type: "image/jpeg" }),
    );
    await user.click(screen.getByRole("button", { name: "Fill" }));
    await user.click(
      screen.getByRole("button", { name: "Simulate adjusted framing" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Generate hero artwork" }),
    );

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.url === "/api/artwork/artists/7/upload-hero" &&
            request.init?.method === "POST",
        ),
      ).toBe(true),
    );
    const upload = requests.find(
      (request) => request.url === "/api/artwork/artists/7/upload-hero",
    );
    const form = upload?.init?.body as FormData;
    expect(JSON.parse(String(form.get("desktop_recipe")))).toMatchObject({
      mode: "extend",
      scale: 1.37,
      position_x: 0.21,
      position_y: 0.77,
    });
  });

  it("keeps the submitted framing when the post-generation profile is stale", async () => {
    let profileReads = 0;
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, init });
        if (init?.method === "POST") {
          return Response.json({
            status: "queued",
            task_id: "hero-task-stale",
          });
        }
        profileReads += 1;
        return Response.json({
          ...manualProfile(),
          revision: profileReads === 1 ? "rev-before" : "rev-after",
        });
      }),
    );
    const user = userEvent.setup();

    render(
      <ArtistHeroArtworkEditor artistId={7} artistName="Crossed" canEdit />,
    );

    await user.upload(
      screen.getByLabelText("Source image"),
      new File(["image"], "crossed.jpg", { type: "image/jpeg" }),
    );
    await user.click(screen.getByRole("button", { name: "Fill" }));
    await user.click(
      screen.getByRole("button", { name: "Simulate adjusted framing" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Generate hero artwork" }),
    );

    await waitFor(() => expect(profileReads).toBe(2));
    expect(screen.getByTestId("canvas-recipe-scale")).toHaveTextContent("1.37");
    expect(screen.getByTestId("canvas-recipe-position")).toHaveTextContent(
      "0.21,0.77",
    );
  });

  it("does not let an older profile response reset framing after generation", async () => {
    let releaseInitialProfile!: (response: Response) => void;
    const initialProfile = new Promise<Response>((resolve) => {
      releaseInitialProfile = resolve;
    });
    let profileReads = 0;
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, init });
        if (init?.method === "POST") {
          return Response.json({ status: "queued", task_id: "hero-task-race" });
        }
        profileReads += 1;
        return profileReads === 1
          ? initialProfile
          : Response.json(adjustedProfile());
      }),
    );
    const user = userEvent.setup();

    render(
      <ArtistHeroArtworkEditor artistId={7} artistName="Crossed" canEdit />,
    );

    await user.upload(
      screen.getByLabelText("Source image"),
      new File(["image"], "crossed.jpg", { type: "image/jpeg" }),
    );
    await user.click(screen.getByRole("button", { name: "Fill" }));
    await user.click(
      screen.getByRole("button", { name: "Simulate adjusted framing" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Generate hero artwork" }),
    );

    await waitFor(() => expect(profileReads).toBe(2));
    await waitFor(() =>
      expect(screen.getByTestId("canvas-recipe-scale")).toHaveTextContent(
        "1.37",
      ),
    );
    expect(screen.getByTestId("canvas-recipe-position")).toHaveTextContent(
      "0.21,0.77",
    );

    releaseInitialProfile(Response.json(manualProfile()));

    await waitFor(() =>
      expect(screen.getByTestId("canvas-recipe-scale")).toHaveTextContent(
        "1.37",
      ),
    );
    expect(screen.getByTestId("canvas-recipe-position")).toHaveTextContent(
      "0.21,0.77",
    );
  });

  it("uses visual framing controls plus explicit image treatment controls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 })),
    );

    const { container } = render(
      <ArtistHeroArtworkEditor artistId={7} artistName="Converge" canEdit />,
    );

    expect(screen.getByRole("button", { name: "Crop" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fill" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Zoom out" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Flip" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Grayscale" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByRole("slider", { name: "Brightness" })).toHaveValue("1");
    expect(screen.getByRole("slider", { name: "Contrast" })).toHaveValue("1");
    expect(container.querySelectorAll('input[type="range"]')).toHaveLength(2);
  });

  it("keeps switch thumbs anchored inside the track in both states", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ...manualProfile(),
          is_featured: true,
          featured_devices: ["desktop", "mobile"],
        }),
      ),
    );

    const user = userEvent.setup();
    render(
      <ArtistHeroArtworkEditor artistId={7} artistName="Converge" canEdit />,
    );

    const featured = await screen.findByRole("switch", {
      name: "Featured artist",
    });
    expect(featured.querySelector("span")).toHaveClass(
      "left-0.5",
      "translate-x-5",
    );

    const grayscale = screen.getByRole("switch", { name: "Grayscale" });
    expect(grayscale.querySelector("span")).toHaveClass(
      "left-0.5",
      "translate-x-0",
    );

    await user.click(grayscale);

    expect(grayscale.querySelector("span")).toHaveClass(
      "left-0.5",
      "translate-x-5",
    );
  });

  it("shows the final artist presentation inside the editable canvas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(derivedProfile())),
    );

    render(
      <ArtistHeroArtworkEditor
        artistId={7}
        artistName="Converge"
        genres={["hardcore", "mathcore"]}
        canEdit
      />,
    );

    const livePreview = await screen.findByTestId(
      "desktop-hero-live-presentation",
    );
    expect(livePreview).toHaveClass("pointer-events-none");
    expect(within(livePreview).getByText("Good afternoon")).toBeVisible();
    expect(
      within(livePreview).getByTestId("hero-result-artist-name"),
    ).toHaveTextContent("Converge");
    expect(within(livePreview).getByText("hardcore")).toBeVisible();
    expect(within(livePreview).getByText("mathcore")).toBeVisible();
    expect(within(livePreview).getByText("Play artist")).toBeVisible();
  });

  it("shows persisted provenance and review state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(derivedProfile())),
    );

    render(
      <ArtistHeroArtworkEditor
        artistId={7}
        artistName="Converge"
        canEdit={false}
      />,
    );

    expect(
      await screen.findByText("Derived from background"),
    ).toBeInTheDocument();
    expect(screen.getByText("Unreviewed")).toBeInTheDocument();
    expect(screen.queryByLabelText("Source image")).toBeNull();
  });

  it("restores the persisted recipes without recomposing the rendered preview", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(derivedProfile())),
    );

    render(
      <ArtistHeroArtworkEditor artistId={7} artistName="Converge" canEdit />,
    );

    expect(
      await screen.findByRole("button", { name: "Refresh from background" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /desktop/i })).toHaveTextContent(
      "1480 × 600",
    );
    expect(screen.getByRole("button", { name: "Fill" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByAltText("Converge desktop hero")).toBeInTheDocument();
    expect(screen.getByTestId("canvas-source-url")).toHaveTextContent(
      "/api/artwork/artists/7/hero-source?composition=desktop&v=rev-1",
    );
    expect(
      screen.queryByAltText("Converge desktop composition preview"),
    ).toBeNull();
  });

  it("loads and uploads independent sources for desktop and mobile", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, init });
        if (init?.method === "POST") {
          return Response.json({ status: "queued", task_id: "hero-mobile" });
        }
        return Response.json(manualProfile());
      }),
    );

    render(
      <ArtistHeroArtworkEditor artistId={7} artistName="Converge" canEdit />,
    );

    await userEvent.click(await screen.findByRole("tab", { name: /mobile/i }));
    expect(screen.getByTestId("canvas-source-url")).toHaveTextContent(
      "/api/artwork/artists/7/hero-source?composition=mobile&v=rev-1",
    );
    await userEvent.upload(
      screen.getByLabelText("Source image"),
      new File(["mobile"], "mobile.jpg", { type: "image/jpeg" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Generate hero artwork" }),
    );

    const upload = await waitFor(() => {
      const request = requests.find(
        (item) =>
          item.url.endsWith("/upload-hero") && item.init?.method === "POST",
      );
      expect(request).toBeDefined();
      return request;
    });
    expect((upload?.init?.body as FormData).get("composition")).toBe("mobile");
  });

  it("persists deletion of the active hero composition", async () => {
    let profileReads = 0;
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, init });
        if (init?.method === "DELETE") {
          return Response.json({ status: "queued", task_id: "delete-hero" });
        }
        if (url.endsWith("/hero-profile")) {
          profileReads += 1;
          return Response.json({
            ...manualProfile(),
            desktop_enabled: profileReads === 1,
            mobile_enabled: true,
          });
        }
        return Response.json({ status: "queued", task_id: "unexpected" });
      }),
    );
    const user = userEvent.setup();

    render(
      <ArtistHeroArtworkEditor artistId={7} artistName="Converge" canEdit />,
    );

    await user.click(
      await screen.findByRole("button", {
        name: "Delete desktop composition",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Delete composition" }),
    );

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.url === "/api/artwork/artists/7/hero-profile/desktop" &&
            request.init?.method === "DELETE",
        ),
      ).toBe(true),
    );
    expect(vi.mocked(waitForTask)).toHaveBeenCalledWith("delete-hero", 120_000);
    await waitFor(() => expect(profileReads).toBe(2));
    expect(
      screen.queryByRole("button", { name: "Delete desktop composition" }),
    ).not.toBeInTheDocument();
  });

  it("allows a derived composition to be approved", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(input), init });
        if (init?.method === "PATCH") {
          return Response.json({ status: "approved" });
        }
        return Response.json(derivedProfile());
      }),
    );

    render(
      <ArtistHeroArtworkEditor artistId={7} artistName="Converge" canEdit />,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Approve" }),
    );

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.init?.method === "PATCH" &&
            request.init.body === JSON.stringify({ review_status: "approved" }),
        ),
      ).toBe(true),
    );
  });

  it("exposes Featured Artist state and updates it from the editor", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, init });
        if (init?.method === "PATCH" && url.endsWith("/featured")) {
          return Response.json({
            artist_id: 7,
            is_featured: true,
            featured_devices: ["desktop"],
            featured_eligible: true,
          });
        }
        return Response.json(featuredReadyProfile());
      }),
    );

    render(
      <ArtistHeroArtworkEditor artistId={7} artistName="Converge" canEdit />,
    );

    expect(await screen.findByText("Desktop ready")).toBeInTheDocument();
    expect(screen.getByText("Mobile not ready")).toBeInTheDocument();
    const toggle = screen.getByRole("switch", { name: "Featured artist" });
    expect(toggle).toBeEnabled();

    await userEvent.click(toggle);

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.url === "/api/artists/7/featured" &&
            request.init?.method === "PATCH" &&
            request.init.body === JSON.stringify({ is_featured: true }),
        ),
      ).toBe(true),
    );
  });

  it("disables Featured Artist until a composition is ready", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(derivedProfile())),
    );

    render(
      <ArtistHeroArtworkEditor artistId={7} artistName="Converge" canEdit />,
    );

    expect(
      await screen.findByRole("switch", { name: "Featured artist" }),
    ).toBeDisabled();
  });

  it("renders a clean preview through the canonical backend renderer", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.mocked(waitForTask).mockResolvedValue({
      status: "completed",
      result: {
        preview_url: "/api/artwork/artists/7/hero-preview/clean-preview",
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(input), init });
        if (init?.method === "POST") {
          return Response.json({
            status: "queued",
            task_id: "clean-preview-task",
          });
        }
        return Response.json(derivedProfile());
      }),
    );

    render(
      <ArtistHeroArtworkEditor artistId={7} artistName="Converge" canEdit />,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Preview result" }),
    );

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByTestId("desktop-artist-hero-frame"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("heading", { name: "Preview hero artwork" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByTestId("hero-composition-canvas"),
    ).toHaveAttribute("data-preview-only", "true");
    expect(within(dialog).getByTestId("canvas-recipe-mode")).toHaveTextContent(
      "extend",
    );
    expect(
      within(dialog).getByTestId("desktop-hero-left-edge-scrim"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByTestId("desktop-hero-right-scrim"),
    ).toBeInTheDocument();
    expect(within(dialog).getByTestId("desktop-hero-bottom-scrim")).toHaveClass(
      "bottom-0",
      "h-[58%]",
    );
    expect(within(dialog).getByTestId("desktop-hero-artwork-mask")).toHaveStyle(
      {
        maskImage: "none",
      },
    );
    expect(
      within(dialog).getByTestId("hero-result-artist-name"),
    ).toHaveTextContent("Converge");

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.url === "/api/artwork/artists/7/preview-hero" &&
            request.init?.method === "POST",
        ),
      ).toBe(true),
    );
    expect(within(dialog).getByRole("img")).toHaveAttribute(
      "src",
      "/api/artwork/artists/7/hero-preview/clean-preview",
    );

    await userEvent.click(
      within(dialog).getByRole("tab", {
        name: "Preview mobile composition",
      }),
    );

    expect(
      within(dialog).getByTestId("mobile-hero-result-preview"),
    ).toHaveClass("max-w-[440px]");
    expect(within(dialog).getByTestId("mobile-hero-scrim")).toHaveClass(
      "bottom-0",
      "h-[82%]",
    );
    expect(within(dialog).queryByTestId("mobile-hero-side-scrim")).toBeNull();
    expect(
      within(dialog).queryByTestId("desktop-hero-left-edge-scrim"),
    ).toBeNull();
    expect(within(dialog).queryByTestId("desktop-hero-right-scrim")).toBeNull();
    expect(within(dialog).getByTestId("mobile-hero-artwork-mask")).toHaveStyle({
      maskImage: "none",
    });
    expect(
      within(dialog).queryByTestId("mobile-hero-edge-scrim"),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByTestId("canvas-recipe-mode")).toHaveTextContent(
      "crop",
    );
  });

  it("renders a changed draft with the canonical backend preview", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    vi.mocked(waitForTask).mockResolvedValue({
      status: "completed",
      result: {
        preview_url: "/api/artwork/artists/7/hero-preview/preview-1",
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(input), init });
        if (init?.method === "POST") {
          return Response.json({ status: "queued", task_id: "preview-task" });
        }
        return Response.json(manualProfile());
      }),
    );
    const user = userEvent.setup();

    render(
      <ArtistHeroArtworkEditor artistId={7} artistName="Converge" canEdit />,
    );

    await user.click(
      await screen.findByRole("button", { name: "Simulate adjusted framing" }),
    );
    await user.click(screen.getByRole("button", { name: "Preview result" }));

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.url === "/api/artwork/artists/7/preview-hero" &&
            request.init?.method === "POST",
        ),
      ).toBe(true),
    );
    const previewRequest = requests.find(
      (request) => request.url === "/api/artwork/artists/7/preview-hero",
    );
    const form = previewRequest?.init?.body as FormData;
    expect(form.get("composition")).toBe("desktop");
    expect(JSON.parse(String(form.get("recipe")))).toMatchObject({
      scale: 1.37,
      position_x: 0.21,
      position_y: 0.77,
    });
    expect(within(screen.getByRole("dialog")).getByRole("img")).toHaveAttribute(
      "src",
      "/api/artwork/artists/7/hero-preview/preview-1",
    );
  });

  it("does not publish a preview that finishes after its recipe became stale", async () => {
    let resolvePreview!: (result: {
      status: "completed";
      result: { preview_url: string };
    }) => void;
    vi.mocked(waitForTask).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve;
        }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "POST") {
          return Response.json({ status: "queued", task_id: "stale-preview" });
        }
        return Response.json(manualProfile());
      }),
    );
    const user = userEvent.setup();

    render(
      <ArtistHeroArtworkEditor artistId={7} artistName="Converge" canEdit />,
    );

    await user.click(
      await screen.findByRole("button", { name: "Preview result" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Simulate adjusted framing" }),
    );

    resolvePreview({
      status: "completed",
      result: {
        preview_url: "/api/artwork/artists/7/hero-preview/stale-preview",
      },
    });

    await waitFor(() => {
      expect(
        within(screen.getByRole("dialog")).getByRole("img"),
      ).not.toHaveAttribute(
        "src",
        "/api/artwork/artists/7/hero-preview/stale-preview",
      );
    });
  });
});
