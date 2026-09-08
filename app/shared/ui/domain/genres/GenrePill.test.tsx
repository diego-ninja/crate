import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { GenrePill } from "./GenrePill";

describe("GenrePill", () => {
  it("keeps the remove action inside the pill container", () => {
    render(
      <GenrePill
        item={{ name: "Hardcore punk", slug: "hardcore-punk" }}
        onRemove={vi.fn()}
        removeLabel="Remove Hardcore punk"
      />,
    );

    const removeButton = screen.getByRole("button", {
      name: "Remove Hardcore punk",
    });
    expect(removeButton.closest("span")).toHaveClass(
      "rounded-md",
      "border",
      "text-badge",
    );
  });

  it("uses compact badge typography for the percentage", () => {
    render(<GenrePill item={{ name: "Hardcore punk", percent: 42 }} />);

    expect(screen.getByText("42%")).toHaveClass("text-badge");
  });
});
