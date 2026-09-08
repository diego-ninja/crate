import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("renders title and description", () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete item?"
        description="This action cannot be undone."
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText("Delete item?")).toBeInTheDocument();
    expect(
      screen.getByText("This action cannot be undone."),
    ).toBeInTheDocument();
  });

  it("calls onConfirm when confirm button is clicked", async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete?"
        description="Are you sure?"
        onConfirm={onConfirm}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Confirm/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onOpenChange when cancel is clicked", async () => {
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Delete?"
        description="Are you sure?"
        onConfirm={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("uses custom confirm label", () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete?"
        description="Are you sure?"
        onConfirm={vi.fn()}
        confirmLabel="Delete forever"
      />,
    );
    expect(
      screen.getByRole("button", { name: /Delete forever/i }),
    ).toBeInTheDocument();
  });

  it("applies destructive styles when variant is destructive", () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete?"
        description="Are you sure?"
        onConfirm={vi.fn()}
        variant="destructive"
      />,
    );
    expect(screen.getByRole("button", { name: /Confirm/i })).toHaveClass(
      "bg-state-danger",
    );
  });
});
