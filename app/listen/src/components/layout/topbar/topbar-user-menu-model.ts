import type { TFunction } from "i18next";
import type { NavigateFunction } from "react-router";

import {
  BarChart3,
  LogOut,
  Settings,
  Upload,
  User,
  UserPlus,
  Users,
} from "@crate/ui/icons";
import type { ContextMenuEntry } from "@/components/actions/ItemActionMenu";

export function buildUserMenuItems({
  isDesktop,
  onSuggestArtist,
  profilePath,
  navigate,
  logout,
  t,
}: {
  isDesktop: boolean;
  onSuggestArtist: () => void;
  profilePath: string;
  navigate: NavigateFunction;
  logout: () => Promise<void> | void;
  t: TFunction;
}): ContextMenuEntry[] {
  const go = (path: string) => navigate(path);
  return [
    {
      key: "profile",
      label: t("userMenu.profile"),
      icon: User,
      onSelect: () => go(profilePath),
    },
    {
      key: "people",
      label: t("userMenu.people"),
      icon: Users,
      onSelect: () => go("/people"),
    },
    {
      key: "upload",
      label: t("userMenu.uploadMusic"),
      icon: Upload,
      onSelect: () => go("/upload"),
    },
    {
      key: "suggest-artist",
      label: t("userMenu.suggestArtist"),
      icon: UserPlus,
      onSelect: onSuggestArtist,
    },
    ...(isDesktop
      ? [
          {
            key: "stats",
            label: t("userMenu.stats"),
            icon: BarChart3,
            onSelect: () => go("/stats"),
          } satisfies ContextMenuEntry,
        ]
      : []),
    {
      key: "settings",
      label: t("userMenu.settings"),
      icon: Settings,
      onSelect: () => go("/settings"),
    },
    { type: "divider", key: "account-divider" },
    {
      key: "logout",
      label: t("userMenu.signOut"),
      icon: LogOut,
      danger: true,
      onSelect: () => {
        void logout();
      },
    },
  ];
}
