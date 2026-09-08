import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QrCodeImage } from "./QrCodeImage";

const toDataURL = vi.hoisted(() =>
  vi.fn().mockResolvedValue("data:image/png;base64,fake"),
);

vi.mock("qrcode", () => ({
  default: {
    toDataURL,
  },
}));

describe("QrCodeImage", () => {
  beforeEach(() => {
    toDataURL.mockClear();
  });

  it("renders placeholder initially", () => {
    const { container } = render(<QrCodeImage value="test" />);
    expect(container.querySelector("div")).toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
  });

  it("renders image after QR generation", async () => {
    render(<QrCodeImage value="test" />);
    await waitFor(() => {
      expect(screen.getByRole("img", { name: /QR code/i })).toBeInTheDocument();
    });
  });

  it("passes size to image", async () => {
    render(<QrCodeImage value="test" size={200} />);
    const img = await screen.findByRole("img", { name: /QR code/i });
    expect(img).toHaveAttribute("width", "200");
    expect(img).toHaveAttribute("height", "200");
  });

  it("uses semantic theme colors when QR colors are not overridden", async () => {
    const nativeGetComputedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((target) => {
      const computed = nativeGetComputedStyle(target);
      Object.defineProperty(computed, "color", {
        configurable: true,
        value: (target as HTMLElement).style.color.includes("text-primary")
          ? "rgb(248, 250, 252)"
          : "rgb(15, 17, 22)",
      });
      return computed;
    });

    render(<QrCodeImage value="test" />);
    await screen.findByRole("img", { name: /QR code/i });

    expect(toDataURL).toHaveBeenCalledWith(
      "test",
      expect.objectContaining({
        color: { dark: "rgb(248, 250, 252)", light: "rgb(15, 17, 22)" },
      }),
    );
  });
});
