import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Table } from "./table";

describe("Table", () => {
  it("uses the semantic card shadow for its surface", () => {
    render(
      <Table>
        <tbody>
          <tr>
            <td>Content</td>
          </tr>
        </tbody>
      </Table>,
    );

    expect(document.querySelector('[data-slot="table-container"]')).toHaveClass(
      "shadow-card",
    );
  });
});
