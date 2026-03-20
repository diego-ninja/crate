import { useEffect, useState, useCallback } from "react";
import { NavLink } from "react-router";
import {
  LayoutDashboard,
  Library,
  HeartPulse,
  Copy,
  Image,
  FolderSync,
  Download,
  BarChart3,
  Disc3,
  ShieldCheck,
  ListTodo,
  ListMusic,
  Search,
  ExternalLink,
  Tag,
  Clock,
  Server,
  BrainCircuit,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

interface SidebarProps {
  onNavigate?: () => void;
}

interface SidebarStats {
  issue_count?: number;
  pending_imports?: number;
  running_tasks?: number;
}

interface NavidromeStatus {
  connected: boolean;
  version: string;
}

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/browse", icon: Library, label: "Browse" },
  { section: "Tools" },
  { to: "/health", icon: HeartPulse, label: "Health Scan", badgeKey: "issue_count" as const },
  { to: "/duplicates", icon: Copy, label: "Duplicates" },
  { to: "/artwork", icon: Image, label: "Album Art" },
  { to: "/organizer", icon: FolderSync, label: "Organizer" },
  { to: "/imports", icon: Download, label: "Imports", badgeKey: "pending_imports" as const },
  { section: "Music" },
  { to: "/playlists", icon: ListMusic, label: "Playlists" },
  { external: "https://search.lespedants.org", icon: Search, label: "Download" },
  { external: "https://ai.lespedants.org", icon: BrainCircuit, label: "AudioMuse AI" },
  { section: "Insights" },
  { to: "/analytics", icon: BarChart3, label: "Analytics" },
  { to: "/genres", icon: Tag, label: "Genres" },
  { to: "/timeline", icon: Clock, label: "Timeline" },
  { to: "/missing-albums", icon: Disc3, label: "Missing Albums" },
  { to: "/quality", icon: ShieldCheck, label: "Quality" },
  { section: "System" },
  { to: "/tasks", icon: ListTodo, label: "Tasks", badgeKey: "running_tasks" as const },
  { to: "/stack", icon: Server, label: "Stack" },
] as const;

export function Sidebar({ onNavigate }: SidebarProps) {
  const [stats, setStats] = useState<SidebarStats>({});
  const [navidrome, setNavidrome] = useState<NavidromeStatus | null>(null);

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

  useEffect(() => {
    api<NavidromeStatus>("/api/navidrome/status")
      .then(setNavidrome)
      .catch(() => setNavidrome({ connected: false, version: "" }));
  }, []);

  return (
    <nav className="w-[220px] bg-card border-r border-border flex-shrink-0 fixed h-screen overflow-y-auto">
      <div className="px-5 pb-6 pt-6 border-b border-border mb-4">
        <span className="text-lg font-bold text-foreground">
          <span className="text-primary">&#9835;</span> Librarian
        </span>
        {navidrome && (
          <div className="flex items-center gap-1.5 mt-2" title={navidrome.connected ? `Navidrome ${navidrome.version}` : "Navidrome disconnected"}>
            <span className={cn("w-2 h-2 rounded-full", navidrome.connected ? "bg-green-500" : "bg-red-500")} />
            <span className="text-[10px] text-muted-foreground">
              {navidrome.connected ? `Navidrome ${navidrome.version}` : "Navidrome offline"}
            </span>
          </div>
        )}
      </div>
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
        if ("external" in item) {
          const Icon = item.icon;
          return (
            <a
              key={item.external}
              href={item.external}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-5 py-2.5 text-sm transition-colors text-muted-foreground hover:text-foreground hover:bg-secondary"
            >
              <Icon size={16} />
              <span className="flex-1">{item.label}</span>
              <ExternalLink size={12} className="text-muted-foreground/50" />
            </a>
          );
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
    </nav>
  );
}
