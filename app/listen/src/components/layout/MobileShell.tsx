import { Outlet } from "react-router";

import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { PlayerBar } from "@/components/player/PlayerBar";
import { TopBar } from "@/components/layout/TopBar";

interface MobileShellProps {
  collectionActive: boolean;
  hasTrack: boolean;
  homeMobileOverlay: boolean;
  homePage: boolean;
  mobileContentPadClass: string;
  overlayHeader: boolean;
  headerChromeClass: string;
}

export function MobileShell({
  collectionActive,
  hasTrack,
  homeMobileOverlay,
  homePage,
  mobileContentPadClass,
  overlayHeader,
  headerChromeClass,
}: MobileShellProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface-canvas">
      <div
        data-testid="listen-header"
        data-home-overlay={String(homeMobileOverlay)}
        className={`z-app-header fixed top-0 left-0 right-0 ${
          overlayHeader || homeMobileOverlay
            ? "bg-transparent"
            : headerChromeClass
        }`}
        style={{ paddingTop: "var(--listen-safe-top)" }}
      >
        <TopBar hideMobileActions={overlayHeader} />
      </div>
      <main
        className="relative z-0 flex-1 overflow-x-hidden"
        style={{
          paddingBottom: hasTrack
            ? "var(--listen-mobile-bottom-clearance)"
            : "var(--listen-mobile-bottom-clearance-no-player)",
        }}
      >
        <div
          data-testid="listen-content"
          className={`mx-auto w-full ${
            homePage ? "max-w-none" : "max-w-[1480px]"
          } ${mobileContentPadClass}`}
          style={{
            paddingLeft: homePage ? 0 : "max(1rem, var(--listen-safe-left))",
            paddingRight: homePage ? 0 : "max(1rem, var(--listen-safe-right))",
          }}
        >
          <Outlet />
        </div>
      </main>
      <div
        aria-hidden="true"
        className="listen-glass-panel listen-mobile-dock-glass pointer-events-none fixed z-20 rounded-[12px]"
        style={{
          height: hasTrack
            ? "calc(var(--listen-mobile-player-height) + var(--listen-mobile-bottom-nav-content-height))"
            : "var(--listen-mobile-bottom-nav-content-height)",
          bottom:
            "calc(var(--listen-safe-bottom) + var(--listen-mobile-bottom-dock-inset))",
          left: "max(1rem, var(--listen-safe-left))",
          right: "max(1rem, var(--listen-safe-right))",
        }}
      />
      <PlayerBar />
      <MobileBottomNav
        collectionActive={collectionActive}
        hasTrack={hasTrack}
      />
    </div>
  );
}
