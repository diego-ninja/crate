import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockNavigate, mockRefetch, mockSetAuthToken } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockRefetch: vi.fn<() => Promise<void>>(),
  mockSetAuthToken: vi.fn(),
}));

vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    refetch: mockRefetch,
  }),
}));

vi.mock("@/lib/api", () => ({
  setAuthToken: mockSetAuthToken,
}));

import { AuthCallback } from "@/pages/AuthCallback";

describe("AuthCallback", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockRefetch.mockReset();
    mockSetAuthToken.mockReset();
    localStorage.clear();
    window.history.replaceState({}, "", "/auth/callback?token=oauth-token&next=%2Fstats");
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("hydrates auth before navigating to the next route", async () => {
    let resolveRefetch!: () => void;
    mockRefetch.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveRefetch = resolve;
        }),
    );

    render(<AuthCallback />);

    expect(mockSetAuthToken).toHaveBeenCalledWith("oauth-token");
    expect(localStorage.getItem("crate-oauth-next")).toBe("/stats");
    expect(mockNavigate).not.toHaveBeenCalled();

    resolveRefetch();

    await waitFor(() => {
      expect(mockRefetch).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith("/stats", { replace: true });
    });
  });

  it("returns to login when the callback token is missing", async () => {
    window.history.replaceState({}, "", "/auth/callback?next=%2Fstats");
    mockRefetch.mockResolvedValueOnce();

    render(<AuthCallback />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/login", { replace: true });
    });
    expect(mockRefetch).not.toHaveBeenCalled();
    expect(mockSetAuthToken).not.toHaveBeenCalled();
  });
});
