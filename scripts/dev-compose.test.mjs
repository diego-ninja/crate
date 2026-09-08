import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("dev cleanup covers every named container in the dev compose files", () => {
  const makefile = readFileSync(resolve(root, "Makefile"), "utf8");
  const compose = [
    readFileSync(resolve(root, "docker-compose.dev.yaml"), "utf8"),
    readFileSync(resolve(root, "docker-compose.readplane.dev.yaml"), "utf8"),
  ].join("\n");

  const cleanup = new Set(
    makefile
      .match(/^DEV_CONTAINERS := (.+)$/m)[1]
      .trim()
      .split(/\s+/),
  );
  const declared = new Set(
    [...compose.matchAll(/^\s*container_name:\s*(crate-dev-\S+)\s*$/gm)].map(
      ([, name]) => name,
    ),
  );

  assert.deepEqual([...cleanup].sort(), [...declared].sort());
});
