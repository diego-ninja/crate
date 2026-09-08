import { forwardRef, useImperativeHandle, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HeroCompositionCanvas } from "./HeroCompositionCanvas";
import type { HeroRecipe } from "./hero-composition-geometry";

const transformerForceUpdate = vi.hoisted(() => vi.fn());

vi.mock("react-konva", () => ({
  Stage: ({
    children,
    onWheel,
  }: React.PropsWithChildren<{
    onWheel?: (event: { evt: WheelEvent }) => void;
  }>) => (
    <div
      data-testid="konva-stage"
      onWheel={(event) => onWheel?.({ evt: event.nativeEvent })}
    >
      {children}
    </div>
  ),
  Layer: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Image: forwardRef(function MockKonvaImage(
    props: Record<string, unknown>,
    ref: React.ForwardedRef<unknown>,
  ) {
    useImperativeHandle(ref, () => ({
      cache: vi.fn(),
      clearCache: vi.fn(),
      getLayer: () => ({ batchDraw: vi.fn() }),
    }));
    const name = typeof props.name === "string" ? props.name : "image";
    const filters = Array.isArray(props.filters) ? props.filters : [];
    return (
      <div
        data-testid={`konva-image-${name}`}
        data-has-filters={filters.length > 0 ? "true" : "false"}
        data-brightness={String(props.brightness ?? "")}
        data-contrast={String(props.contrast ?? "")}
        data-filter-count={String(filters.length)}
        data-x={String(props.x ?? "")}
        data-y={String(props.y ?? "")}
        data-width={String(props.width ?? "")}
        data-height={String(props.height ?? "")}
      />
    );
  }),
  Rect: ({
    name,
    fillLinearGradientColorStops,
  }: {
    name?: string;
    fillLinearGradientColorStops?: Array<number | string>;
  }) => (
    <div
      data-testid={`konva-gradient-${name ?? "background"}`}
      data-gradient-name={name ?? ""}
      data-color-stops={JSON.stringify(fillLinearGradientColorStops ?? [])}
    />
  ),
  Transformer: forwardRef(function MockTransformer(
    _props: Record<string, unknown>,
    ref: React.ForwardedRef<unknown>,
  ) {
    useImperativeHandle(ref, () => ({
      nodes: vi.fn(),
      forceUpdate: transformerForceUpdate,
      getLayer: () => ({ batchDraw: vi.fn() }),
    }));
    return <div data-testid="konva-transformer" />;
  }),
}));

class MockImage {
  naturalWidth = 2400;
  naturalHeight = 1200;
  width = 2400;
  height = 1200;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

const initialRecipe: HeroRecipe = {
  mode: "crop",
  crop: { x: 0, y: 86, width: 2400, height: 1029 },
  position_x: 0.5,
  position_y: 0.5,
  scale: 1,
  flip_horizontal: false,
  rotation: 0,
  blur: 32,
  feather: 28,
  gradient: 0.45,
  grayscale: true,
  brightness: 0.82,
  contrast: 1.18,
};

function Harness() {
  const [recipe, setRecipe] = useState(initialRecipe);
  return (
    <>
      <HeroCompositionCanvas
        sourceUrl="data:image/jpeg;base64,source"
        artistName="Converge"
        composition="desktop"
        aspect={21 / 9}
        recipe={recipe}
        onRecipeChange={setRecipe}
      />
      <output data-testid="recipe-state">{JSON.stringify(recipe)}</output>
    </>
  );
}

describe("HeroCompositionCanvas", () => {
  beforeEach(() => {
    vi.stubGlobal("Image", MockImage);
    transformerForceUpdate.mockClear();
  });

  it("uses one visual toolbar for Crop and Fill without range inputs", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);

    expect(await screen.findByTestId("konva-stage")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crop" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(container.querySelectorAll('input[type="range"]')).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Fill" }));
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    await user.click(screen.getByRole("button", { name: "Flip" }));
    await user.click(screen.getByRole("button", { name: "Rotate clockwise" }));

