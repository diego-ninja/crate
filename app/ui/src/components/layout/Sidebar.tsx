import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router";
import {
  LayoutDashboard,
  Library,
  HeartPulse,
  BarChart3,
  Disc3,
  ShieldCheck,
  ListTodo,
  ListMusic,
  Download,
  Tag,
  Clock,
  Compass,
  Server,
  User,
  Users,
  LogOut,
  Settings,
  Sparkles,
  Calendar,
  Activity,
  AudioWaveform,
  ScrollText,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

import { VtNavLink as NavLink } from "@crate/ui/primitives/VtNavLink";
import { Badge } from "@crate/ui/shadcn/badge";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

interface SidebarProps {
  onNavigate?: () => void;
}

interface SidebarStats {
  issue_count?: number;
  pending_imports?: number;
  running_tasks?: number;
}

export const SIDEBAR_KEY = "crate-admin-sidebar-expanded";
export const SIDEBAR_EVENT = "crate-admin-sidebar-changed";
export const SIDEBAR_EXPANDED_WIDTH = 240;
export const SIDEBAR_COLLAPSED_WIDTH = 72;

export function getStoredSidebarExpanded(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== "false";
  } catch {
    return true;
  }
}

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/browse", icon: Library, label: "Browse" },
  { to: "/discover", icon: Compass, label: "Discovery" },
  { section: "Tools" },
  { to: "/health", icon: HeartPulse, label: "Library Health", badgeKey: "issue_count" as const },
  { section: "Music" },
  { to: "/upcoming", icon: Calendar, label: "Upcoming" },
  { to: "/new-releases", icon: Sparkles, label: "New Releases" },
  { to: "/playlists", icon: ListMusic, label: "System Playlists" },
  { to: "/download", icon: Download, label: "Acquisition" },
  { section: "Insights" },
  { to: "/insights", icon: BarChart3, label: "Insights" },
  { to: "/genres", icon: Tag, label: "Genres" },
  { to: "/timeline", icon: Clock, label: "Timeline" },
  { to: "/missing-albums", icon: Disc3, label: "Missing Albums" },
  { to: "/quality", icon: ShieldCheck, label: "Quality" },
  { section: "System" },
  { to: "/system", icon: Activity, label: "System Health", adminOnly: true },
  { to: "/analysis", icon: AudioWaveform, label: "Analysis", adminOnly: true },
  { to: "/tasks", icon: ListTodo, label: "Tasks", badgeKey: "running_tasks" as const, adminOnly: true },
  { to: "/logs", icon: ScrollText, label: "Logs", adminOnly: true },
  { to: "/stack", icon: Server, label: "Stack", adminOnly: true },
  { to: "/users", icon: Users, label: "Users", adminOnly: true },
  { to: "/settings", icon: Settings, label: "Settings", adminOnly: true },
] as const;

