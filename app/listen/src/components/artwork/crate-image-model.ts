import type { ResolvedArtworkCandidate } from "@/lib/artwork-manager";

export const EVENTUAL_RETRY_DELAYS_MS = [
  2_000, 4_000, 8_000, 15_000, 30_000, 30_000, 30_000, 60_000, 60_000, 60_000,
] as const;

export function shouldRefreshAfterResume(
  image: HTMLImageElement | null,
  loading: "eager" | "lazy" | undefined,
): boolean {
  if (loading !== "lazy") return true;
  if (!image) return false;
  const bounds = image.getBoundingClientRect();
  return (
    bounds.width > 0 &&
    bounds.height > 0 &&
    bounds.bottom > 0 &&
    bounds.right > 0 &&
    bounds.top < window.innerHeight &&
    bounds.left < window.innerWidth
  );
}

export function retryCandidate(
  candidate: ResolvedArtworkCandidate,
  attempt: number,
): ResolvedArtworkCandidate {
  const append = (value: string): string => {
    const separator = value.includes("?") ? "&" : "?";
    return `${value}${separator}retry=${attempt}`;
  };
  return {
    ...candidate,
    src: append(candidate.src),
    srcSet: candidate.srcSet
      ?.split(",")
      .map((entry) => {
        const match = entry.trim().match(/^(\S+)(\s+.+)?$/);
        return match?.[1]
          ? `${append(match[1])}${match[2] ?? ""}`
          : entry.trim();
      })
      .join(", "),
  };
}
