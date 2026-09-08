import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CrateLogo } from "./CrateLogo";

describe("CrateLogo", () => {
  it.each([16, 24, 32, 64])("keeps the mark geometry at %spx", (size) => {
    const { container } = render(<CrateLogo size={size} title="Crate" />);
    const logo = container.querySelector("svg");

    expect(logo).toHaveAttribute("viewBox", "0 0 1052 1120");
    expect(logo).toHaveAttribute("width", String(size));
    expect(logo).toHaveAttribute("height", String(size));
    expect(logo).toHaveAccessibleName("Crate");
  });

  it("generates unique gradient ids for simultaneous instances", () => {
    const { container } = render(
      <>
        <CrateLogo title="First" />
        <CrateLogo title="Second" />
      </>,
    );
    const ids = [...container.querySelectorAll("linearGradient")].map(
      (gradient) => gradient.id,
    );

    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(ids.length);
    container.querySelectorAll("svg").forEach((logo) => {
      logo.querySelectorAll("path").forEach((path) => {
        expect(path.getAttribute("fill")).toMatch(/^url\(#.+\)$/);
      });
    });
  });

  it("uses appearance tokens and exposes effects and motion state", () => {
    const { container } = render(
      <CrateLogo effects={false} reducedMotion title="Static Crate" />,
    );
    const logo = container.querySelector("svg")!;

    expect(logo).toHaveAttribute("data-crate-logo-effects", "off");
    expect(logo).toHaveAttribute("data-crate-logo-motion", "reduced");
    expect(container.querySelector("linearGradient stop")).toHaveAttribute(
      "stop-color",
      "var(--brand-logo-start)",
    );
  });
});
