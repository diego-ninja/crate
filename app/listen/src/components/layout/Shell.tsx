import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";

import { usePlayerActions } from "@/contexts/PlayerContext";
import { DesktopShell } from "@/components/layout/DesktopShell";
import { MobileShell } from "@/components/layout/MobileShell";
import {
  SIDEBAR_EVENT,
  SIDEBAR_KEY,
  getStoredExpanded,
} from "@/components/layout/sidebar/sidebar-model";
import { isReservedArtistChildSlug } from "@/lib/library-routes";

function hasOverlayHeader(pathname: string, search = "") {
  if (pathname === "/explore" && new URLSearchParams(search).has("genre")) {
    return true;
  }
  if (
    /^\/artists\/[^/]+$/.test(pathname) ||
    /^\/albums\/[^/]+\/[^/]+$/.test(pathname) ||
    /^\/playlist\/[^/]+$/.test(pathname) ||
    /^\/curation\/playlist\/[^/]+$/.test(pathname) ||
    /^\/home\/playlist\/[^/]+$/.test(pathname)
  ) {
    return true;
  }
  const artistChildMatch = pathname.match(/^\/artists\/([^/]+)\/([^/]+)$/);
  if (!artistChildMatch) return false;
  const childSlug = artistChildMatch[2];
  return !isReservedArtistChildSlug(childSlug);
}

export function Shell() {
  const isDesktop = useIsDesktop();
  const location = useLocation();
  const { currentTrack } = usePlayerActions();
  const hasTrack = !!currentTrack;
  const [sidebarExpanded, setSidebarExpanded] = useState(getStoredExpanded);
  const overlayHeader = hasOverlayHeader(location.pathname, location.search);
  const homePage = location.pathname === "/";
  const homeDesktopOverlay = isDesktop && homePage;
  const homeMobileOverlay = !isDesktop && homePage;
  const desktopOverlayHeader = overlayHeader || homeDesktopOverlay;
  const collectionActive =
    location.pathname === "/library" ||
    location.pathname.startsWith("/collection");
  const headerOffsetClass = desktopOverlayHeader ? "" : "pt-24";
  const desktopContentPadClass = desktopOverlayHeader ? "pt-0 pb-6" : "py-6";
  const mobileContentPadClass =
    overlayHeader || homeMobileOverlay
      ? "pt-0 pb-4"
      : "py-4 pt-[var(--listen-mobile-page-top)]";
  const headerChromeClass =
    "border-b border-border-quiet bg-surface-chrome shadow-chrome backdrop-blur-xl";

  useEffect(() => {
    const sync = () => setSidebarExpanded(getStoredExpanded());
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === SIDEBAR_KEY) sync();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(SIDEBAR_EVENT, sync as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(SIDEBAR_EVENT, sync as EventListener);
    };
  }, []);

  if (isDesktop) {
    return (
      <DesktopShell
        desktopContentPadClass={desktopContentPadClass}
        desktopOverlayHeader={desktopOverlayHeader}
        hasTrack={hasTrack}
        headerOffsetClass={headerOffsetClass}
        homeDesktopOverlay={homeDesktopOverlay}
        overlayHeader={overlayHeader}
        sidebarLeft={sidebarExpanded ? "left-52" : "left-14"}
        sidebarW={sidebarExpanded ? "ml-52" : "ml-14"}
      />
    );
  }

  return (
    <MobileShell
      collectionActive={collectionActive}
      hasTrack={hasTrack}
      headerChromeClass={headerChromeClass}
      homeMobileOverlay={homeMobileOverlay}
      homePage={homePage}
      mobileContentPadClass={mobileContentPadClass}
      overlayHeader={overlayHeader}
    />
  );
}
