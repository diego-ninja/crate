import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./button";

describe("Button", () => {
  it("renders as button by default", () => {
    render(<Button>Click me</Button>);
    expect(
      screen.getByRole("button", { name: /Click me/i }),
    ).toBeInTheDocument();
  });

  it("is disabled when disabled prop is true", () => {
    render(<Button disabled>Click me</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("calls onClick when clicked", async () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click me</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("applies variant data attribute", () => {
    render(<Button variant="destructive">Delete</Button>);
    expect(screen.getByRole("button")).toHaveAttribute(
      "data-variant",
      "destructive",
    );
  });

  it("uses semantic tokens for the default action", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button")).toHaveClass(
      "bg-accent-action",
      "text-accent-action-foreground",
    );
  });

  it("applies size data attribute", () => {
    render(<Button size="sm">Small</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("data-size", "sm");
  });

  it("renders as child when asChild is true", () => {
    render(
      <Button asChild>
        <a href="/link">Link button</a>
      </Button>,
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", "/link");
  });
});
