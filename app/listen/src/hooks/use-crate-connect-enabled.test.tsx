import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchCrateConnectPreferences: vi.fn(),
  isCrateConnectEnabled: vi.fn(),
  onCacheInvalidation: vi.fn(),
  refreshCrateConnectPreferences: vi.fn(),
  resetCrateConnectPreferences: vi.fn(),
}));

vi.mock("@/lib/crate-connect", () => ({
  CONNECT_ENABLED_EVENT: "crate:connect-enabled-changed",
  fetchCrateConnectPreferences: mocks.fetchCrateConnectPreferences,
  isCrateConnectEnabled: mocks.isCrateConnectEnabled,
  refreshCrateConnectPreferences: mocks.refreshCrateConnectPreferences,
  resetCrateConnectPreferences: mocks.resetCrateConnectPreferences,
}));

vi.mock("@/lib/cache", () => ({
  onCacheInvalidation: mocks.onCacheInvalidation,
}));

vi.mock("@/contexts/auth-runtime", () => ({
  AUTH_RUNTIME_RESET_EVENT: "crate:auth-runtime-reset",
}));

import { useCrateConnectEnabled } from "@/hooks/use-crate-connect-enabled";

describe("useCrateConnectEnabled", () => {
  let cacheListener: ((scope: string) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    cacheListener = null;
    mocks.isCrateConnectEnabled.mockReturnValue(false);
    mocks.fetchCrateConnectPreferences.mockResolvedValue({ enabled: false });
    mocks.refreshCrateConnectPreferences.mockImplementation(async () => {
      mocks.isCrateConnectEnabled.mockReturnValue(true);
      window.dispatchEvent(new Event("crate:connect-enabled-changed"));
      return { enabled: true };
    });
    mocks.onCacheInvalidation.mockImplementation((listener) => {
      cacheListener = listener;
      return vi.fn();
    });
  });

  it("refreshes the global preference when cache invalidation arrives", async () => {
    const hook = renderHook(() => useCrateConnectEnabled());

    await waitFor(() =>
      expect(mocks.fetchCrateConnectPreferences).toHaveBeenCalledTimes(1),
    );
    expect(hook.result.current).toBe(false);

    act(() => {
      cacheListener?.("connect:preferences");
    });

    await waitFor(() =>
      expect(mocks.refreshCrateConnectPreferences).toHaveBeenCalledTimes(1),
    );
    await waitFor(() => expect(hook.result.current).toBe(true));
  });
});
