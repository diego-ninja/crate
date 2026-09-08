import type { ResolvedColorMode } from "@crate/ui/lib/theme-skin";

const FALLBACK_THEME_COLORS: Record<ResolvedColorMode, string> = {
  dark: "#0a0a0f",
  light: "#f8fafc",
};

export function readThemeColor(
  root: HTMLElement,
  mode: ResolvedColorMode,
): string {
  const computed = getComputedStyle(root);
  return (
    computed.getPropertyValue("--crate-token-surface-app").trim() ||
    computed.getPropertyValue("--surface-app").trim() ||
    FALLBACK_THEME_COLORS[mode]
  );
}

export function syncThemeColor(
  root: HTMLElement,
  mode: ResolvedColorMode,
): string {
  const color = readThemeColor(root, mode);
  const meta = root.ownerDocument.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );

  if (meta) meta.content = color;
  return color;
}
