import { describe, expect, it, vi } from "vitest";

import {
  isRemoteCommandType,
  nextReconnectDelay,
  normalizeInstances,
  parseMessage,
  serverTimeOffsetMs,
} from "@/hooks/crate-connect-ws-model";

describe("crate connect websocket model", () => {
  it("parses JSON messages and rejects invalid payloads", () => {
    expect(parseMessage('{"type":"hello","payload":{}}')).toEqual({
      type: "hello",
      payload: {},
    });
    expect(parseMessage("not-json")).toBeNull();
    expect(parseMessage(new Blob(["{}"]))).toBeNull();
  });

  it("normalizes connected instances and ignores malformed entries", () => {
    expect(
      normalizeInstances({
        active_instance_id: "instance-1",
        instances: [
          { instance_id: "instance-1", device_label: "Phone" },
          { device_label: "missing id" },
          null,
        ],
      }),
    ).toEqual({
      active_instance_id: "instance-1",
      instances: [{ instance_id: "instance-1", device_label: "Phone" }],
    });
  });

  it("calculates server clock offsets from hello messages", () => {
    const now = Date.parse("2026-09-06T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    expect(
      serverTimeOffsetMs({
        type: "hello",
        payload: { server_time: "2026-09-06T00:00:02.500Z" },
      }),
    ).toBe(2500);
    vi.useRealTimers();
  });

  it("recognizes only supported remote commands", () => {
    expect(isRemoteCommandType("seek")).toBe(true);
    expect(isRemoteCommandType("volume")).toBe(true);
    expect(isRemoteCommandType("play")).toBe(false);
  });

  it("caps reconnect backoff at thirty seconds", () => {
    expect(nextReconnectDelay(0)).toBe(1000);
    expect(nextReconnectDelay(3)).toBe(8000);
    expect(nextReconnectDelay(10)).toBe(30000);
    expect(nextReconnectDelay(-1)).toBe(1000);
  });
});
