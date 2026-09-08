import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const SOURCE_DIRECTORIES = ["app/listen/src", "app/shared/ui"];
const SOURCE_EXTENSIONS = new Set([".css", ".js", ".jsx", ".ts", ".tsx"]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".vite",
  "coverage",
  "dist",
  "node_modules",
]);

const RAW_COLOR_PATTERN = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/gi;
const FOUNDATION_TOKEN_PATH_PATTERN = /^app\/shared\/ui\/tokens\//;
const RAW_COLOR_ALLOWLIST = new Map([
  [
    "app/shared/ui/domain/auth/OAuthButtons.tsx",
    {
      pattern: /fill="#(?:4285F4|34A853|FBBC05|EA4335)"/gi,
      owner: "shared-ui",
      reason: "Provider brand colors must match Google's official OAuth mark.",
      reviewBy: "2026-12-31",
    },
  ],
  [
    "app/shared/ui/lib/theme-skin.ts",
    {
      pattern: /#[0-9a-f]{3,8}\b|rgba?\(/gi,
      owner: "design-system",
      reason: "Curated skin values are runtime inputs for the skin registry.",
      reviewBy: "2026-12-31",
    },
  ],
  [
    "app/shared/ui/lib/appearance-resolver.ts",
    {
      pattern: /#[0-9a-f]{3,8}\b|rgba?\(/gi,
      owner: "design-system",
      reason:
        "Scoped appearance previews need explicit runtime palette values for each preset and mode.",
      reviewBy: "2026-12-31",
    },
  ],
  [
    "app/listen/src/lib/capacitor-init.ts",
    {
      pattern: /color:\s*"#00000000"/gi,
      owner: "listen-platform",
      reason: "Capacitor requires a fully transparent native status-bar color.",
      reviewBy: "2026-12-31",
    },
  ],
]);
const LEGACY_SEMANTIC_UTILITY_PATTERN =
  /(?<![A-Za-z0-9_-])(?:bg|text|border(?:-[trblxyse])?|fill|stroke|from|via|to)-(?:background|foreground|primary(?:-foreground)?|muted(?:-foreground)?|destructive(?:-foreground)?|card(?:-foreground)?|secondary(?:-foreground)?|accent(?:-foreground)?|border|input|ring|app-surface)(?![A-Za-z0-9_-])/g;
const COLOR_UTILITY_NAMES =
  "black|white|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const UTILITY_PATTERN = new RegExp(
  `\\b(?:bg|text|border|ring|outline|from|via|to|fill|stroke)-(?<value>\\[[^\\]]+\\]|(?:${COLOR_UTILITY_NAMES})(?:-\\d{2,3})?(?:\\/\\d{1,3})?)(?=[\\s"'\`]|$)`,
  "g",
);
const THEME_COLOR_UTILITY_PREFIXES = [
  "accent",
  "bg",
  "border",
  "caret",
  "decoration",
  "divide",
  "fill",
  "from",
  "placeholder",
  "ring",
  "stroke",
  "text",
  "to",
  "via",
];
const THEME_UTILITY_GROUPS = {
  color: THEME_COLOR_UTILITY_PREFIXES,
  shadow: ["shadow"],
  "drop-shadow": ["drop-shadow"],
  radius: ["rounded"],
  font: ["font"],
};
const HARDCODED_COLOR_VALUE_PATTERN =
  /#[0-9a-f]{3,8}\b|(?:rgba?|hsla?)\(|\b(?:black|white|transparent|currentColor)\b/i;
