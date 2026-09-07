import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

import { BandcampLogo } from "@crate/ui/domain/brand/BandcampLogo";
import {
  Activity,
  ChevronRight,
  Collection,
  CRATE_ICON_SIZE,
  Disc,
  Heart,
  ListMusic,
  Music,
  PanelLeftOpen,
  Radar,
  Search,
  Users,
} from "@crate/ui/icons";
import { VtNavLink as NavLink } from "@crate/ui/primitives/VtNavLink";

interface SidebarNavigationProps {
  expanded: boolean;
  onToggleExpanded: () => void;
}

const COLLECTION_ITEMS = [
  {
    to: "/library?tab=playlists",
    icon: ListMusic,
    labelKey: "nav.collection.playlists",
  },
  {
    to: "/library?tab=albums",
    icon: Disc,
    labelKey: "nav.collection.albums",
  },
  {
    to: "/library?tab=liked",
    icon: Heart,
    labelKey: "nav.collection.likedTracks",
  },
  {
    to: "/library?tab=artists",
    icon: Users,
    labelKey: "nav.collection.artists",
  },
  {
    to: "/bandcamp",
    icon: BandcampLogo,
    labelKey: "nav.collection.bandcamp",
  },
] as const;

export function SidebarNavigation({
  expanded,
  onToggleExpanded,
}: SidebarNavigationProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [collectionOpen, setCollectionOpen] = useState(false);
  const collectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!collectionOpen) return;
    function handler(event: MouseEvent) {
      if (
        collectionRef.current &&
        !collectionRef.current.contains(event.target as Node)
      ) {
        setCollectionOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [collectionOpen]);

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-lg transition-colors ${
      expanded ? "px-3 py-2" : "h-10 w-10 justify-center"
    } ${
      isActive
        ? "text-accent-action drop-shadow-accent-action"
        : "text-text-muted hover:text-accent-action hover:drop-shadow-accent-action"
    }`;

  return (
    <>
      <nav
        className={`flex flex-col gap-1 ${
          expanded ? "px-3" : "items-center px-1"
        }`}
      >
        <NavLink to="/" end title={t("nav.music")} className={navLinkClass}>
          <Music size={CRATE_ICON_SIZE.nav} />
          {expanded && (
            <span className="text-[0.8125rem] font-medium">
              {t("nav.music")}
            </span>
          )}
        </NavLink>
        <NavLink
          to="/explore"
          title={t("nav.explore")}
          className={navLinkClass}
        >
          <Search size={CRATE_ICON_SIZE.nav} />
          {expanded && (
            <span className="text-[0.8125rem] font-medium">
              {t("nav.explore")}
            </span>
          )}
        </NavLink>
        <NavLink to="/upcoming" title={t("nav.radar")} className={navLinkClass}>
          <Radar size={CRATE_ICON_SIZE.nav} />
          {expanded && (
            <span className="text-[0.8125rem] font-medium">
              {t("nav.radar")}
            </span>
          )}
        </NavLink>
        <NavLink to="/stats" title={t("nav.stats")} className={navLinkClass}>
          <Activity size={CRATE_ICON_SIZE.nav} />
          {expanded && (
            <span className="text-[0.8125rem] font-medium">
              {t("nav.stats")}
            </span>
          )}
        </NavLink>

        <div className="relative" ref={collectionRef}>
          <button
            onClick={() => setCollectionOpen(!collectionOpen)}
            title={t("nav.collection")}
            className={`flex w-full items-center gap-3 rounded-lg transition-colors ${
              expanded ? "px-3 py-2" : "h-10 w-10 justify-center"
            } ${
              collectionOpen
                ? "text-accent-action drop-shadow-accent-action"
                : "text-text-muted hover:text-accent-action hover:drop-shadow-accent-action"
            }`}
          >
            <Collection size={CRATE_ICON_SIZE.nav} />
            {expanded && (
              <>
                <span className="flex-1 text-left text-[0.8125rem] font-medium">
                  {t("nav.collection")}
                </span>
                <ChevronRight
                  size={CRATE_ICON_SIZE.sm}
                  className={`transition-transform ${
                    collectionOpen ? "rotate-90" : ""
                  }`}
                />
              </>
            )}
          </button>

          {collectionOpen && (
            <div
              className={`animate-submenu-in ${
                expanded
                  ? "mt-1 ml-3 border-l border-border-quiet pl-3"
                  : "absolute top-0 left-full ml-2 w-44 rounded-xl border border-border-quiet bg-surface-elevated py-2 shadow-menu"
              }`}
            >
              {COLLECTION_ITEMS.map(({ to, icon: Icon, labelKey }) => (
                <button
                  key={to}
                  onClick={() => {
                    navigate(to);
                    setCollectionOpen(false);
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg text-left text-text-muted transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action ${
                    expanded ? "px-3 py-1.5" : "px-4 py-2"
                  }`}
                >
                  <Icon size={17} />
                  <span className="text-[0.75rem] font-medium">
                    {t(labelKey)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </nav>

      {!expanded && (
        <div className="mt-auto flex justify-center pb-4">
          <button
            onClick={onToggleExpanded}
            aria-label={t("nav.sidebar.expand")}
            className="text-text-faint transition-[color,filter,transform] hover:-translate-y-px hover:text-accent-action hover:drop-shadow-accent-action"
          >
            <PanelLeftOpen size={CRATE_ICON_SIZE.nav} />
          </button>
        </div>
      )}
    </>
  );
}
