import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CratePill, CrateChip } from "./CrateBadge";

describe("CratePill", () => {
  it("renders children", () => {
    const { container } = render(<CratePill>Label</CratePill>);
    expect(screen.getByText("Label")).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("text-badge");
  });

  it("renders as a button when onClick is provided", () => {
    render(<CratePill onClick={() => {}}>Clickable</CratePill>);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("renders as a span when onClick is not provided", () => {
    render(<CratePill>Static</CratePill>);
    expect(screen.getByText("Static").tagName).toBe("SPAN");
  });

  it("calls onClick when clicked", async () => {
    const handleClick = vi.fn();
    render(<CratePill onClick={handleClick}>Clickable</CratePill>);
    await userEvent.click(screen.getByRole("button"));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("is disabled when disabled prop is true", () => {
    render(
      <CratePill onClick={() => {}} disabled>
        Disabled
      </CratePill>,
    );
    expect(screen.getByRole("button")).toBeDisabled();
  });
});

describe("CrateChip", () => {
  it("renders children", () => {
    const { container } = render(<CrateChip>Tag</CrateChip>);
    expect(screen.getByText("Tag")).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("text-badge");
  });

  it("renders as a span", () => {
    render(<CrateChip>Tag</CrateChip>);
    expect(screen.getByText("Tag").tagName).toBe("SPAN");
  });
});
