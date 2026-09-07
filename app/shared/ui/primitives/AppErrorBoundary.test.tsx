import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppErrorBoundary } from "./AppErrorBoundary";

function ThrowError({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("Test error");
  }
  return <div>Normal content</div>;
}

describe("AppErrorBoundary", () => {
  it("renders children when there is no error", () => {
    render(
      <AppErrorBoundary>
        <div>Safe content</div>
      </AppErrorBoundary>,
    );
    expect(screen.getByText("Safe content")).toBeInTheDocument();
  });

  it("renders default fallback when an error is thrown", () => {
    render(
      <AppErrorBoundary>
        <ThrowError shouldThrow />
      </AppErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Test error")).toBeInTheDocument();
  });

  it("renders custom fallback element", () => {
    render(
      <AppErrorBoundary fallback={<div>Custom error</div>}>
        <ThrowError shouldThrow />
      </AppErrorBoundary>,
    );
    expect(screen.getByText("Custom error")).toBeInTheDocument();
  });

  it("renders custom fallback function", () => {
    render(
      <AppErrorBoundary fallback={(error) => <div>{error.message}</div>}>
        <ThrowError shouldThrow />
      </AppErrorBoundary>,
    );
    expect(screen.getByText("Test error")).toBeInTheDocument();
  });

  it("reports caught render errors when an error handler is provided", () => {
    const onError = vi.fn();

    render(
      <AppErrorBoundary onError={onError}>
        <ThrowError shouldThrow />
      </AppErrorBoundary>,
    );

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Test error" }),
      expect.objectContaining({ componentStack: expect.any(String) }),
    );
  });

  it("calls onReset when reset button is clicked", async () => {
    const handleReset = vi.fn();
    // Mock window.location.href
    const originalHref = window.location.href;
    Object.defineProperty(window, "location", {
      writable: true,
      value: { href: "" },
    });

    render(
      <AppErrorBoundary onReset={handleReset}>
        <ThrowError shouldThrow />
      </AppErrorBoundary>,
    );

    const btn = screen.getByRole("button", { name: /Go home/i });
    btn.click();
    expect(handleReset).toHaveBeenCalledTimes(1);

    // restore
    Object.defineProperty(window, "location", {
      writable: true,
      value: { href: originalHref },
    });
  });
});
