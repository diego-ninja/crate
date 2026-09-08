import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppPopover, AppPopoverDivider, AppMenuButton } from "./AppPopover";

describe("AppPopover", () => {
  it("renders children", () => {
    render(<AppPopover>Content</AppPopover>);
    expect(screen.getByText("Content")).toBeInTheDocument();
  });

  it("applies dropdown layer by default", () => {
    const { container } = render(<AppPopover>Content</AppPopover>);
    expect(container.firstChild).toHaveClass("z-app-dropdown");
  });

  it("uses the semantic popover shadow", () => {
    const { container } = render(<AppPopover>Content</AppPopover>);
    expect(container.firstChild).toHaveClass("shadow-popover");
  });

  it("applies popover layer when specified", () => {
    const { container } = render(
      <AppPopover layer="popover">Content</AppPopover>,
    );
    expect(container.firstChild).toHaveClass("z-app-popover");
  });
});

describe("AppPopoverDivider", () => {
  it("renders a divider", () => {
    const { container } = render(<AppPopoverDivider />);
    expect(container.firstChild).toHaveClass("border-t");
  });
});

describe("AppMenuButton", () => {
  it("renders as button", () => {
    render(<AppMenuButton>Menu item</AppMenuButton>);
    expect(
      screen.getByRole("button", { name: /Menu item/i }),
    ).toBeInTheDocument();
  });

  it("applies danger styles when danger is true", () => {
    render(<AppMenuButton danger>Delete</AppMenuButton>);
    expect(screen.getByRole("button")).toHaveClass(
      "text-[var(--status-danger-text)]",
    );
  });
});