function emitSidebarExpanded(expanded: boolean) {
  try {
    localStorage.setItem(SIDEBAR_KEY, String(expanded));
    window.dispatchEvent(new CustomEvent(SIDEBAR_EVENT, { detail: { expanded } }));
  } catch {
    // ignore persistence failures
  }
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const [expanded, setExpanded] = useState(getStoredSidebarExpanded);
  const [stats, setStats] = useState<SidebarStats>({});
  const { user, isAdmin, logout } = useAuth();

  const fetchStats = useCallback(async () => {
    try {
      const [status, importStats, taskList] = await Promise.all([
        api<{ issue_count: number }>("/api/status"),
        api<{ pending_imports: number }>("/api/stats").catch(() => ({ pending_imports: 0 })),
        api<{ status: string }[]>("/api/tasks?status=running&limit=10").catch(() => []),
      ]);
      setStats({
        issue_count: status.issue_count || 0,
        pending_imports: importStats.pending_imports || 0,
        running_tasks: Array.isArray(taskList) ? taskList.length : 0,
      });
    } catch {
      // ignore transient polling failures
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    emitSidebarExpanded(next);
  }

  function navClass(isActive: boolean) {
    return isActive
      ? "bg-white/10 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
      : "text-white/42 hover:bg-white/5 hover:text-white";
  }

  const asideWidth = expanded ? "w-60" : "w-[4.5rem]";

  return (
    <aside
      className={cn(
        "z-app-sidebar fixed top-0 left-0 bottom-0 flex flex-col border-r border-white/6 bg-app-surface transition-all duration-200",
        asideWidth,
      )}
    >
      <div className="border-b border-white/6">
        <div className={cn("flex h-16 items-center", expanded ? "gap-3 px-4" : "justify-center")}>
          {expanded ? (
            <>
              <Link to="/" className="flex items-center gap-3 min-w-0">
                <img src="/assets/logo.svg" alt="Crate" className="h-8 w-8 shrink-0" />
                <div className="min-w-0 leading-tight">
                  <div className="text-sm font-bold text-white">Crate</div>
                  <div className="text-[11px] text-white/35">Admin console</div>
                </div>
              </Link>
              <button
                type="button"
                onClick={toggleExpanded}
                aria-label="Collapse sidebar"
                className="ml-auto flex h-9 w-9 items-center justify-center rounded-md text-white/30 transition-colors hover:bg-white/5 hover:text-white/70"
              >
                <PanelLeftClose size={18} />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={toggleExpanded}
              aria-label="Expand sidebar"
              className="flex h-11 w-11 items-center justify-center rounded-md border border-white/10 bg-white/5 transition-colors hover:bg-white/10"
            >
              <img src="/assets/logo.svg" alt="Crate" className="h-6 w-6" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-3">
        {navItems.map((item, index) => {
          if ("section" in item) {
            return expanded ? (
              <div
                key={`${item.section}-${index}`}
                className="px-4 pb-2 pt-5 text-[10px] font-bold uppercase tracking-[0.18em] text-white/25"
              >
                {item.section}
              </div>
            ) : (
              <div key={`${item.section}-${index}`} className="mx-4 my-3 border-t border-white/5" />
            );
          }

          if ("adminOnly" in item && item.adminOnly && !isAdmin) {
            return null;
          }

          const Icon = item.icon;
          const badgeValue = "badgeKey" in item && item.badgeKey ? stats[item.badgeKey] : undefined;

          return (
            <div key={item.to} className={cn("relative", expanded ? "px-3" : "px-2")}>
              <NavLink
                to={item.to}
                end={item.to === "/"}
                onClick={onNavigate}
                title={item.label}
                className={({ isActive }) =>
                  cn(
                    "group flex items-center gap-3 rounded-md transition-colors",
                    expanded ? "px-3 py-2.5" : "mx-auto h-11 w-11 justify-center",
                    navClass(isActive),
                  )
                }
              >
                <Icon size={18} className="shrink-0" />
                {expanded ? <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{item.label}</span> : null}
                {expanded && badgeValue != null && badgeValue > 0 ? (
                  <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                    {badgeValue}
                  </Badge>
                ) : null}
              </NavLink>

              {!expanded && badgeValue != null && badgeValue > 0 ? (
                <span className="absolute right-2 top-1 flex h-4 min-w-4 items-center justify-center rounded-md bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                  {badgeValue > 9 ? "9+" : badgeValue}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      {user ? (
        <div className="mt-auto border-t border-white/6 p-3">
          {expanded ? (
            <div className="flex items-center gap-3 rounded-md border border-white/8 bg-white/[0.03] px-3 py-3">
              <Link to="/profile" className="flex min-w-0 flex-1 items-center gap-3" onClick={onNavigate}>
                {user.avatar ? (
                  <img src={user.avatar} alt="" className="h-10 w-10 rounded-md object-cover" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-white/5 text-white/60">
                    <User size={16} />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-white">{user.name}</div>
                  <div className="mt-1">
                    <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                      {user.role}
                    </Badge>
                  </div>
                </div>
              </Link>
              <button
                type="button"
                onClick={logout}
                title="Logout"
                className="flex h-9 w-9 items-center justify-center rounded-md text-white/35 transition-colors hover:bg-white/5 hover:text-white"
              >
                <LogOut size={16} />
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Link
                to="/profile"
                onClick={onNavigate}
                className="flex h-11 w-11 items-center justify-center rounded-md border border-white/10 bg-white/5 text-white/70"
              >
                {user.avatar ? (
                  <img src={user.avatar} alt="" className="h-11 w-11 rounded-md object-cover" />
                ) : (
                  <User size={16} />
                )}
              </Link>
              <button
                type="button"
                onClick={logout}
                title="Logout"
                className="flex h-9 w-9 items-center justify-center rounded-md text-white/35 transition-colors hover:bg-white/5 hover:text-white"
              >
                <LogOut size={16} />
              </button>
            </div>
          )}
        </div>
      ) : null}

      {!expanded ? (
        <div className="flex justify-center pb-4">
          <button
            type="button"
            onClick={toggleExpanded}
            aria-label="Expand sidebar"
            className="flex h-8 w-8 items-center justify-center rounded-md text-white/20 transition-colors hover:bg-white/5 hover:text-white/50"
          >
            <PanelLeftOpen size={14} />
          </button>
        </div>
      ) : null}
    </aside>
  );
}
