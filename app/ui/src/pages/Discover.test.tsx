import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock, pollTaskMock, refetchCompletenessMock, useApiMock } =
  vi.hoisted(() => ({
    apiMock: vi.fn(),
    pollTaskMock: vi.fn(),
    refetchCompletenessMock: vi.fn(),
    useApiMock: vi.fn(),
  }));

vi.mock("@/hooks/use-api", () => ({
  useApi: useApiMock,
}));

vi.mock("@/hooks/use-task-poll", () => ({
  useTaskPoll: () => ({ pollTask: pollTaskMock }),
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { Discover } from "./Discover";

describe("Discover completeness refresh", () => {
  beforeEach(() => {
    apiMock.mockReset();
    pollTaskMock.mockReset();
    refetchCompletenessMock.mockReset();
    useApiMock.mockImplementation((url: string) => {
      if (url === "/api/discover/completeness") {
        return {
          data: [],
          loading: false,
          error: null,
          refetch: refetchCompletenessMock,
        };
      }
      if (url.startsWith("/api/acquisition/new-releases")) {
        return {
          data: { releases: [] },
          loading: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      return {
        data: { popularity: [], top_albums: [], top_genres: [] },
        loading: false,
        error: null,
        refetch: vi.fn(),
      };
    });
  });

  it("tracks the queued task and refreshes completeness when it completes", async () => {
    apiMock.mockResolvedValue({ task_id: "task-1" });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <Discover />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Recompute gaps" }));

    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        "/api/discover/completeness/refresh",
        "POST",
      );
    });
    expect(pollTaskMock).toHaveBeenCalledWith(
      "task-1",
      expect.any(Function),
      expect.any(Function),
      3000,
      expect.any(Number),
    );

    const onComplete = pollTaskMock.mock.calls[0]![1] as () => void;
    onComplete();

    expect(refetchCompletenessMock).toHaveBeenCalledTimes(1);
  });
});
