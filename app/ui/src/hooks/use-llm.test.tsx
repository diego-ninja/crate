import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useApiMock } = vi.hoisted(() => ({
  useApiMock: vi.fn(),
}));

vi.mock("@/hooks/use-api", () => ({
  useApi: useApiMock,
}));

import { LLMStatusProvider, useLLMStatus } from "./use-llm";

function StatusConsumer() {
  const status = useLLMStatus();
  return <output>{status?.available ? "available" : "unavailable"}</output>;
}

describe("LLMStatusProvider", () => {
  beforeEach(() => {
    useApiMock.mockReturnValue({
      data: {
        available: true,
        model: "gemini-test",
        provider: "gemini",
      },
    });
  });

  it("shares the configured status with AI controls", () => {
    render(
      <LLMStatusProvider>
        <StatusConsumer />
      </LLMStatusProvider>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("available");
    expect(useApiMock).toHaveBeenCalledWith("/api/admin/llm/status");
  });
});
