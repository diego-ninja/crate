import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockNavigate, mockRefetch, mockSetAuthTokens } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockRefetch: vi.fn<() => Promise<void>>(),
  mockSetAuthTokens: vi.fn(),
}));

const authState = vi.hoisted(() => ({
  user: null as null | { id: number },
  loading: true,
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
    user: authState.user,
    loading: authState.loading,
    refetch: mockRefetch,
  }),
}));

vi.mock("@/lib/api", () => ({
  setAuthTokens: mockSetAuthTokens,
}));

import { AuthCallback } from "@/pages/AuthCallback";

describe("AuthCallback", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockRefetch.mockReset();
    mockSetAuthTokens.mockReset();
    authState.user = null;
    authState.loading = true;
    localStorage.clear();
    window.history.replaceState({}, "", "/auth/callback?token=oauth-token&next=%2Fstats");
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("hydrates auth before navigating to the next route", async () => {
    mockRefetch.mockResolvedValueOnce();

    const { rerender } = render(<AuthCallback />);

    expect(mockSetAuthTokens).toHaveBeenCalledWith("oauth-token", undefined);
    expect(localStorage.getItem("crate-oauth-next")).toBe("/stats");
    expect(mockRefetch).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();

    authState.user = { id: 1 };
    authState.loading = false;
    rerender(<AuthCallback />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/stats", { replace: true });
    });
  });

  it("returns to login when auth hydration finishes without a user", async () => {
    mockRefetch.mockResolvedValueOnce();

    const { rerender } = render(<AuthCallback />);

    authState.loading = false;
    rerender(<AuthCallback />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/login", { replace: true });
    });
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("returns to login when the callback token is missing", async () => {
    window.history.replaceState({}, "", "/auth/callback?next=%2Fstats");
    mockRefetch.mockResolvedValueOnce();

    render(<AuthCallback />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/login", { replace: true });
    });
    expect(mockRefetch).not.toHaveBeenCalled();
    expect(mockSetAuthTokens).not.toHaveBeenCalled();
  });
});
