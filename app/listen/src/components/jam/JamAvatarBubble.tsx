import { CrateImage } from "@/components/artwork/CrateImage";
import { useUserAvatarUrl } from "@/hooks/use-user-avatar-url";
import { cn } from "@/lib/utils";

import { initials } from "@/pages/jam-session-utils";

export function JamAvatarBubble({
  name,
  avatar,
  userId,
  size = "md",
  className,
}: {
  name: string;
  avatar?: string | null;
  userId?: number | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const sizeClass = size === "sm" ? "h-9 w-9 text-xs" : "h-11 w-11 text-xs";
  const { avatarUrl, handleAvatarError } = useUserAvatarUrl(avatar, userId);
  if (avatarUrl) {
    return (
      <CrateImage
        src={avatarUrl}
        alt=""
        onError={handleAvatarError}
        className={cn(
          sizeClass,
          "jam-avatar shrink-0 rounded-full object-cover",
          className,
        )}
      />
    );
  }
  return (
    <div
      className={cn(
        sizeClass,
        "jam-avatar-fallback flex shrink-0 items-center justify-center rounded-full font-semibold",
        className,
      )}
    >
      {initials(name)}
    </div>
  );
}