const INLINE_STYLE_PATTERN = /\bstyle\s*=\s*\{\{/g;
const DIRECT_SHADCN_IMPORT_PATTERN =
  /(?:from\s+|import\s*\(\s*)["']@crate\/ui\/shadcn\/[^"']+["']/g;
const FOUNDATION_TOKEN_PREFIXES = [
  "accent-",
  "action-",
  "border-",
  "chrome-",
  "control-",
  "focus-",
  "font-",
  "icon-",
  "menu-",
  "motion-",
  "scrim-",
  "state-",
  "surface-",
  "text-",
];
const DOMAIN_TOKEN_PREFIXES = [
  "disc-",
  "eq-",
  "explore-",
  "fullscreen-player-",
  "home-",
  "info-",
  "jam-",
  "lyrics-",
  "genre-",
  "play-button-",
  "player-",
  "playlist-",
  "profile-",
  "quality-",
  "radio-",
  "stats-",
  "track-row-",
  "user-profile-",
  "visualizer-",
];
const INTENTIONAL_DUPLICATE_TOKEN_GROUPS = [
  {
    tokens: ["--surface-contrast", "--state-danger-foreground"],
    reason:
      "The default skin shares the same value, but cards and destructive controls are separate semantic roles for future skins.",
  },
];
const SURFACE_ROLE_PATTERNS = [
  /(?<!-)\b(?<property>border(?:-[a-z-]+)?|outline(?:-[a-z-]+)?)\s*:\s*[^;{}]*?var\(\s*(?<token>--surface-[a-z0-9-]+)(?=\s*[,\)])/gim,
  /(?<!-)\b(?<property>color|fill|stroke)\s*:\s*[^;{}]*?var\(\s*(?<token>--surface-[a-z0-9-]+)(?=\s*[,\)])/gim,
];

function countMatches(content, pattern) {
  return content.match(pattern)?.length ?? 0;
}

function analyzeUtilityDrift(content) {
  const utilities = [...content.matchAll(UTILITY_PATTERN)];
  const arbitraryUtilities = utilities.filter(({ groups }) =>
    groups.value.startsWith("["),
  ).length;
  const hardcodedColorUtilities = utilities.filter(({ groups }) =>
    groups.value.startsWith("[")
      ? HARDCODED_COLOR_VALUE_PATTERN.test(groups.value)
      : true,
  ).length;

  return { arbitraryUtilities, hardcodedColorUtilities };
}

export function analyzeContent(content) {
  const utilityDrift = analyzeUtilityDrift(content);

  return {
    rawColors: countMatches(content, RAW_COLOR_PATTERN),
    legacySemanticUtilities: countMatches(
      content,
      LEGACY_SEMANTIC_UTILITY_PATTERN,
    ),
    ...utilityDrift,
    inlineStyles: countMatches(content, INLINE_STYLE_PATTERN),
    directShadcnImports: countMatches(content, DIRECT_SHADCN_IMPORT_PATTERN),
  };
}

export function analyzeRawColorDrift(path, content) {
  const rawColors = countMatches(content, RAW_COLOR_PATTERN);
  const foundationRawColors = FOUNDATION_TOKEN_PATH_PATTERN.test(path)
    ? rawColors
    : 0;
  const allowlistedRawColors = foundationRawColors
    ? 0
    : Math.min(
        rawColors,
        countMatches(content, RAW_COLOR_ALLOWLIST.get(path)?.pattern ?? /$^/g),
      );

  return {
    foundationRawColors,
    allowlistedRawColors,
    actionableRawColors: rawColors - foundationRawColors - allowlistedRawColors,
  };
}

function getRawColorAllowlistMetadata() {
  return [...RAW_COLOR_ALLOWLIST.entries()].map(([path, metadata]) => ({
    path,
    owner: metadata.owner,
    reason: metadata.reason,
    reviewBy: metadata.reviewBy,
  }));
}

function extractRootBlock(content) {
  const rootStart = content.indexOf(":root");
  if (rootStart === -1) return "";

  const openingBrace = content.indexOf("{", rootStart);
  if (openingBrace === -1) return "";

  let depth = 0;
  for (let index = openingBrace; index < content.length; index += 1) {
    if (content[index] === "{") depth += 1;
    if (content[index] !== "}") continue;

    depth -= 1;
    if (depth === 0) return content.slice(openingBrace + 1, index);
  }

  return "";
}

function extractRootTokenDefinitions(content) {
  const rootBlock = extractRootBlock(content);
  return [...rootBlock.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gim)].map(
    ([, name, value]) => ({
      name,
      value: value
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\s*([(),])\s*/g, "$1"),
    }),
  );
}

function isFoundationToken(name) {
  return FOUNDATION_TOKEN_PREFIXES.some((prefix) =>
    name.startsWith(`--${prefix}`),
  );
}

function isDomainToken(name) {
  return DOMAIN_TOKEN_PREFIXES.some((prefix) => name.startsWith(`--${prefix}`));
}

function countTokenReferences(content, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cssReferences =
    content.match(new RegExp(`var\\(\\s*${escapedName}(?=\\s*[,\\)])`, "g"))
      ?.length ?? 0;
  const quotedReferences =
    content.match(new RegExp("[\\\"'`]" + escapedName + "[\\\"'`]", "g"))
      ?.length ?? 0;

  const themeUtilityAliases = [
    ...content.matchAll(
      /--(?<group>color|shadow|drop-shadow|radius|font)-(?<alias>[a-z0-9-]+)\s*:\s*var\(\s*(?<source>--[a-z0-9-]+)/gi,
    ),
  ]
    .filter((match) => match.groups?.source === name)
    .flatMap((match) => {
      const group = match.groups?.group;
      const alias = match.groups?.alias;
      return (THEME_UTILITY_GROUPS[group] ?? []).map(
        (prefix) => `${prefix}-${alias}`,
      );
    });
  const utilityReferences = themeUtilityAliases.reduce(
    (count, utility) =>
      count +
      (content.match(
        new RegExp(`(?<![A-Za-z0-9_-])${utility}(?=$|[^A-Za-z0-9_-])`, "g"),
      )?.length ?? 0),
    0,
  );

  return cssReferences + quotedReferences + utilityReferences;
}

function duplicateGroupKey(tokens) {
  return [...tokens].sort().join("|");
}

function classifyDuplicateTokenGroups(duplicateTokenGroups) {
  const intentionalDuplicateGroups = duplicateTokenGroups.flatMap((tokens) => {
    const match = INTENTIONAL_DUPLICATE_TOKEN_GROUPS.find(
      (candidate) =>
        duplicateGroupKey(candidate.tokens) === duplicateGroupKey(tokens),
    );
    return match ? [{ tokens, reason: match.reason }] : [];
  });
  const intentionalKeys = new Set(
    intentionalDuplicateGroups.map(({ tokens }) => duplicateGroupKey(tokens)),
  );
  const actionableDuplicateGroups = duplicateTokenGroups.filter(
    (tokens) => !intentionalKeys.has(duplicateGroupKey(tokens)),
  );

  return { actionableDuplicateGroups, intentionalDuplicateGroups };
}

function findSurfaceRoleViolations(content) {
  return SURFACE_ROLE_PATTERNS.flatMap((pattern) =>
    [...content.matchAll(pattern)].map((match) => ({
      property: match.groups.property,
      token: match.groups.token,
    })),
  );
}

export function analyzeSemanticTokens(content, consumerContents = [content]) {
  const definitions = extractRootTokenDefinitions(content);
  const values = new Map();

  definitions.forEach(({ value }) => {
    values.set(value, (values.get(value) ?? 0) + 1);
  });

  const aliases = definitions.filter(({ value }) =>
    /^var\(--[a-z0-9-]+\)$/.test(value),
  );
  const duplicateTokenGroups = [...values.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) =>
      definitions
        .filter((definition) => definition.value === value)
        .map(({ name }) => name),
    );
  const { actionableDuplicateGroups, intentionalDuplicateGroups } =
    classifyDuplicateTokenGroups(duplicateTokenGroups);
  const allConsumerContent = consumerContents.join("\n");
  const roleViolations = findSurfaceRoleViolations(allConsumerContent);
  const tokenConsumers = Object.fromEntries(
    definitions.map(({ name }) => [
      name,
      countTokenReferences(allConsumerContent, name),
    ]),
  );
  const oneShotTokens = definitions
    .filter(({ name }) => tokenConsumers[name] === 1)
    .map(({ name }) => ({ name, consumers: tokenConsumers[name] }));

  return {
    definitions: definitions.length,
    foundationDefinitions: definitions.filter(({ name }) =>
      isFoundationToken(name),
    ).length,
    domainDefinitions: definitions.filter(({ name }) => isDomainToken(name))
      .length,
    aliases: aliases.length,
    uniqueValues: values.size,
    duplicateDefinitions: definitions.length - values.size,
    actionableDuplicateDefinitions: actionableDuplicateGroups.reduce(
      (count, tokens) => count + tokens.length - 1,
      0,
    ),
    duplicateGroups: duplicateTokenGroups.length,
    duplicateTokenGroups,
    actionableDuplicateGroups,
    intentionalDuplicateGroups,
    nonFoundationAliases: aliases
      .filter(({ name }) => !isFoundationToken(name) && !isDomainToken(name))
      .map(({ name }) => name),
    tokenConsumers,
    oneShotTokens,
    roleViolations,
    unreferencedTokens: definitions
      .filter(({ name }) => tokenConsumers[name] === 0)
      .map(({ name }) => name),
  };
}

function collectFiles(directory, repoRoot, output) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;

    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectFiles(filePath, repoRoot, output);
      continue;
    }

    if (!SOURCE_EXTENSIONS.has(extname(entry.name))) continue;
    if (/\.test\.[^.]+$/.test(entry.name)) continue;

    const content = readFileSync(filePath, "utf8");
    const path = relative(repoRoot, filePath);
    const contentMetrics = analyzeContent(content);
    output.push({
      path,
      ...contentMetrics,
      legacySemanticUtilities: FOUNDATION_TOKEN_PATH_PATTERN.test(path)
        ? 0
        : contentMetrics.legacySemanticUtilities,
      ...analyzeRawColorDrift(path, content),
    });
  }
}

