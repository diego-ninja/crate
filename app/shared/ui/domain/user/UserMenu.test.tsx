import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { UserMenu } from "./UserMenu";

let isDesktop = true;
let canHover = true;

vi.mock("@crate/ui/lib/use-breakpoint", () => ({
  useIsDesktop: () => isDesktop,
}));

vi.mock("@crate/ui/lib/use-hover-capability", () => ({
  useHoverCapability: () => canHover,
}));

function mockDesktopEnvironment() {
  Object.defineProperty(navigator, "maxTouchPoints", {
    value: 0,
    configurable: true,
  });
  Object.defineProperty(navigator, "userAgent", {
    value:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    configurable: true,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

describe("UserMenu", () => {
  beforeEach(() => {
    isDesktop = true;
    canHover = true;
    mockDesktopEnvironment();
  });

  it("renders the default trigger with the user's initial", () => {
    render(
      <UserMenu
        userName="ada lovelace"
        items={[{ key: "settings", label: "Settings", onSelect: vi.fn() }]}
      />,
    );

    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "User menu" })).toHaveClass(
      "shadow-icon-control",
    );
  });

  it("renders the fallback User icon when no avatar or initial is provided", () => {
    const { container } = render(
      <UserMenu
        items={[{ key: "settings", label: "Settings", onSelect: vi.fn() }]}
      />,
    );

    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(screen.queryByText("S")).not.toBeInTheDocument();
  });

  it("renders a custom trigger slot", () => {
    render(
      <UserMenu
        trigger={<span data-testid="custom-trigger">Account</span>}
        items={[{ key: "settings", label: "Settings", onSelect: vi.fn() }]}
      />,
    );

    expect(screen.getByTestId("custom-trigger")).toBeInTheDocument();
  });

  it("renders the menu with the provided items", () => {
    render(
      <UserMenu
        userName="ada"
        items={[
          { key: "profile", label: "Profile", onSelect: vi.fn() },
          { key: "settings", label: "Settings", onSelect: vi.fn() },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /User menu/i }));

    expect(
      screen.getByRole("menuitem", { name: /Profile/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Settings/i }),
    ).toBeInTheDocument();
  });

  it("calls onAvatarError when the avatar image fails to load", () => {
    const onAvatarError = vi.fn();
    render(
      <UserMenu
        userName="ada"
        avatarUrl="https://example.com/broken.png"
        onAvatarError={onAvatarError}
        items={[{ key: "settings", label: "Settings", onSelect: vi.fn() }]}
      />,
    );

    const image = document.querySelector("img");
    expect(image).toBeInTheDocument();
    fireEvent.error(image!);

    expect(onAvatarError).toHaveBeenCalledTimes(1);
  });
});
