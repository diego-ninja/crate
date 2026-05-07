import { apiAssetUrl, resolveMaybeApiAssetUrl } from "@/lib/api";

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function resolveUserAvatarUrl(
  avatar: string | null | undefined,
  userId?: number | null,
): string | null {
  return resolveUserAvatarSources(avatar, userId).primary;
}

export function resolveUserAvatarSources(
  avatar: string | null | undefined,
  userId?: number | null,
): { primary: string | null; fallback: string | null } {
  if (!avatar) return { primary: null, fallback: null };
  const fallback = resolveMaybeApiAssetUrl(avatar);
  if (userId != null && isHttpUrl(avatar)) {
    return {
      primary: apiAssetUrl(`/api/auth/users/${userId}/avatar`),
      fallback,
    };
  }
  return { primary: fallback, fallback: null };
}
