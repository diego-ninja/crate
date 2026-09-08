import { CrateImage } from "@/components/artwork/CrateImage";
import { useUserAvatarUrl } from "@/hooks/use-user-avatar-url";

export function UserProfileAvatar({
  name,
  avatar,
  userId,
  className = " size-20",
}: {
  name: string;
  avatar?: string | null;
  userId?: number | null;
  className?: string;
}) {
  const { avatarUrl, handleAvatarError } = useUserAvatarUrl(avatar, userId);
  if (avatarUrl) {
    return (
      <CrateImage
        src={avatarUrl}
        alt={name}
        onError={handleAvatarError}
        className={className + " rounded-full object-cover"}
      />
    );
  }
  const initial = name.trim().charAt(0).toUpperCase() || "U";
  return (
    <div
      className={
        className +
        " user-profile-avatar-placeholder flex items-center justify-center rounded-full text-2xl font-semibold"
      }
    >
      {initial}
    </div>
  );
}
