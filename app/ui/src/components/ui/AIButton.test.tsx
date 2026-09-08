import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AIButton } from "./AIButton";

const { useLLMStatusMock } = vi.hoisted(() => ({
  useLLMStatusMock: vi.fn(),
}));

vi.mock("@/hooks/use-llm", () => ({
  useLLMStatus: useLLMStatusMock,
}));

beforeEach(() => {
  useLLMStatusMock.mockReturnValue({
    available: true,
    model: "test-model",
    provider: "test",
  });
});

describe("AIButton", () => {
  it("renders children", () => {
    render(<AIButton>Generate</AIButton>);
    expect(
      screen.getByRole("button", { name: /Generate/i }),
    ).toBeInTheDocument();
  });

  it("does not render when the LLM is unavailable", () => {
    useLLMStatusMock.mockReturnValue({
      available: false,
      model: "",
      provider: "",
      error: "LLM provider is not configured",
    });

    render(<AIButton>Generate</AIButton>);

    expect(
      screen.queryByRole("button", { name: /Generate/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps the standard admin button sizing", () => {
    render(
      <div className="h-20">
        <AIButton>Research with AI</AIButton>
      </div>,
    );

    const button = screen.getByRole("button", { name: /Research with AI/i });
    expect(button).toHaveClass("h-8", "px-3", "text-sm");
    expect(button).not.toHaveClass("h-full", "text-xs");
    expect(button.parentElement).toHaveClass("inline-flex");
    expect(button.parentElement).not.toHaveClass("self-stretch");
  });

  it("shows spinner when loading", () => {
    render(<AIButton loading>Generate</AIButton>);
    expect(screen.getByRole("button").querySelector("svg")).toHaveClass(
      "animate-spin",
    );
  });

  it("is disabled when loading", () => {
    render(<AIButton loading>Generate</AIButton>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("is disabled when disabled prop is true", () => {
    render(<AIButton disabled>Generate</AIButton>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("calls onClick when clicked", async () => {
    const handleClick = vi.fn();
    render(<AIButton onClick={handleClick}>Generate</AIButton>);
    await userEvent.click(screen.getByRole("button"));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
