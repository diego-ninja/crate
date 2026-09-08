import { useState } from "react";
import { Link } from "react-router";
import {
  LayoutDashboard,
  Library,
  HeartPulse,
  BarChart3,
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
  ShieldCheck,
  PanelLeftClose,
  PanelLeftOpen,
  Trash2,
  HandHeart,
  Languages,
  Network,
  DatabaseZap,
} from "lucide-react";

import { BandcampLogo } from "@crate/ui/domain/brand/BandcampLogo";
import { CrateLogo } from "@crate/ui/domain/brand/CrateLogo";
import { VtNavLink as NavLink } from "@crate/ui/primitives/VtNavLink";
import { Badge } from "@crate/ui/shadcn/badge";
import { useOpsSnapshot } from "@/contexts/OpsSnapshotContext";
import { AdminSelect } from "@/components/ui/AdminSelect";
import { cn } from "@/lib/utils";
import { useAuth, userCanAccessAdminConsole } from "@/contexts/AuthContext";

interface SidebarProps {
  onNavigate?: () => void;
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
  {
    to: "/",
    icon: LayoutDashboard,
    label: "Dashboard",
    capabilities: ["admin.access"],
  },
  {
    to: "/browse",
    icon: Library,
    label: "Browse",
    capabilities: ["library.view"],
  },
  {
    to: "/discover",
    icon: Compass,
    label: "Discovery",
    capabilities: ["library.view"],
  },
  { section: "Tools" },
  {
    to: "/health",
    icon: HeartPulse,
    label: "Library Health",
    badgeKey: "issue_count" as const,
    capabilities: ["library.repair.run"],
  },
  {
    to: "/trash",
    icon: Trash2,
    label: "Library Trash",
    capabilities: ["library.track.remove"],
  },
  {
    to: "/contributions",
    icon: HandHeart,
    label: "Contributions",
    capabilities: ["library.import.manage"],
  },
  { section: "Music" },
  {
    to: "/upcoming",
    icon: Calendar,
    label: "Upcoming",
    capabilities: [
      "curation.shows.write",
      "curation.releases.write",
      "library.tidal.manage",
    ],
  },
  {
    to: "/new-releases",
    icon: Sparkles,
    label: "New Releases",
    capabilities: ["curation.releases.write", "library.tidal.manage"],
  },
  {
    to: "/bandcamp",
    icon: BandcampLogo,
    label: "Bandcamp",
    capabilities: ["library.bandcamp.manage"],
  },
  {
    to: "/playlists",
    icon: ListMusic,
    label: "System Playlists",
    capabilities: ["curation.playlists.write"],
  },
  {
    to: "/download",
    icon: Download,
    label: "Acquisition",
    capabilities: ["library.import.manage", "library.tidal.manage"],
  },
  { section: "Insights" },
  {
    to: "/insights",
    icon: BarChart3,
    label: "Insights",
    capabilities: ["library.view"],
  },
  {
    to: "/genres",
    icon: Tag,
    label: "Genres",
    capabilities: ["library.view"],
  },
  {
    to: "/timeline",
    icon: Clock,
    label: "Timeline",
    capabilities: ["library.view"],
  },
  { section: "System" },
  {
    to: "/system",
    icon: Activity,
    label: "System Health",
    capabilities: ["ops.health.view"],
  },
  {
    to: "/analysis",
    icon: AudioWaveform,
    label: "Analysis",
    capabilities: ["library.analysis.manage"],
  },
  {
    to: "/tasks",
    icon: ListTodo,
    label: "Tasks",
    badgeKey: "running_tasks" as const,
    capabilities: ["ops.tasks.manage"],
  },
  {
    to: "/logs",
    icon: ScrollText,
    label: "Logs",
    capabilities: ["ops.logs.view"],
  },
  {
    to: "/stack",
    icon: Server,
    label: "Stack",
    capabilities: ["ops.runtime.manage"],
  },
  {
    to: "/users",
    icon: Users,
    label: "Users",
    capabilities: ["users.view"],
  },
  {
    to: "/roles",
    icon: ShieldCheck,
    label: "Roles",
    capabilities: ["roles.view"],
  },
  {
    to: "/i18n",
    icon: Languages,
    label: "Translations",
    capabilities: ["admin.access"],
  },
  {
    to: "/settings",
    icon: Settings,
    label: "Settings",
    capabilities: ["settings.manage"],
  },
  {
    to: "/federation",
    icon: Network,
    label: "Federation",
    capabilities: ["federation.nodes.view"],
  },
  {
    to: "/global-catalog",
    icon: DatabaseZap,
    label: "Global Catalog",
    capabilities: ["federation.nodes.view"],
  },
] as const;

type NavItem = (typeof navItems)[number];
type NavLinkItem = Exclude<NavItem, { section: string }>;

function isSection(
  item: NavItem,
): item is Extract<NavItem, { section: string }> {
  return "section" in item;
}

function canShowNavItem(
  item: NavLinkItem,
  hasAnyCapability: (capabilities: readonly string[]) => boolean,
): boolean {
  return hasAnyCapability(item.capabilities);
}

function getVisibleNavItems(
  hasAnyCapability: (capabilities: readonly string[]) => boolean,
): NavItem[] {
  return navItems.filter((item, index) => {
    if (!isSection(item)) return canShowNavItem(item, hasAnyCapability);
    for (const next of navItems.slice(index + 1)) {
      if (isSection(next)) return false;
      if (canShowNavItem(next, hasAnyCapability)) return true;
    }
    return false;
  });
}

