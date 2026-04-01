import { useState, useRef, useEffect } from "react";
import { Outlet, NavLink, useLocation, useNavigate } from "react-router";
import {
  Home, Compass, Rss, Library, Music, Disc, Heart, Users,
  ListMusic, PanelLeftClose, PanelLeftOpen, ChevronRight, BarChart3,
} from "lucide-react";
import { useIsDesktop } from "@/hooks/use-breakpoint";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { PlayerBar } from "@/components/player/PlayerBar";
import { MiniPlayer } from "@/components/player/MiniPlayer";
import { TopBar } from "@/components/layout/TopBar";

const SIDEBAR_KEY = "listen-sidebar-expanded";

function getStoredExpanded(): boolean {
  try { return localStorage.getItem(SIDEBAR_KEY) !== "false"; } catch { return true; }
}

// ── Sidebar ─────────────────────────────────────────────────────

function Sidebar() {
  const [expanded, setExpanded] = useState(getStoredExpanded);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const collectionRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    localStorage.setItem(SIDEBAR_KEY, String(next));
  }

  // Close collection popup on outside click
  useEffect(() => {
    if (!collectionOpen) return;
    function handler(e: MouseEvent) {
      if (collectionRef.current && !collectionRef.current.contains(e.target as Node)) {
        setCollectionOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [collectionOpen]);

  const w = expanded ? "w-52" : "w-14";

  function navClass(isActive: boolean) {
    return isActive
      ? "bg-white/10 text-primary"
      : "text-white/40 hover:text-white/70 hover:bg-white/5";
  }

  return (
    <aside className={`fixed top-0 left-0 bottom-0 ${w} flex flex-col bg-[#0a0a0f] border-r border-white/5 z-50 transition-all duration-200`}>
      {/* App icon / toggle */}
      <div className={`flex items-center ${expanded ? "px-4 py-5 gap-3" : "justify-center py-5"}`}>
        {expanded ? (
          <>
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
              <span className="text-sm font-bold text-primary-foreground">C</span>
            </div>
            <span className="text-sm font-bold text-white flex-1">Crate</span>
            <button onClick={toggleExpanded} className="text-white/30 hover:text-white/60 transition-colors">
              <PanelLeftClose size={18} />
            </button>
          </>
        ) : (
          <button
            onClick={() => { toggleExpanded(); navigate("/"); }}
            className="w-10 h-10 rounded-lg flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors"
            title="Expand sidebar"
          >
            <Home size={22} />
          </button>
        )}
      </div>

      {/* Nav items */}
      <nav className={`flex flex-col gap-1 ${expanded ? "px-3" : "items-center px-1"}`}>
        {/* Home / Music */}
        <NavLink
          to="/"
          end
          title="Music"
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg transition-colors ${expanded ? "px-3 py-2" : "w-10 h-10 justify-center"} ${navClass(isActive)}`
          }
        >
          <Music size={20} />
          {expanded && <span className="text-[13px] font-medium">Music</span>}
        </NavLink>

        {/* Explore */}
        <NavLink
          to="/explore"
          title="Explore"
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg transition-colors ${expanded ? "px-3 py-2" : "w-10 h-10 justify-center"} ${navClass(isActive)}`
          }
        >
          <Compass size={20} />
          {expanded && <span className="text-[13px] font-medium">Explore</span>}
        </NavLink>

        {/* Upcoming */}
        <NavLink
          to="/upcoming"
          title="Upcoming"
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg transition-colors ${expanded ? "px-3 py-2" : "w-10 h-10 justify-center"} ${navClass(isActive)}`
          }
        >
          <Rss size={20} />
          {expanded && <span className="text-[13px] font-medium">Upcoming</span>}
        </NavLink>

        <NavLink
          to="/stats"
          title="Stats"
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg transition-colors ${expanded ? "px-3 py-2" : "w-10 h-10 justify-center"} ${navClass(isActive)}`
          }
        >
          <BarChart3 size={20} />
          {expanded && <span className="text-[13px] font-medium">Stats</span>}
        </NavLink>

        {/* Collection with popup */}
        <div className="relative" ref={collectionRef}>
          <button
            onClick={() => setCollectionOpen(!collectionOpen)}
            title="Collection"
            className={`flex items-center gap-3 rounded-lg transition-colors w-full ${expanded ? "px-3 py-2" : "w-10 h-10 justify-center"} ${collectionOpen ? "bg-white/10 text-primary" : "text-white/40 hover:text-white/70 hover:bg-white/5"}`}
          >
            <Library size={20} />
            {expanded && (
              <>
                <span className="text-[13px] font-medium flex-1 text-left">Collection</span>
                <ChevronRight size={14} className={`transition-transform ${collectionOpen ? "rotate-90" : ""}`} />
              </>
            )}
          </button>

          {collectionOpen && (
            <div className={`${expanded ? "mt-1 ml-3 border-l border-white/5 pl-3" : "absolute left-full top-0 ml-2 bg-[#12121a] border border-white/10 rounded-xl shadow-2xl py-2 w-44"}`}>
              {[
                { to: "/library?tab=playlists", icon: ListMusic, label: "Playlists" },
                { to: "/library?tab=albums", icon: Disc, label: "Albums" },
                { to: "/library?tab=liked", icon: Heart, label: "Liked Tracks" },
                { to: "/library?tab=artists", icon: Users, label: "Artists" },
              ].map(({ to, icon: Icon, label }) => (
                <button
                  key={label}
                  onClick={() => { navigate(to); setCollectionOpen(false); }}
                  className={`flex items-center gap-3 rounded-lg transition-colors w-full text-left text-white/40 hover:text-white/70 hover:bg-white/5 ${expanded ? "px-3 py-1.5" : "px-4 py-2"}`}
                >
                  <Icon size={16} />
                  <span className="text-[12px] font-medium">{label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </nav>

      {/* Bottom: collapse toggle (only in expanded mode) */}
      {!expanded && (
        <div className="mt-auto flex justify-center pb-4">
          <button onClick={toggleExpanded} className="text-white/20 hover:text-white/40 transition-colors" title="Expand">
            <PanelLeftOpen size={16} />
          </button>
        </div>
      )}
    </aside>
  );
}

// ── Mobile Bottom Nav ───────────────────────────────────────────

const MOBILE_NAV = [
  { to: "/", icon: Home, label: "Home" },
  { to: "/explore", icon: Compass, label: "Explore" },
  { to: "/library", icon: Library, label: "Library" },
  { to: "/upcoming", icon: Rss, label: "Upcoming" },
] as const;

// ── Shell ───────────────────────────────────────────────────────

export function Shell() {
  const isDesktop = useIsDesktop();
  const location = useLocation();
  const { currentTrack } = usePlayerActions();
  const hasTrack = !!currentTrack;
  const [sidebarExpanded, setSidebarExpanded] = useState(getStoredExpanded);
  const overlayHeader =
    /^\/artist\/[^/]+$/.test(location.pathname) ||
    /^\/artist\/[^/]+\/top-tracks$/.test(location.pathname) ||
    /^\/album\/[^/]+\/[^/]+$/.test(location.pathname);
  const headerOffsetClass = overlayHeader ? "" : "pt-16";
  const headerChromeClass = "bg-transparent border-transparent border-b-0 shadow-none backdrop-blur-0";

  // Sync with sidebar toggle (Sidebar writes to localStorage, we poll)
  useEffect(() => {
    const check = () => setSidebarExpanded(getStoredExpanded());
    const id = setInterval(check, 300);
    return () => clearInterval(id);
  }, []);

  const sidebarW = sidebarExpanded ? "ml-52" : "ml-14";

  if (isDesktop) {
      return (
      <div className="flex min-h-screen bg-[#0a0a0f]">
        <Sidebar />

        <div
          className={`fixed top-0 ${sidebarW} right-0 z-30 transition-all duration-200 ${headerChromeClass}`}
        >
          <TopBar />
        </div>

        <main className={`flex-1 ${sidebarW} overflow-x-hidden transition-all duration-200 ${hasTrack ? "pb-[80px]" : ""}`}>
          <div className={`p-6 ${headerOffsetClass}`}>
            <Outlet />
          </div>
        </main>

        <PlayerBar />
      </div>
    );
  }

  // Mobile layout
  return (
    <div className="flex flex-col min-h-screen bg-[#0a0a0f]">
      <div className={`fixed top-0 left-0 right-0 z-30 ${headerChromeClass}`}>
        <TopBar />
      </div>

      <main className={`flex-1 overflow-x-hidden ${hasTrack ? "pb-[116px]" : "pb-16"}`}>
        <div className={`p-4 ${headerOffsetClass}`}>
          <Outlet />
        </div>
      </main>

      <div className="fixed bottom-0 left-0 right-0 z-50">
        <MiniPlayer />
        <nav className="h-16 bg-[#0a0a0f] border-t border-white/5 flex items-center justify-around px-2">
          {MOBILE_NAV.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 py-1 px-3 transition-colors ${isActive ? "text-cyan-400" : "text-white/40 hover:text-white/70"}`
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
