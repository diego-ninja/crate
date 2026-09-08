import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { WindowPicker } from "./StatsPanels";

describe("WindowPicker", () => {
  it("uses the semantic accent shadow for the active window", () => {
    renderWithListenProviders(<WindowPicker value="7d" onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "7D" })).toHaveClass(
      "shadow-accent-action",
    );
  });
});
