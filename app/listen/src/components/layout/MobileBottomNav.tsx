import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

import {
  AppMenuButton,
  AppPopoverDivider,
} from "@crate/ui/primitives/AppPopover";
import { MobileActionSheet } from "@crate/ui/domain/actions";
import { BandcampLogo } from "@crate/ui/domain/brand/BandcampLogo";
import {
  Collection,
  CRATE_ICON_SIZE,
  Disc,
  Heart,
  Home,
  ListMusic,
  Radar,
  Search,
  Upload,
  Users,
} from "@crate/ui/icons";
import { VtNavLink as NavLink } from "@crate/ui/primitives/VtNavLink";

const MOBILE_NAV = [
  { to: "/", icon: Home, labelKey: "nav.home" },
  { to: "/explore", icon: Search, labelKey: "nav.explore" },
  { to: "/upcoming", icon: Radar, labelKey: "nav.radar" },
] as const;

const COLLECTION_SECTIONS = [
  {
    to: "/collection/playlists",
    icon: ListMusic,
    labelKey: "nav.collection.playlists",
  },
  {
    to: "/collection/artists",
    icon: Users,
    labelKey: "nav.collection.artists",
  },
  { to: "/collection/albums", icon: Disc, labelKey: "nav.collection.albums" },
  {
    to: "/collection/liked",
    icon: Heart,
    labelKey: "nav.collection.likedTracks",
  },
  {
    to: "/collection/bandcamp",
    icon: BandcampLogo,
    labelKey: "nav.collection.bandcamp",
  },
  {
    to: "/collection/contributions",
    icon: Upload,
    labelKey: "nav.collection.contributions",
  },
] as const;

interface MobileBottomNavProps {
  collectionActive: boolean;
  hasTrack: boolean;
}

function getMobileNavLinkClass(isActive: boolean) {
  return `flex min-h-14 min-w-0 flex-1 touch-manipulation flex-col items-center justify-center gap-1 px-1.5 py-1.5 transition-[color,filter,transform] active:scale-[0.97] ${
    isActive
      ? "text-accent-action drop-shadow-accent-action"
      : "text-text-muted hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action"
  }`;
}

export function MobileBottomNav({
  collectionActive,
  hasTrack,
}: MobileBottomNavProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [collectionSheetOpen, setCollectionSheetOpen] = useState(false);

  return (
    <>
      <nav
        className={`z-app-player fixed isolate flex items-center justify-around overflow-visible bg-transparent px-1.5 ${
          hasTrack ? "rounded-b-[12px] border-t-0" : "rounded-[12px]"
        }`}
        style={{
          bottom:
            "calc(var(--listen-safe-bottom) + var(--listen-mobile-bottom-dock-inset))",
          left: "max(1rem, var(--listen-safe-left))",
          right: "max(1rem, var(--listen-safe-right))",
          height: "var(--listen-mobile-bottom-nav-content-height)",
        }}
      >
        {MOBILE_NAV.slice(0, 2).map(({ to, icon: Icon, labelKey }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) => getMobileNavLinkClass(isActive)}
          >
            <Icon size={CRATE_ICON_SIZE.navMobile} />
            <span className="max-w-full truncate text-[0.59375rem] leading-none">
              {t(labelKey)}
            </span>
          </NavLink>
        ))}
        <button
          type="button"
          aria-label={t("nav.collection")}
          onClick={() => setCollectionSheetOpen(true)}
          className={`flex min-h-14 min-w-0 flex-1 touch-manipulation flex-col items-center justify-center gap-1 p-1.5 transition-[color,filter,transform] active:scale-[0.97] ${
            collectionActive
              ? "text-accent-action drop-shadow-accent-action"
              : "text-text-muted hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action"
          }`}
        >
          <Collection size={CRATE_ICON_SIZE.navMobile} />
          <span className="max-w-full truncate text-[0.59375rem] leading-none">
            {t("nav.collection")}
          </span>
        </button>
        {MOBILE_NAV.slice(2).map(({ to, icon: Icon, labelKey }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) => getMobileNavLinkClass(isActive)}
          >
            <Icon size={CRATE_ICON_SIZE.navMobile} />
            <span className="max-w-full truncate text-[0.59375rem] leading-none">
              {t(labelKey)}
            </span>
          </NavLink>
        ))}
      </nav>

      <MobileActionSheet
        open={collectionSheetOpen}
        onClose={() => setCollectionSheetOpen(false)}
      >
        <div
          role="menu"
          className="max-h-[calc(100%-5rem)] overflow-y-auto pb-3"
        >
          <div className="px-4 pb-2 pt-2">
            <h2 className="text-base font-semibold text-text-primary">
              {t("nav.collection")}
            </h2>
          </div>
          <AppPopoverDivider className="mx-2" />
          <div className="p-1.5">
            {COLLECTION_SECTIONS.map(({ to, icon: Icon, labelKey }) => (
              <AppMenuButton
                key={to}
                role="menuitem"
                onClick={() => {
                  navigate(to);
                  setCollectionSheetOpen(false);
                }}
                className="group"
              >
                <Icon
                  size={CRATE_ICON_SIZE.md}
                  className="text-text-secondary transition-colors group-hover:text-accent-action"
                />
                <span className="text-sm font-semibold">{t(labelKey)}</span>
              </AppMenuButton>
            ))}
          </div>
        </div>
      </MobileActionSheet>
    </>
  );
}
