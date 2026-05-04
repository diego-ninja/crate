import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { QualityBadge } from "@/components/player/bar/QualityBadge";

describe("QualityBadge", () => {
  it("shows the tier icon for source quality badges", () => {
    const { container } = render(
      <QualityBadge
        badge={{ label: "FLAC 16/44.1", detail: "16-bit / 44.1 kHz", tier: "lossless" }}
        origin="source"
      />,
    );

    expect(screen.getByText("FLAC 16/44.1")).toBeTruthy();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("hides the icon and updates the title for stream delivery badges", () => {
    const { container } = render(
      <QualityBadge
        badge={{ label: "AAC 192", detail: "192 kbps", tier: "high" }}
        origin="stream"
      />,
    );

    expect(screen.getByText("AAC 192").getAttribute("title")).toBe(
      "Streaming delivery quality · 192 kbps",
    );
    expect(container.querySelector("svg")).toBeNull();
  });
});