    expect(screen.getByTestId("recipe-state")).toHaveTextContent(
      '"mode":"extend"',
    );
    expect(screen.getByTestId("recipe-state")).toHaveTextContent(
      '"scale":1.12',
    );
    expect(screen.getByTestId("recipe-state")).toHaveTextContent(
      '"flip_horizontal":true',
    );
    expect(screen.getByTestId("recipe-state")).toHaveTextContent(
      '"rotation":90',
    );

    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByTestId("recipe-state")).toHaveTextContent(
      '"mode":"extend"',
    );
    expect(screen.getByTestId("recipe-state")).toHaveTextContent('"scale":1');
    expect(screen.getByTestId("recipe-state")).toHaveTextContent(
      '"flip_horizontal":false',
    );
    expect(screen.getByTestId("recipe-state")).toHaveTextContent(
      '"rotation":0',
    );
  });

  it("zooms the active visual mode with the canvas wheel", async () => {
    render(<Harness />);

    const stage = await screen.findByTestId("konva-stage");
    fireEvent.wheel(stage, { deltaY: -100 });

    expect(screen.getByTestId("recipe-state")).toHaveTextContent(
      '"width":2143',
    );
  });

  it("resizes the Fill subject when using the zoom button", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await screen.findByTestId("konva-stage");
    await user.click(screen.getByRole("button", { name: "Fill" }));

    const subject = screen.getByTestId("konva-image-fill-subject");
    const initialWidth = subject.getAttribute("data-width");
    const initialX = subject.getAttribute("data-x");

    await user.click(screen.getByRole("button", { name: "Zoom in" }));

    expect(subject.getAttribute("data-width")).not.toBe(initialWidth);
    expect(subject.getAttribute("data-x")).not.toBe(initialX);
  });

  it("refreshes the Fill transformer after zooming", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await screen.findByTestId("konva-stage");
    await user.click(screen.getByRole("button", { name: "Fill" }));
    const callsBeforeZoom = transformerForceUpdate.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Zoom in" }));

    expect(transformerForceUpdate.mock.calls.length).toBeGreaterThan(
      callsBeforeZoom,
    );
  });

  it("renders Fill as one treated image without synthetic gradients or background", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await screen.findByTestId("konva-stage");
    await user.click(screen.getByRole("button", { name: "Fill" }));

    expect(screen.queryByTestId("konva-image-fill-background")).toBeNull();
    expect(screen.getByTestId("konva-image-fill-subject")).toHaveAttribute(
      "data-has-filters",
      "true",
    );
    expect(screen.getByTestId("konva-image-fill-subject")).toHaveAttribute(
      "data-brightness",
      "0.82",
    );
    expect(screen.getByTestId("konva-image-fill-subject")).toHaveAttribute(
      "data-contrast",
      "1.18",
    );
    expect(screen.getByTestId("konva-image-fill-subject")).toHaveAttribute(
      "data-filter-count",
      "3",
    );
    expect(screen.queryByTestId("konva-gradient-fill-left-fade")).toBeNull();
    expect(screen.queryByTestId("konva-gradient-fill-right-fade")).toBeNull();
  });

  it("renders preview-only output without editor chrome", async () => {
    render(
      <HeroCompositionCanvas
        sourceUrl="data:image/jpeg;base64,source"
        artistName="Converge"
        composition="desktop"
        aspect={21 / 9}
        recipe={{ ...initialRecipe, mode: "extend" }}
        previewOnly
        onRecipeChange={vi.fn()}
      />,
    );

    expect(await screen.findByTestId("konva-stage")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Crop" })).toBeNull();
    expect(screen.queryByTestId("konva-transformer")).toBeNull();
    expect(screen.queryByText(/Fill preview/)).toBeNull();
  });

  it("uses the canonical rendered artifact for preview-only output", () => {
    render(
      <HeroCompositionCanvas
        sourceUrl="data:image/jpeg;base64,source"
        previewUrl="/api/artwork/artists/7/hero-preview/preview-1"
        previewArtworkBounds={{
          left: 0.18,
          top: 0,
          right: 0.92,
          bottom: 0.84,
        }}
        artistName="Converge"
        composition="desktop"
        aspect={21 / 9}
        recipe={initialRecipe}
        previewOnly
        onRecipeChange={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("konva-stage")).toBeNull();
    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "/api/artwork/artists/7/hero-preview/preview-1",
    );
    expect(screen.getByRole("img")).toHaveClass("object-fill");
    expect(screen.getByRole("img")).not.toHaveClass("object-cover");
  });

  it("renders the final shared edge fades and presentation over the editable artboard", async () => {
    render(
      <HeroCompositionCanvas
        sourceUrl="data:image/jpeg;base64,source"
        artistName="Converge"
        composition="desktop"
        aspect={21 / 9}
        recipe={initialRecipe}
        onRecipeChange={vi.fn()}
      >
        <div data-testid="live-hero-presentation">Converge live preview</div>
      </HeroCompositionCanvas>,
    );

    expect(await screen.findByTestId("konva-stage")).toBeInTheDocument();
    expect(screen.getByTestId("desktop-artist-hero-frame")).toBeInTheDocument();
    expect(
      screen.getByTestId("desktop-hero-left-edge-scrim"),
    ).toBeInTheDocument();
    const rightScrim = screen.getByTestId("desktop-hero-right-scrim");
    expect(rightScrim).toBeInTheDocument();
    expect(rightScrim).toHaveStyle({ right: "0%", width: "48%" });
    expect(rightScrim.style.background).toContain("to left");
    expect(rightScrim.style.background).toContain("var(--surface-app) 0%");
    expect(rightScrim.style.background).toContain("transparent 100%");
    expect(screen.getByTestId("desktop-hero-bottom-scrim")).toBeInTheDocument();
    expect(screen.getByTestId("live-hero-presentation")).toBeVisible();
    expect(screen.getByTestId("desktop-hero-overlay-host")).toHaveClass(
      "pointer-events-none",
    );
    expect(screen.getByTestId("desktop-hero-scaled-presentation")).toHaveStyle({
      width: "1480px",
      height: "600px",
      transformOrigin: "top left",
    });
  });

  it("keeps Fill integration anchored to the outer canvas", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await screen.findByTestId("konva-stage");
    await user.click(screen.getByRole("button", { name: "Fill" }));

    expect(screen.getByTestId("desktop-hero-artwork-mask")).toHaveStyle({
      maskImage: "none",
    });
    expect(
      screen.getByTestId("desktop-hero-left-edge-scrim"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("desktop-hero-right-scrim")).toBeInTheDocument();
  });

  it("previews mobile copy in an iPhone-sized CSS viewport", async () => {
    render(
      <HeroCompositionCanvas
        sourceUrl="data:image/jpeg;base64,source"
        artistName="Converge"
        composition="mobile"
        aspect={4 / 5}
        recipe={initialRecipe}
        onRecipeChange={vi.fn()}
      >
        <div data-testid="mobile-live-presentation">Converge mobile</div>
      </HeroCompositionCanvas>,
    );

    expect(await screen.findByTestId("konva-stage")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-hero-scaled-presentation")).toHaveStyle({
      width: "430px",
      height: "537.5px",
      transformOrigin: "top left",
    });
  });
});
