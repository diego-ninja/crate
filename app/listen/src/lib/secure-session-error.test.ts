import { describe, expect, it } from "vitest";

import { renderSecureSessionError } from "./secure-session-error";

describe("renderSecureSessionError", () => {
  it("renders the recovery view using the themed surface classes", () => {
    const root = document.createElement("div");

    renderSecureSessionError(root);

    expect(root.firstElementChild).toHaveClass("listen-secure-session-error");
    expect(root.querySelector("section")).toHaveClass(
      "listen-secure-session-error__content",
    );
    expect(root.querySelector("p")).toHaveClass(
      "listen-secure-session-error__message",
    );
    expect(root.querySelector("button")).toHaveClass(
      "listen-secure-session-error__retry",
    );
    expect(root.innerHTML).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
  });
});
