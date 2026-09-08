import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Card } from "./card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./dialog";
import { Select, SelectContent, SelectItem, SelectTrigger } from "./select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./sheet";

describe("semantic surface shadows", () => {
  it("uses the card shadow token", () => {
    render(<Card>Card content</Card>);

    expect(screen.getByText("Card content")).toHaveClass("shadow-card");
  });

  it("uses the popover shadow token for select content", () => {
    render(
      <Select open defaultValue="one">
        <SelectTrigger aria-label="Select value" />
        <SelectContent>
          <SelectItem value="one">One</SelectItem>
        </SelectContent>
      </Select>,
    );

    expect(document.querySelector('[data-slot="select-content"]')).toHaveClass(
      "shadow-popover",
    );
  });

  it("uses the modal shadow token", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Dialog title</DialogTitle>
          <DialogDescription>Dialog description</DialogDescription>
          Dialog content
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByRole("dialog")).toHaveClass("shadow-modal");
  });

  it("uses the sheet shadow token", () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Sheet title</SheetTitle>
          <SheetDescription>Sheet description</SheetDescription>
          Sheet content
        </SheetContent>
      </Sheet>,
    );

    expect(screen.getByRole("dialog")).toHaveClass("shadow-sheet");
  });
});
