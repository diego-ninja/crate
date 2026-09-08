import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { openExternalUrl } from "@/lib/external-links";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { BandcampItemActions } from "./BandcampItemActions";

vi.mock("@/lib/external-links", () => ({
  openExternalUrl: vi.fn(),
}));

const mockOpenExternalUrl = vi.mocked(openExternalUrl);

describe("BandcampItemActions", () => {
  afterEach(() => {
    mockOpenExternalUrl.mockReset();
  });

  it("opens item links through the shared external-link helper", async () => {
    const user = userEvent.setup();

    renderWithListenProviders(
      <BandcampItemActions
        item={{
          id: 1,
          item_url: "https://artist.bandcamp.com/album/release",
        }}
        busyAction={null}
        onImport={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /open/i }));

    expect(mockOpenExternalUrl).toHaveBeenCalledWith(
      "https://artist.bandcamp.com/album/release",
    );
  });
});
