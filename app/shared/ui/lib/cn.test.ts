import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("handles conditional classes", () => {
    expect(cn("a", false && "b", "c")).toBe("a c");
  });

  it("resolves tailwind conflicts", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("keeps badge typography when merged with a text color", () => {
    expect(cn("text-badge", "text-[var(--active-text)]")).toBe(
      "text-badge text-[var(--active-text)]",
    );
  });

  it("handles arrays and objects", () => {
    expect(cn(["a", "b"], { c: true, d: false })).toBe("a b c");
  });

  it("returns empty string for no inputs", () => {
    expect(cn()).toBe("");
  });
});
