import { describe, expect, it } from "vitest";

import { hasRemoteConnectOwner } from "./use-player-connect-transport";

const instances = (instanceIds: string[]) =>
  instanceIds.map((instance_id) => ({ instance_id }));

describe("hasRemoteConnectOwner", () => {
  it("requires an enabled transport and a connected active instance", () => {
    expect(
      hasRemoteConnectOwner(false, "owner", "local", instances(["owner"])),
    ).toBe(false);
    expect(
      hasRemoteConnectOwner(true, null, "local", instances(["owner"])),
    ).toBe(false);
    expect(hasRemoteConnectOwner(true, "owner", "local", instances([]))).toBe(
      false,
    );
  });

  it("returns true only when another connected instance owns playback", () => {
    expect(
      hasRemoteConnectOwner(
        true,
        "owner",
        "local",
        instances(["owner", "local"]),
      ),
    ).toBe(true);
    expect(
      hasRemoteConnectOwner(true, "local", "local", instances(["local"])),
    ).toBe(false);
  });
});
