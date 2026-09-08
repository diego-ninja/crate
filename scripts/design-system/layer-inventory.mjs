import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const SHARED_UI_ROOT = "app/shared/ui";
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  "coverage",
  "dist",
  "node_modules",
]);
const LAYERS = new Set([
  "primitives",
  "composites",
  "domain",
  "icons",
  "lib",
  "shadcn",
]);
const FORBIDDEN_IMPORTS = {
  primitives: new Set(["composites", "domain"]),
  composites: new Set(["domain"]),
};
const SHARED_IMPORT_PATTERN =
  /(?:from\s+|import\s*\(\s*)["'](@crate\/ui\/(primitives|composites|domain|icons|lib|shadcn)\/[^"']+)["']/g;

function layerForPath(path) {
  const match = path.match(/^app\/shared\/ui\/([^/]+)\//);
  return match && LAYERS.has(match[1]) ? match[1] : null;
}

export function analyzeLayerImports(path, content) {
  const layer = layerForPath(path);
  if (!layer) return [];

  const forbidden = FORBIDDEN_IMPORTS[layer] ?? new Set();
  return [...content.matchAll(SHARED_IMPORT_PATTERN)]
    .filter((match) => forbidden.has(match[2]))
    .map((match) => ({
      path,
      layer,
      importedLayer: match[2],
      source: match[1],
    }));
}

function collectFiles(directory, repoRoot, output) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;

    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectFiles(filePath, repoRoot, output);
      continue;
    }

    if (
      !SOURCE_EXTENSIONS.has(extname(entry.name)) ||
      /\.test\.[^.]+$/.test(entry.name)
    ) {
      continue;
    }

    const path = relative(repoRoot, filePath);
    output.push({
      path,
      violations: analyzeLayerImports(path, readFileSync(filePath, "utf8")),
    });
  }
}

export function buildLayerInventory(repoRoot = process.cwd()) {
  const resolvedRoot = resolve(repoRoot);
  const sourceRoot = join(resolvedRoot, SHARED_UI_ROOT);
  const files = [];

  if (statSync(sourceRoot, { throwIfNoEntry: false })) {
    collectFiles(sourceRoot, resolvedRoot, files);
  }

  files.sort((left, right) => left.path.localeCompare(right.path));
  return {
    version: 1,
    rules: {
      primitives: ["composites", "domain"],
      composites: ["domain"],
    },
    files,
    violations: files.flatMap(({ violations }) => violations),
  };
}

export function formatLayerInventorySummary(inventory) {
  return `Shared UI layer boundaries: ${inventory.violations.length} violations across ${inventory.files.length} source files`;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  const inventory = buildLayerInventory();
  const jsonOutput = process.argv.includes("--json");

  console.log(
    jsonOutput
      ? JSON.stringify(inventory, null, 2)
      : formatLayerInventorySummary(inventory),
  );

  if (inventory.violations.length > 0) {
    process.exitCode = 1;
  }
}
