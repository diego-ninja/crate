import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EqualizerPopover } from "@/components/player/EqualizerPopover";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

vi.mock("@/components/player/EqualizerPanel", () => ({
  EqualizerPanel: () => <div data-testid="equalizer-panel" />,
}));

vi.mock("@crate/ui/lib/use-dismissible-layer", () => ({
  useDismissibleLayer: vi.fn(),
}));

describe("EqualizerPopover", () => {
  it("uses semantic surface, border, and shadow tokens", () => {
    const { container } = renderWithListenProviders(
      <EqualizerPopover open onClose={vi.fn()} />,
    );

    expect(screen.getByRole("dialog", { name: "Equalizer" })).toHaveClass(
      "border-border-quiet",
      "bg-surface-overlay",
      "shadow-menu",
    );
    expect(container.innerHTML).not.toContain("border-white");
    expect(container.innerHTML).not.toContain("bg-black");
    expect(container.innerHTML).not.toContain("rgba(");
  });
});
