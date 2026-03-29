import { Outlet, NavLink } from "react-router";
import { Home, Compass, Library, Radio } from "lucide-react";
import { useIsDesktop } from "@/hooks/use-breakpoint";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { PlayerBar } from "@/components/player/PlayerBar";
import { MiniPlayer } from "@/components/player/MiniPlayer";
import { TopBar } from "@/components/layout/TopBar";

const NAV_ITEMS = [
  { to: "/", icon: Home, label: "Home" },
  { to: "/explore", icon: Compass, label: "Explore" },
  { to: "/library", icon: Library, label: "Library" },
  { to: "/shows", icon: Radio, label: "Shows" },
] as const;

function navClass(isActive: boolean) {
  return isActive ? "text-cyan-400" : "text-white/40 hover:text-white/70";
}

export function Shell() {
  const isDesktop = useIsDesktop();
  const { currentTrack } = usePlayerActions();
  const hasTrack = !!currentTrack;

  if (isDesktop) {
    return (
      <div className="flex min-h-screen bg-[#0a0a0f]">
        {/* Desktop sidebar — icons only */}
        <aside className="fixed top-0 left-0 bottom-0 w-14 flex flex-col items-center py-6 gap-6 bg-[#0a0a0f] border-r border-white/5 z-50">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              title={label}
              className={({ isActive }) =>
                `w-10 h-10 flex items-center justify-center rounded-lg transition-colors ${navClass(isActive)}`
              }
            >
              <Icon size={22} />
            </NavLink>
          ))}
        </aside>

        {/* Main content */}
        <main
          className={`flex-1 ml-14 overflow-x-hidden ${hasTrack ? "pb-16" : ""}`}
        >
          <TopBar />
          <div className="p-6">
            <Outlet />
          </div>
        </main>

        {/* Desktop player bar */}
        <PlayerBar />
      </div>
    );
  }

  // Mobile layout
  return (
    <div className="flex flex-col min-h-screen bg-[#0a0a0f]">
      {/* Scrollable content */}
      <main
        className={`flex-1 overflow-x-hidden ${hasTrack ? "pb-[116px]" : "pb-16"}`}
      >
        <TopBar />
        <div className="p-4">
          <Outlet />
        </div>
      </main>

      {/* Fixed bottom: mini player + tabs */}
      <div className="fixed bottom-0 left-0 right-0 z-50">
        {/* Mini player */}
        <MiniPlayer />

        {/* Bottom tab bar */}
        <nav className="h-16 bg-[#0a0a0f] border-t border-white/5 flex items-center justify-around px-2">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 py-1 px-3 transition-colors ${navClass(isActive)}`
              }
            >
              <Icon size={20} />
              <span className="text-[10px]">{label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