function emitSidebarExpanded(expanded: boolean) {
  try {
    localStorage.setItem(SIDEBAR_KEY, String(expanded));
    window.dispatchEvent(
      new CustomEvent(SIDEBAR_EVENT, { detail: { expanded } }),
    );
  } catch {
    // ignore persistence failures
  }
}

function navClass(isActive: boolean): string {
  return isActive
    ? "bg-white/10 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
    : "text-white/42 hover:bg-white/5 hover:text-white";
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const [expanded, setExpanded] = useState(getStoredSidebarExpanded);
  const auth = useAuth();
  const {
    user,
    actualUser,
    hasAnyCapability,
    logout,
    previewRole,
    clearRolePreview,
  } = auth;
  const rolePresets = auth.rolePresets ?? [];
  const previewableRolePresets = rolePresets.filter((role) =>
    userCanAccessAdminConsole({
      id: 0,
      email: "",
      name: role.name,
      role: role.slug,
      roles: [role.slug],
      capabilities: role.capabilities,
    }),
  );
  const setPreviewRole = auth.setPreviewRole ?? (() => {});
  const clearPreview = clearRolePreview ?? (() => {});
  const { data: opsSnapshot } = useOpsSnapshot();
  const profileHref =
    user && hasAnyCapability(["users.view"])
      ? `/users?inspect=${user.id}`
      : "/browse";
  const visibleNavItems = getVisibleNavItems(hasAnyCapability);

  const stats = {
    issue_count: opsSnapshot?.status.issue_count || 0,
    pending_imports: opsSnapshot?.status.pending_imports || 0,
    running_tasks: opsSnapshot?.status.running_tasks || 0,
  };

  function toggleExpanded() {
    const next = !expanded;
    setExpanded(next);
    emitSidebarExpanded(next);
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
        <div
          className={cn(
            "flex h-16 items-center",
            expanded ? "gap-3 px-4" : "justify-center",
          )}
        >
          {expanded ? (
            <>
              <Link to="/" className="flex items-center gap-3 min-w-0">
                <CrateLogo title="Crate" className="h-8 w-8 shrink-0" />
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
              <CrateLogo className="h-6 w-6" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-3">
        {visibleNavItems.map((item) => {
          if ("section" in item) {
            return expanded ? (
              <div
                key={`section-${item.section}`}
                className="px-4 pb-2 pt-5 text-[10px] font-bold uppercase tracking-[0.18em] text-white/25"
              >
                {item.section}
              </div>
            ) : (
              <div
                key={`divider-${item.section}`}
                className="mx-4 my-3 border-t border-white/5"
              />
            );
          }

          const Icon = item.icon;
          const badgeValue =
            "badgeKey" in item && item.badgeKey
              ? stats[item.badgeKey]
              : undefined;

          return (
            <div
              key={item.to}
              className={cn("relative", expanded ? "px-3" : "px-2")}
            >
              <NavLink
                to={item.to}
                end={item.to === "/"}
                onClick={onNavigate}
                title={item.label}
                className={({ isActive }) =>
                  cn(
                    "group flex items-center gap-3 rounded-md transition-colors",
                    expanded
                      ? "px-3 py-2.5"
                      : "mx-auto h-11 w-11 justify-center",
                    navClass(isActive),
                  )
                }
              >
                <Icon size={18} className="shrink-0" />
                {expanded ? (
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                    {item.label}
                  </span>
                ) : null}
                {expanded && badgeValue != null && badgeValue > 0 ? (
                  <Badge
                    variant="secondary"
                    className="px-1.5 py-0 text-[10px]"
                  >
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
            <div className="space-y-2 rounded-md border border-white/8 bg-white/[0.03] px-3 py-3">
              {actualUser && previewableRolePresets.length > 0 ? (
                <div
                  className={cn(
                    "rounded-md border px-2 py-2",
                    previewRole
                      ? "border-cyan-400/25 bg-cyan-400/10"
                      : "border-white/8 bg-black/15",
                  )}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/32">
                      Preview as
                    </span>
                    {previewRole ? (
                      <button
                        type="button"
                        onClick={clearPreview}
                        className="text-[10px] font-medium text-cyan-200/75 hover:text-cyan-100"
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                  <AdminSelect
                    value={previewRole ?? ""}
                    onChange={(value) => setPreviewRole(value || null)}
                    options={[
                      { value: "", label: "Actual permissions" },
                      ...previewableRolePresets.map((role) => ({
                        value: role.slug,
                        label: role.name,
                      })),
                    ]}
                    placeholder="Actual permissions"
                    allowClear={false}
                    triggerClassName="h-8 w-full min-w-0 max-w-none rounded-md px-2 text-xs"
                    menuClassName="w-[200px]"
                  />
                </div>
              ) : null}
              <div className="flex items-center gap-3">
                <Link
                  to={profileHref}
                  className="flex min-w-0 flex-1 items-center gap-3"
                  onClick={onNavigate}
                >
                  {user.avatar ? (
                    <img
                      src={user.avatar}
                      alt=""
                      className="h-10 w-10 rounded-md object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-white/5 text-white/60">
                      <User size={16} />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-white">
                      {user.name}
                    </div>
                    <div className="mt-1">
                      <Badge
                        variant="secondary"
                        className="px-1.5 py-0 text-[10px]"
                      >
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
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Link
                to={profileHref}
                onClick={onNavigate}
                className="flex h-11 w-11 items-center justify-center rounded-md border border-white/10 bg-white/5 text-white/70"
              >
                {user.avatar ? (
                  <img
                    src={user.avatar}
                    alt=""
                    className="h-11 w-11 rounded-md object-cover"
                  />
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
