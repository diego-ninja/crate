import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeLayerImports,
  buildLayerInventory,
  formatLayerInventorySummary,
} from "./layer-inventory.mjs";

test("allows lower layers to consume curated shared primitives", () => {
  assert.deepEqual(
    analyzeLayerImports(
      "app/shared/ui/composites/ConfirmDialog.tsx",
      'import { Button } from "@crate/ui/shadcn/button";',
    ),
    [],
  );
});

test("rejects upward dependencies from primitives and composites", () => {
  assert.deepEqual(
    analyzeLayerImports(
      "app/shared/ui/primitives/BadPrimitive.tsx",
      'import { ShowCard } from "@crate/ui/domain/shows/ShowCard";',
    ),
    [
      {
        path: "app/shared/ui/primitives/BadPrimitive.tsx",
        layer: "primitives",
        importedLayer: "domain",
        source: "@crate/ui/domain/shows/ShowCard",
      },
    ],
  );
  assert.deepEqual(
    analyzeLayerImports(
      "app/shared/ui/composites/BadComposite.tsx",
      'import { ShowCard } from "@crate/ui/domain/shows/ShowCard";',
    ),
    [
      {
        path: "app/shared/ui/composites/BadComposite.tsx",
        layer: "composites",
        importedLayer: "domain",
        source: "@crate/ui/domain/shows/ShowCard",
      },
    ],
  );
});

test("keeps the current shared UI layer graph valid", () => {
  const inventory = buildLayerInventory();

  assert.deepEqual(inventory.violations, []);
  assert.match(
    formatLayerInventorySummary(inventory),
    /^Shared UI layer boundaries: 0 violations across \d+ source files$/,
  );
});