export function buildDriftInventory(repoRoot = process.cwd()) {
  const resolvedRoot = resolve(repoRoot);
  const files = [];
  const semanticTokenPath = join(
    resolvedRoot,
    "app/shared/ui/tokens/semantic.css",
  );

  SOURCE_DIRECTORIES.forEach((directory) => {
    const absoluteDirectory = join(resolvedRoot, directory);
    if (statSync(absoluteDirectory, { throwIfNoEntry: false })) {
      collectFiles(absoluteDirectory, resolvedRoot, files);
    }
  });

  files.sort((left, right) => left.path.localeCompare(right.path));
  const sourceContents = files.map((file) =>
    readFileSync(join(resolvedRoot, file.path), "utf8"),
  );

  const totals = files.reduce(
    (result, file) => {
      result.rawColors += file.rawColors;
      result.legacySemanticUtilities += file.legacySemanticUtilities;
      result.foundationRawColors += file.foundationRawColors;
      result.allowlistedRawColors += file.allowlistedRawColors;
      result.actionableRawColors += file.actionableRawColors;
      result.arbitraryUtilities += file.arbitraryUtilities;
      result.hardcodedColorUtilities += file.hardcodedColorUtilities;
      result.inlineStyles += file.inlineStyles;
      result.directShadcnImports += file.directShadcnImports;
      return result;
    },
    {
      files: files.length,
      rawColors: 0,
      legacySemanticUtilities: 0,
      foundationRawColors: 0,
      allowlistedRawColors: 0,
      actionableRawColors: 0,
      arbitraryUtilities: 0,
      hardcodedColorUtilities: 0,
      inlineStyles: 0,
      directShadcnImports: 0,
    },
  );

  return {
    version: 4,
    roots: SOURCE_DIRECTORIES,
    rawColorAllowlist: getRawColorAllowlistMetadata(),
    semanticTokens: statSync(semanticTokenPath, { throwIfNoEntry: false })
      ? analyzeSemanticTokens(
          readFileSync(semanticTokenPath, "utf8"),
          sourceContents,
        )
      : null,
    totals,
    files,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  console.log(JSON.stringify(buildDriftInventory(), null, 2));
}
