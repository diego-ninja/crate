import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StarRating } from "./StarRating";

describe("StarRating", () => {
  it("renders 5 stars", () => {
    render(<StarRating value={3} />);
    expect(screen.getAllByRole("button")).toHaveLength(5);
  });

  it("fills stars up to value", () => {
    render(<StarRating value={3} />);
    const stars = screen.getAllByRole("button");
    expect(stars[0]).toHaveClass("text-accent-action");
    expect(stars[1]).toHaveClass("text-accent-action");
    expect(stars[2]).toHaveClass("text-accent-action");
    expect(stars[3]).toHaveClass("text-text-muted/20");
    expect(stars[4]).toHaveClass("text-text-muted/20");
  });

  it("calls onChange when a star is clicked", async () => {
    const handleChange = vi.fn();
    render(<StarRating value={0} onChange={handleChange} />);
    await userEvent.click(screen.getAllByRole("button")[2]);
    expect(handleChange).toHaveBeenCalledWith(3);
  });

  it("toggles off when clicking the same value", async () => {
    const handleChange = vi.fn();
    render(<StarRating value={3} onChange={handleChange} />);
    await userEvent.click(screen.getAllByRole("button")[2]);
    expect(handleChange).toHaveBeenCalledWith(0);
  });

  it("does not call onChange when readonly", async () => {
    const handleChange = vi.fn();
    render(<StarRating value={3} onChange={handleChange} readonly />);
    await userEvent.click(screen.getAllByRole("button")[0]);
    expect(handleChange).not.toHaveBeenCalled();
  });

  it("disables buttons when readonly", () => {
    render(<StarRating value={3} readonly />);
    screen.getAllByRole("button").forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });
});
