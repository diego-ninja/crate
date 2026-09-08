import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

import { User } from "@crate/ui/icons";
import {
  ContextMenu,
  useItemActionMenu,
} from "@/components/actions/ItemActionMenu";
import { useAuth } from "@/contexts/AuthContext";
import { useUserAvatarUrl } from "@/hooks/use-user-avatar-url";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";

import { ArtistSuggestionModal } from "./ArtistSuggestionModal";
import { UserMenuAvatarButton } from "./UserMenuAvatarButton";
import { buildUserMenuItems } from "./topbar-user-menu-model";
import { useArtistSuggestionController } from "./use-artist-suggestion-controller";

export function TopBarUserMenu() {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const { user, logout } = useAuth();
  const { t } = useTranslation();
  const suggestion = useArtistSuggestionController();
  const userName = user?.name || user?.email || null;
  const userInitial = userName ? userName.charAt(0).toUpperCase() : null;
  const profilePath = user?.username ? `/users/${user.username}` : "/settings";
  const { avatarUrl, handleAvatarError } = useUserAvatarUrl(
    user?.avatar,
    user?.id,
  );
  const menuItems = buildUserMenuItems({
    isDesktop,
    onSuggestArtist: suggestion.openModal,
    profilePath,
    navigate,
    logout,
    t,
  });
  const actionMenu = useItemActionMenu(menuItems);

  return (
    <>
      <UserMenuAvatarButton
        actionMenu={actionMenu}
        avatarUrl={avatarUrl}
        handleAvatarError={handleAvatarError}
        initial={userInitial}
        userMenuLabel={t("userMenu.label")}
      />
      <ContextMenu
        header={{
          type: "media",
          title: userName || t("userMenu.signedIn"),
          subtitle: user?.email ?? undefined,
          imageUrl: avatarUrl,
          imageAlt: userName || t("userMenu.userImageAlt"),
          imageOnError: handleAvatarError,
          imageShape: "circle",
          fallbackIcon: User,
        }}
        items={menuItems}
        open={actionMenu.open}
        position={actionMenu.position}
        menuRef={actionMenu.menuRef}
        onClose={actionMenu.close}
      />
      <ArtistSuggestionModal controller={suggestion} />
    </>
  );
}
