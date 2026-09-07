import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { QualityBadge } from "./QualityBadge";

describe("QualityBadge", () => {
  it("renders hi-res source badge with icon", () => {
    const { container } = render(
      <QualityBadge
        badge={{ tier: "hi-res", label: "HI-RES", detail: "24-bit / 96 kHz" }}
      />,
    );
    const badge = container.firstElementChild;

    expect(container.textContent).toContain("HI-RES");
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(badge).toHaveClass(
      "text-badge",
      "border-state-warning/50",
      "text-state-warning",
      "bg-state-warning/10",
      "quality-badge-hi-res-glow",
    );
  });

  it("keeps the lossless accent treatment for stream quality", () => {
    const { container } = render(
      <QualityBadge
        badge={{ tier: "lossless", label: "Lossless", detail: "FLAC" }}
        origin="stream"
      />,
    );
    const badge = container.firstElementChild;

    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(badge).toHaveClass(
      "text-badge",
      "border-accent-action/40",
      "text-accent-action",
      "bg-accent-action/8",
    );
    expect(badge?.className).not.toMatch(
      /(?:border|text|bg)-(?:white|state-info)|rgba\(|shadow-\[/,
    );
  });

  it("renders standard badge without icon", () => {
    const { container } = render(
      <QualityBadge
        badge={{ tier: "standard", label: "MP3", detail: "320 kbps" }}
      />,
    );
    const badge = container.firstElementChild;

    expect(container.querySelector("svg")).toBeNull();
    expect(badge).toHaveClass(
      "text-badge",
      "border-border-quiet",
      "text-text-muted",
      "bg-transparent",
    );
    expect(badge?.className).not.toMatch(
      /(?:border|text|bg)-(?:white|primary)|rgba\(|shadow-\[/,
    );
  });
});
