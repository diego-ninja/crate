import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EqBands } from "./EqBands";

describe("EqBands", () => {
  it("uses semantic tokens for the equalizer tracks and handles", () => {
    const { container } = render(
      <EqBands
        gains={Array.from({ length: 10 }, () => 0)}
        onBandChange={vi.fn()}
      />,
    );

    expect(container.querySelector(".text-text-muted")).toBeInTheDocument();
    expect(container.querySelector(".bg-border-quiet")).toBeInTheDocument();
    expect(
      container.querySelector(".bg-border-interactive"),
    ).toBeInTheDocument();
    expect(container.querySelector(".bg-accent-action")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("var(--idle-");
    expect(container.innerHTML).not.toContain("bg-primary");
  });
});
