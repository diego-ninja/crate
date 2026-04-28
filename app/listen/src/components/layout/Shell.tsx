import { useState, useRef, useEffect, useMemo } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { VtNavLink as NavLink } from "@crate/ui/primitives/VtNavLink";
import {
  Home, Compass, Rss, Library, Music, Disc, Heart, Users, User,
  ListMusic, PanelLeftClose, PanelLeftOpen, ChevronRight, BarChart3,
} from "lucide-react";
import { useIsDesktop } from "@crate/ui/lib/use-breakpoint";
import { usePlayer, usePlayerActions } from "@/contexts/PlayerContext";
import { PlayerBar } from "@/components/player/PlayerBar";
import { TopBar } from "@/components/layout/TopBar";
import { useAudioVisualizer } from "@/hooks/use-audio-visualizer";

const SIDEBAR_KEY = "listen-sidebar-expanded";
const SIDEBAR_EVENT = "listen-sidebar-changed";

function getStoredExpanded(): boolean {
  try { return localStorage.getItem(SIDEBAR_KEY) !== "false"; } catch { return true; }
}

// ── Sidebar ─────────────────────────────────────────────────────

function Sidebar() {
  const [expanded, setExpanded] = useState(getStoredExpanded);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const collectionRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { isPlaying, playSource, currentTrack, analyserVersion } = usePlayer();
  const discoveryRadioActive = isPlaying && playSource?.radio?.seedType === "discovery";
  const { frequenciesDb } = useAudioVisualizer(
    discoveryRadioActive,
    `sidebar:${currentTrack?.id ?? "none"}:${analyserVersion}`,
  );
  const discoveryGlowStrength = useMemo(() => {
    if (!discoveryRadioActive) return 0;
    if (!frequenciesDb.length) return 0.42;
    const bins = frequenciesDb.slice(2, 28);
    if (!bins.length) return 0.42;
    const energy =
      bins.reduce((sum, db) => {
        const normalized = Math.max(0, Math.min(1, (db + 88) / 60));
        return sum + normalized * normalized;
      }, 0) / bins.length;
    return Math.min(1, Math.sqrt(energy));
  }, [discoveryRadioActive, frequenciesDb]);

  function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    localStorage.setItem(SIDEBAR_KEY, String(next));
    window.dispatchEvent(new CustomEvent(SIDEBAR_EVENT, { detail: { expanded: next } }));
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
    <aside className={`z-app-sidebar fixed top-0 left-0 bottom-0 ${w} flex flex-col border-r border-white/5 bg-app-surface transition-all duration-200`}>
      {/* App icon / toggle */}
      <div className={`flex items-center ${expanded ? "px-4 py-5 gap-3" : "justify-center py-5"}`}>
        {expanded ? (
          <>
            <div className="relative shrink-0">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-[-10px] rounded-[22px] bg-[radial-gradient(circle,rgba(34,211,238,0.34)_0%,rgba(45,212,191,0.18)_32%,rgba(14,165,233,0.08)_54%,transparent_72%)] blur-md transition-[opacity,filter] duration-300"
                style={{
                  opacity: discoveryRadioActive ? 0.22 + discoveryGlowStrength * 0.68 : 0,
                  filter: `blur(${12 + discoveryGlowStrength * 8}px)`,
                }}
              />
              <img
                src="/icons/logo.svg"
                alt="Crate"
                className="relative z-10 h-8 w-8 shrink-0 transition-[filter] duration-300"
                style={{
                  filter: discoveryRadioActive
                    ? `drop-shadow(0 0 ${10 + discoveryGlowStrength * 16}px rgba(34,211,238,${0.18 + discoveryGlowStrength * 0.24}))`
                    : "none",
                }}
              />
            </div>
            <span
              className={`text-sm font-bold flex-1 transition-[color,text-shadow] duration-300 ${discoveryRadioActive ? "text-cyan-50" : "text-white"}`}
              style={{
                textShadow: discoveryRadioActive
                  ? `0 0 ${8 + discoveryGlowStrength * 10}px rgba(34,211,238,${0.12 + discoveryGlowStrength * 0.18})`
                  : "none",
              }}
            >
              Crate
            </span>
            <button onClick={toggleExpanded} aria-label="Collapse sidebar" className="text-white/30 hover:text-white/60 transition-colors">
              <PanelLeftClose size={18} />
            </button>
          </>
        ) : (
          <button
            onClick={() => { toggleExpanded(); navigate("/"); }}
            className="relative h-10 w-10 rounded-lg flex items-center justify-center hover:bg-white/5 transition-colors"
            aria-label="Expand sidebar"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-[-6px] rounded-[18px] bg-[radial-gradient(circle,rgba(34,211,238,0.32)_0%,rgba(45,212,191,0.14)_40%,transparent_72%)] blur-md transition-[opacity,filter] duration-300"
              style={{
                opacity: discoveryRadioActive ? 0.2 + discoveryGlowStrength * 0.64 : 0,
                filter: `blur(${10 + discoveryGlowStrength * 7}px)`,
              }}
            />
            <img
              src="/icons/logo.svg"
              alt="Crate"
              className="relative z-10 h-6 w-6 transition-[filter] duration-300"
              style={{
                filter: discoveryRadioActive
                  ? `drop-shadow(0 0 ${8 + discoveryGlowStrength * 14}px rgba(34,211,238,${0.16 + discoveryGlowStrength * 0.22}))`
                  : "none",
              }}
            />
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
            <div className={`animate-submenu-in ${expanded ? "mt-1 ml-3 border-l border-white/5 pl-3" : "absolute left-full top-0 ml-2 w-44 rounded-xl border border-white/10 bg-raised-surface py-2 shadow-2xl"}`}>
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
          <button onClick={toggleExpanded} aria-label="Expand sidebar" className="text-white/20 hover:text-white/40 transition-colors">
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
  { to: "/stats", icon: BarChart3, label: "Stats" },
  { to: "/upcoming", icon: Rss, label: "Upcoming" },
  { to: "/settings", icon: User, label: "Profile" },
] as const;

// ── Shell ───────────────────────────────────────────────────────

export function Shell() {
  const isDesktop = useIsDesktop();
  const location = useLocation();
  const { currentTrack } = usePlayerActions();
  const hasTrack = !!currentTrack;
  const [sidebarExpanded, setSidebarExpanded] = useState(getStoredExpanded);
  const overlayHeader =
    /^\/artists\/[^/]+$/.test(location.pathname) ||
    /^\/artists\/[^/]+\/[^/]+$/.test(location.pathname) ||
    /^\/artists\/[^/]+\/[^/]+\/top-tracks$/.test(location.pathname) ||
    /^\/albums\/[^/]+\/[^/]+$/.test(location.pathname);
  const headerOffsetClass = overlayHeader ? "" : "pt-16";
  const desktopContentPadClass = overlayHeader ? "pt-0 pb-6" : "py-6";
  const mobileContentPadClass = overlayHeader
    ? "pt-0 pb-4"
    : "py-4 pt-[calc(4rem+env(safe-area-inset-top,0px))]";
  const headerChromeClass =
    "border-b border-white/6 bg-app-surface/68 shadow-[0_12px_32px_rgba(0,0,0,0.18)] backdrop-blur-xl";

  // Sync with sidebar toggle without polling localStorage.
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

  const sidebarW = sidebarExpanded ? "ml-52" : "ml-14";
  const sidebarLeft = sidebarExpanded ? "left-52" : "left-14";

  if (isDesktop) {
      return (
      <div className="flex min-h-screen bg-app-surface">
        <Sidebar />

        <div
          className={`z-app-header fixed top-0 ${sidebarLeft} right-0 transition-all duration-200 ${headerChromeClass}`}
        >
          <TopBar />
        </div>

        <main className={`relative z-0 flex-1 ${sidebarW} overflow-x-hidden transition-all duration-200 ${hasTrack ? "pb-[90px]" : ""}`}>
          <div className={`mx-auto w-full max-w-[1440px] ${desktopContentPadClass} ${sidebarExpanded ? "px-6" : "px-10"} transition-all duration-200 ${headerOffsetClass}`}>
            <Outlet />
          </div>
        </main>

        <PlayerBar />
      </div>
    );
  }

  // Mobile layout
  // Bottom nav height: 64px + safe area. PlayerBar: 82px floating at bottom-3 (12px).
  // Total clearance needed: 64px nav + 82px player + 12px gap + safe area ≈ 170px when track present.
  const mobileBottomPad = hasTrack ? "pb-[170px]" : "pb-20";

  return (
    <div className="flex min-h-screen flex-col bg-app-surface">
      <div
        className={`z-app-header fixed top-0 left-0 right-0 ${headerChromeClass}`}
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <TopBar />
      </div>

      <main className={`relative z-0 flex-1 overflow-x-hidden ${mobileBottomPad}`}>
        <div className={`mx-auto w-full max-w-[1440px] px-[max(1rem,env(safe-area-inset-left))] ${mobileContentPadClass}`}>
          <Outlet />
        </div>
      </main>

      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-20 bg-app-surface"
        style={{
          height: hasTrack
            ? "calc(64px + env(safe-area-inset-bottom, 0px) + 82px + 20px)"
            : "calc(64px + env(safe-area-inset-bottom, 0px))",
        }}
      />

      <PlayerBar />

      <nav className="z-app-player fixed bottom-0 left-0 right-0 isolate flex items-center justify-around border-t border-white/5 bg-app-surface px-2" style={{ paddingBottom: "max(0px, env(safe-area-inset-bottom))", height: "calc(64px + env(safe-area-inset-bottom, 0px))", contain: "paint" }}>
        {MOBILE_NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
  
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 py-1 px-3 transition-colors ${isActive ? "text-primary" : "text-white/40 hover:text-white/70"}`
            }
          >
            <Icon size={20} />
            <span className="text-[10px]">{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
