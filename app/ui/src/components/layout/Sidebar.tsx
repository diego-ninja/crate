import { useEffect, useState, useCallback } from "react";
import { NavLink, Link } from "react-router";
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
  AudioWaveform,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";

interface SidebarProps {
  onNavigate?: () => void;
}

interface SidebarStats {
  issue_count?: number;
  pending_imports?: number;
  running_tasks?: number;
}

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/browse", icon: Library, label: "Browse" },
  { to: "/discover", icon: Compass, label: "Discover" },
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
  { to: "/analysis", icon: AudioWaveform, label: "Analysis", adminOnly: true },
  { to: "/tasks", icon: ListTodo, label: "Tasks", badgeKey: "running_tasks" as const, adminOnly: true },
  { to: "/stack", icon: Server, label: "Stack", adminOnly: true },
  { to: "/users", icon: Users, label: "Users", adminOnly: true },
  { to: "/settings", icon: Settings, label: "Settings", adminOnly: true },
] as const;

export function Sidebar({ onNavigate }: SidebarProps) {
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
      // silently ignore
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  return (
    <nav className="w-[220px] bg-card border-r border-border flex-shrink-0 fixed h-screen overflow-y-auto flex flex-col">
      <div className="px-4 pb-4 pt-4 border-b border-border mb-4">
        <Link to="/" className="flex items-center gap-3">
          <img src="/assets/logo.svg" alt="Crate" className="w-8 h-8" />
          <span className="text-lg font-bold text-foreground">Crate</span>
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto">
      {navItems.map((item, i) => {
        if ("section" in item) {
          return (
            <div
              key={i}
              className="px-5 pt-4 pb-1 text-xs uppercase tracking-wider text-muted-foreground font-semibold"
            >
              {item.section}
            </div>
          );
        }
        if ("adminOnly" in item && item.adminOnly && !isAdmin) {
          return null;
        }
        const Icon = item.icon;
        const badgeValue = "badgeKey" in item && item.badgeKey ? stats[item.badgeKey] : undefined;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-5 py-2.5 text-sm transition-colors",
                isActive
                  ? "text-foreground bg-secondary border-r-2 border-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary",
              )
            }
          >
            <Icon size={16} />
            <span className="flex-1">{item.label}</span>
            {badgeValue != null && badgeValue > 0 && (
              <span className="bg-primary/20 text-primary text-[10px] font-medium px-1.5 py-0.5 rounded-full">
                {badgeValue}
              </span>
            )}
          </NavLink>
        );
      })}
      </div>
      {user && (
        <div className="border-t border-border px-4 py-3 mt-auto">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link to="/profile" className="flex items-center gap-2 flex-1 min-w-0 hover:text-foreground transition-colors" onClick={onNavigate}>
              {user.avatar ? (
                <img src={user.avatar} alt="" className="w-5 h-5 rounded-full" />
              ) : (
                <User size={14} />
              )}
              <span className="flex-1 truncate">{user.name}</span>
            </Link>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {user.role}
            </Badge>
            <button
              onClick={logout}
              title="Logout"
              className="hover:text-foreground transition-colors"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
