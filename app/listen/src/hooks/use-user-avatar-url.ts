import { useCallback, useEffect, useMemo, useState } from "react";

import { resolveUserAvatarSources } from "@/lib/user-avatar";

export function useUserAvatarUrl(
  avatar: string | null | undefined,
  userId?: number | null,
) {
  const sources = useMemo(() => resolveUserAvatarSources(avatar, userId), [avatar, userId]);
  const [avatarUrl, setAvatarUrl] = useState(sources.primary);

  useEffect(() => {
    setAvatarUrl(sources.primary);
  }, [sources.primary]);

  const handleAvatarError = useCallback(() => {
    setAvatarUrl((current) => {
      if (sources.fallback && current !== sources.fallback) {
        return sources.fallback;
      }
      return null;
    });
  }, [sources.fallback]);

  return { avatarUrl, handleAvatarError };
}
