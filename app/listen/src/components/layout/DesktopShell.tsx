import { Outlet } from "react-router";

import { PlayerBar } from "@/components/player/PlayerBar";
import { Sidebar } from "@/components/layout/sidebar/Sidebar";
import { TopBar } from "@/components/layout/TopBar";

interface DesktopShellProps {
  desktopContentPadClass: string;
  desktopOverlayHeader: boolean;
  hasTrack: boolean;
  headerOffsetClass: string;
  homeDesktopOverlay: boolean;
  overlayHeader: boolean;
  sidebarLeft: string;
  sidebarW: string;
}

export function DesktopShell({
  desktopContentPadClass,
  desktopOverlayHeader,
  hasTrack,
  headerOffsetClass,
  homeDesktopOverlay,
  overlayHeader,
  sidebarLeft,
  sidebarW,
}: DesktopShellProps) {
  return (
    <div className="flex min-h-dvh bg-surface-canvas">
      <Sidebar />
      <div
        data-testid="listen-header"
        data-home-overlay={String(homeDesktopOverlay)}
        className={`z-app-header fixed top-0 ${sidebarLeft} right-0 transition-all duration-200 ${
          desktopOverlayHeader
            ? "bg-transparent"
            : "border-b border-border-quiet bg-surface-chrome shadow-chrome backdrop-blur-xl"
        }`}
      >
        {desktopOverlayHeader && (
          <div
            aria-hidden="true"
            className="listen-home-top-scrim pointer-events-none absolute inset-x-0 top-0 h-24"
          />
        )}
        <div className="relative z-10">
          <TopBar hideMobileActions={overlayHeader} />
        </div>
      </div>
      <main
        className={`relative z-0 flex-1 ${sidebarW} overflow-x-hidden transition-all duration-200 ${
          hasTrack ? "pb-[90px]" : ""
        }`}
      >
        <div
          data-testid="listen-content"
          className={`mx-auto w-full ${desktopContentPadClass} ${
            homeDesktopOverlay ? "max-w-[1480px] px-0" : "max-w-[1480px] px-6"
          } transition-all duration-200 ${headerOffsetClass}`}
        >
          <Outlet />
        </div>
      </main>
      <PlayerBar />
    </div>
  );
}
