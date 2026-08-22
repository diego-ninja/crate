import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { Link, useSearchParams } from "react-router";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Copy,
  Headphones,
  Info,
  Key,
  Loader2,
  Mail,
  Monitor,
  Music,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";

const UserMap = lazy(() =>
  import("@/components/users/UserMap").then((m) => ({ default: m.UserMap })),
);
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@crate/ui/shadcn/card";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import { Badge } from "@crate/ui/shadcn/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@crate/ui/shadcn/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { AdminSelect } from "@/components/ui/AdminSelect";
import { CrateChip, CratePill } from "@crate/ui/primitives/CrateBadge";
import { useAuth } from "@/contexts/AuthContext";
import { api, ApiError } from "@/lib/api";
import { albumPagePath, artistPagePath } from "@/lib/library-routes";
import { timeAgo } from "@/lib/utils";

interface ConnectedAccount {
  provider: string;
  status: string;
  external_username?: string | null;
}

interface CurrentTrack {
  track_id?: number | null;
  track_entity_uid?: string | null;
  title?: string | null;
  artist?: string | null;
  artist_id?: number | null;
  artist_slug?: string | null;
  album?: string | null;
  album_id?: number | null;
  album_slug?: string | null;
  played_at?: string | null;
}

interface UserRecord {
  id: number;
  email: string;
  username?: string | null;
  name: string;
  avatar?: string | null;
  role: string;
  roles?: string[];
  status?: "active" | "suspended" | "deleted" | string;
  status_reason?: string | null;
  suspended_at?: string | null;
  deleted_at?: string | null;
  capabilities?: string[];
  has_password?: boolean;
  active_sessions?: number;
  active_devices?: number;
  online_now?: boolean;
  listening_now?: boolean;
  current_track?: CurrentTrack | null;
  last_played_at?: string | null;
  last_seen_at?: string | null;
  last_activity_at?: string | null;
  activity_status?: "active" | "inactive" | "never_active" | string;
  connected_accounts?: ConnectedAccount[];
  last_login: string | null;
  created_at: string;
}

interface UserSession {
  id: string;
  created_at: string;
  expires_at: string;
  revoked_at?: string | null;
  last_seen_at?: string | null;
  last_seen_ip?: string | null;
  user_agent?: string | null;
  app_id?: string | null;
  device_label?: string | null;
  display_label?: string | null;
  client_name?: string | null;
  client_version?: string | null;
  os_name?: string | null;
  os_version?: string | null;
  device_type?: string | null;
  device_brand?: string | null;
  device_model?: string | null;
  device_fingerprint?: string | null;
  activity_state?:
    | "active"
    | "recent"
    | "history"
    | "expired"
    | "revoked"
    | null;
  is_active?: boolean | null;
  is_recent?: boolean | null;
}

interface UserDetail extends UserRecord {
  bio?: string | null;
  sessions: UserSession[];
}

interface AuthInvite {
  token: string;
  email?: string | null;
  expires_at?: string | null;
  max_uses?: number | null;
  use_count?: number | null;
}

type UserFilter =
  | "all"
  | "online"
  | "listening"
  | "admins"
  | "suspended"
  | "deleted"
  | "inactive";
type SessionFilter = "active" | "recent" | "all";

const ROLE_OPTIONS = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "ops", label: "Ops" },
  { value: "librarian", label: "Librarian" },
  { value: "curator", label: "Curator" },
  { value: "editor", label: "Editor" },
  { value: "contributor", label: "Contributor" },
  { value: "user", label: "User" },
];

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "deleted", label: "Deleted" },
];

const SESSION_ACTIVE_WINDOW_MS = 3 * 60 * 1000;
const SESSION_RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const USER_ACTIVITY_INACTIVE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const USERS_PAGE_SIZE = 20;

function roleLabel(role: string) {
  return ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role;
}

function rolesForUser(user: Pick<UserRecord, "role" | "roles"> | null) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  const normalized = roles
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);
  if (normalized.length > 0) return Array.from(new Set(normalized));
  return [user?.role || "user"];
}

function sameRoleSet(left: string[], right: string[]) {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((role, index) => role === sortedRight[index])
  );
}

function toggleRole(current: string[], role: string) {
  if (current.includes(role)) {
    if (current.length === 1) return current;
    return current.filter((candidate) => candidate !== role);
  }
  const next = [...current, role];
  return ROLE_OPTIONS.map((option) => option.value).filter((candidate) =>
    next.includes(candidate),
  );
}

function RolePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string[];
  onChange: (roles: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {ROLE_OPTIONS.map((option) => {
        const active = value.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(toggleRole(value, option.value))}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              active
                ? "border-cyan-400/35 bg-cyan-400/12 text-cyan-200"
                : "border-white/10 bg-white/[0.03] text-white/50 hover:border-white/20 hover:text-white/80"
            } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

interface SessionSourceSummary {
  key: string;
  label: string;
  count: number;
  online: number;
  connected: number;
  recent: number;
  history: number;
  revoked: number;
  last_seen_at?: string | null;
  app_id?: string | null;
}

function UserAvatar({
  user,
  size = "sm",
}: {
  user: { name?: string | null; email?: string | null; avatar?: string | null };
  size?: "sm" | "md";
}) {
  const dim = size === "md" ? "h-12 w-12 text-sm" : "h-9 w-9 text-xs";
  const initial = (user.name || user.email || "?").charAt(0).toUpperCase();

  if (user.avatar) {
    return (
      <img
        src={user.avatar}
        alt=""
        className={`${dim} rounded-md object-cover shrink-0`}
      />
    );
  }

  return (
    <div
      className={`${dim} rounded-md border border-white/10 bg-white/[0.04] flex items-center justify-center shrink-0 font-medium text-white/60`}
    >
      {initial}
    </div>
  );
}

function formatSessionTimestamp(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function toTimestamp(value?: string | null) {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatRelativeTimestamp(value?: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return timeAgo(value);
}

function userStatus(user: Pick<UserRecord, "status">) {
  return (user.status || "active").trim().toLowerCase();
}

function userActivityStatus(
  user: Pick<
    UserRecord,
    | "activity_status"
    | "last_activity_at"
    | "last_played_at"
    | "last_seen_at"
    | "last_login"
  >,
) {
  if (
    user.activity_status === "inactive" ||
    user.activity_status === "never_active"
  ) {
    return user.activity_status;
  }
  const lastActivity = Math.max(
    toTimestamp(user.last_activity_at),
    toTimestamp(user.last_played_at),
    toTimestamp(user.last_seen_at),
    toTimestamp(user.last_login),
  );
  if (!lastActivity) return "never_active";
  return Date.now() - lastActivity > USER_ACTIVITY_INACTIVE_AFTER_MS
    ? "inactive"
    : "active";
}

function activityLabel(status: string) {
  if (status === "inactive") return "Inactive";
  if (status === "never_active") return "No activity yet";
  return "Active recently";
}

function activityBadgeClass(status: string) {
  if (status === "inactive") return "border-amber-400/25 text-amber-300";
  if (status === "never_active") return "border-white/10 text-white/45";
  return "border-green-400/20 text-green-300";
}

function statusBadgeClass(status: string) {
  if (status === "active") return "border-green-400/20 text-green-300";
  if (status === "suspended") return "border-amber-400/25 text-amber-300";
  if (status === "deleted") return "border-red-400/25 text-red-300";
  return "border-white/10 text-white/55";
}

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function sessionUaLabel(userAgent?: string | null) {
  const raw = (userAgent || "").trim();
  if (!raw) return "Unknown client";
  const lowered = raw.toLowerCase();
  if (lowered.startsWith("curl/")) return "curl";
  if (lowered.startsWith("wget")) return "Wget";
  if (lowered.startsWith("python-urllib")) return "Python urllib";
  if (lowered.includes("chrome")) return "Chrome";
  if (lowered.includes("safari") && !lowered.includes("chrome"))
    return "Safari";
  if (lowered.includes("firefox")) return "Firefox";
  return raw.split(" ")[0]?.split("/")[0] || "Unknown client";
}

function deviceTypeLabel(deviceType?: string | null) {
  const normalized = (deviceType || "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "smartphone") return "Phone";
  if (normalized === "desktop") return "Desktop";
  if (normalized === "tablet") return "Tablet";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function sessionDisplayName(session: UserSession) {
  return (
    session.display_label ||
    session.device_label ||
    session.app_id ||
    sessionUaLabel(session.user_agent)
  );
}

function sessionSourceKey(session: UserSession) {
  const appKey = session.app_id?.trim().toLowerCase() || "web";
  return [
    session.device_fingerprint || "",
    appKey,
    session.display_label?.trim().toLowerCase() || "",
    session.device_label?.trim().toLowerCase() || "",
    sessionUaLabel(session.user_agent).trim().toLowerCase(),
  ].join("::");
}

function sessionActivityState(session: UserSession) {
  if (session.activity_state) return session.activity_state;

  const now = Date.now();
  const lastSeen = new Date(
    session.last_seen_at || session.created_at,
  ).getTime();
  const expires = new Date(session.expires_at).getTime();

  if (session.revoked_at) return "revoked";
  if (!Number.isNaN(expires) && expires < now) return "expired";
  if (!Number.isNaN(lastSeen) && now - lastSeen <= SESSION_ACTIVE_WINDOW_MS)
    return "active";
  if (!Number.isNaN(lastSeen) && now - lastSeen <= SESSION_RECENT_WINDOW_MS)
    return "recent";
  return "history";
}

function sessionMetaLine(session: UserSession) {
  const parts = [
    [session.client_name, session.client_version].filter(Boolean).join(" "),
    [session.os_name, session.os_version].filter(Boolean).join(" "),
    deviceTypeLabel(session.device_type),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function getSessionStatus(session: UserSession) {
  switch (sessionActivityState(session)) {
    case "revoked":
      return {
        key: "revoked",
        label: "Revoked",
        className: "border-white/12 bg-transparent text-white/60",
      };
    case "expired":
      return {
        key: "expired",
        label: "Expired",
        className: "border-amber-500/25 bg-amber-500/10 text-amber-200",
      };
    case "active":
      return {
        key: "active",
        label: "Active now",
        className: "border-green-500/25 bg-green-500/10 text-green-300",
      };
    case "recent":
      return {
        key: "recent",
        label: "Recent",
        className: "border-cyan-400/25 bg-cyan-400/10 text-cyan-200",
      };
    default:
      return {
        key: "history",
        label: "History",
        className: "border-white/8 bg-black/15 text-white/45",
      };
  }
}

function filterSessions(sessions: UserSession[], mode: SessionFilter) {
  if (mode === "all") return sessions;
  return sessions.filter((session) => {
    const status = getSessionStatus(session).key;
    if (mode === "active") return status === "active";
    return status === "active" || status === "recent";
  });
}

function summarizeSessions(sessions: UserSession[]): SessionSourceSummary[] {
  const groups = new Map<string, SessionSourceSummary>();

  for (const session of sessions) {
    const key = sessionSourceKey(session);
    const status = getSessionStatus(session).key;
    const lastSeenAt = session.last_seen_at || session.created_at;
    const existing = groups.get(key);

    if (existing) {
      existing.count += 1;
      existing.last_seen_at =
        toTimestamp(lastSeenAt) > toTimestamp(existing.last_seen_at)
          ? lastSeenAt
          : existing.last_seen_at;
      if (status === "active") existing.online += 1;
      else if (status === "recent") existing.recent += 1;
      else if (status === "revoked") existing.revoked += 1;
      else existing.history += 1;
      continue;
    }

    groups.set(key, {
      key,
      label: sessionDisplayName(session),
      count: 1,
      online: status === "active" ? 1 : 0,
      connected: 0,
      recent: status === "recent" ? 1 : 0,
      history: status === "history" || status === "expired" ? 1 : 0,
      revoked: status === "revoked" ? 1 : 0,
      last_seen_at: lastSeenAt,
      app_id: session.app_id,
    });
  }

  return Array.from(groups.values()).sort((left, right) => {
    const leftLive = left.online + left.connected;
    const rightLive = right.online + right.connected;
    if (leftLive !== rightLive) return rightLive - leftLive;
    if (left.count !== right.count) return right.count - left.count;
    return toTimestamp(right.last_seen_at) - toTimestamp(left.last_seen_at);
  });
}

function sortUsersByPresence(left: UserRecord, right: UserRecord) {
  if (left.listening_now !== right.listening_now)
    return Number(right.listening_now) - Number(left.listening_now);
  if (left.online_now !== right.online_now)
    return Number(right.online_now) - Number(left.online_now);
  if ((left.active_devices ?? 0) !== (right.active_devices ?? 0))
    return (right.active_devices ?? 0) - (left.active_devices ?? 0);
  if ((left.active_sessions ?? 0) !== (right.active_sessions ?? 0))
    return (right.active_sessions ?? 0) - (left.active_sessions ?? 0);
  const lastSeenDiff =
    toTimestamp(right.last_seen_at || right.last_login) -
    toTimestamp(left.last_seen_at || left.last_login);
  if (lastSeenDiff !== 0) return lastSeenDiff;
  return (left.name || left.email).localeCompare(right.name || right.email);
}

function listenRegisterUrl(inviteToken: string) {
  const url = new URL(window.location.href);
  if (url.hostname.startsWith("admin.")) {
    url.hostname = url.hostname.replace(/^admin\./, "listen.");
  } else if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    url.port = "5174";
  }
  url.pathname = "/register";
  url.search = new URLSearchParams({ invite: inviteToken }).toString();
  url.hash = "";
  return url.toString();
}

function UserPresence({
  user,
  compact = false,
}: {
  user: Pick<
    UserRecord,
    | "online_now"
    | "listening_now"
    | "active_devices"
    | "active_sessions"
    | "last_seen_at"
    | "current_track"
  >;
  compact?: boolean;
}) {
  const baseClass = compact ? "text-[11px]" : "text-xs";

  return (
    <div className="flex flex-wrap gap-2">
      <CrateChip
        icon={Activity}
        className={
          user.online_now
            ? "border-green-500/25 bg-green-500/10 text-green-300"
            : "border-white/10 bg-white/[0.04] text-white/55"
        }
      >
        {user.online_now
          ? "Active now"
          : user.last_seen_at
            ? `Last seen ${formatRelativeTimestamp(user.last_seen_at)}`
            : "Offline"}
      </CrateChip>
      <CrateChip
        icon={Headphones}
        className={
          user.listening_now
            ? "border-cyan-400/25 bg-cyan-400/10 text-cyan-200"
            : "border-white/10 bg-white/[0.04] text-white/55"
        }
      >
        {user.listening_now ? "Listening now" : "Not playing"}
      </CrateChip>
      <CrateChip icon={Monitor} className={baseClass}>
        {user.active_devices ?? 0} device
        {(user.active_devices ?? 0) === 1 ? "" : "s"}
      </CrateChip>
      <CrateChip icon={ShieldCheck} className={baseClass}>
        {user.active_sessions ?? 0} active session
        {(user.active_sessions ?? 0) === 1 ? "" : "s"}
      </CrateChip>
    </div>
  );
}

function CurrentTrackLine({ track }: { track?: CurrentTrack | null }) {
  if (!track?.title) return null;
  const artistHref =
    track.artist_id != null
      ? artistPagePath({
          artistId: track.artist_id,
          artistSlug: track.artist_slug || undefined,
          artistName: track.artist || "",
        })
      : null;
  const albumHref =
    track.album_id != null
      ? albumPagePath({
          albumId: track.album_id,
          albumSlug: track.album_slug || undefined,
          artistName: track.artist || "",
          albumName: track.album || "",
        })
      : null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm text-white/65">
      <Music size={14} className="text-cyan-300" />
      <span className="text-white/82">{track.title}</span>
      {track.artist ? (
        <>
          <span className="text-white/28">by</span>
          {artistHref ? (
            <Link to={artistHref} className="hover:text-white">
              {track.artist}
            </Link>
          ) : (
            <span>{track.artist}</span>
          )}
        </>
      ) : null}
      {track.album ? (
        <>
          <span className="text-white/28">on</span>
          {albumHref ? (
            <Link to={albumHref} className="hover:text-white">
              {track.album}
            </Link>
          ) : (
            <span>{track.album}</span>
          )}
        </>
      ) : null}
    </div>
  );
}

function authModeSummary(
  user: Pick<UserRecord, "has_password" | "connected_accounts">,
) {
  const providerCount = user.connected_accounts?.length ?? 0;
  if (user.has_password && providerCount > 0) {
    return `Password + ${providerCount} linked provider${
      providerCount === 1 ? "" : "s"
    }`;
  }
  if (user.has_password) {
    return "Password login enabled";
  }
  if (providerCount > 0) {
    return providerCount === 1
      ? "SSO-only account"
      : `SSO-only · ${providerCount} providers`;
  }
  return "No sign-in method configured";
}

export function Users() {
  const { user: currentUser, hasCapability } = useAuth();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserRecord | null>(null);
  const [detailTarget, setDetailTarget] = useState<UserRecord | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<UserFilter>("all");
  const [page, setPage] = useState(1);
  const [searchParams, setSearchParams] = useSearchParams();
  const canViewUserMap = hasCapability("users.view");
  const canCreateUsers =
    hasCapability("users.create") || hasCapability("users.manage");
  const canManageStatus =
    hasCapability("users.status.manage") || hasCapability("users.manage");
  const canManagePasswords =
    hasCapability("users.password.manage") || hasCapability("users.manage");
  const canManageSessions =
    hasCapability("users.sessions.manage") || hasCapability("users.manage");
  const canDeleteUsers =
    hasCapability("users.delete") || hasCapability("users.manage");
  const canAssignRoles =
    hasCapability("roles.assign") || hasCapability("roles.manage");

  function setInspectParam(userId: number | null) {
    const next = new URLSearchParams(searchParams);
    if (userId == null) next.delete("inspect");
    else next.set("inspect", String(userId));
    setSearchParams(next, { replace: true });
  }

  function openUserDetail(user: UserRecord) {
    setDetailTarget(user);
    setInspectParam(user.id);
  }

  function inspectMapUser(userId: number) {
    const target = users.find((user) => user.id === userId);
    if (target) openUserDetail(target);
  }

  async function fetchUsers() {
    try {
      const data = await api<UserRecord[]>("/api/auth/users");
      setUsers(Array.isArray(data) ? data : []);
    } catch {
      toast.error("Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchUsers();
  }, []);

  useEffect(() => {
    const inspectRaw = searchParams.get("inspect");
    if (!inspectRaw) {
      if (detailTarget) setDetailTarget(null);
      return;
    }
    const inspectId = Number(inspectRaw);
    if (!Number.isFinite(inspectId)) {
      setInspectParam(null);
      return;
    }
    if (detailTarget?.id === inspectId) {
      return;
    }
    const target = users.find((candidate) => candidate.id === inspectId);
    if (target) {
      setDetailTarget(target);
    } else if (users.length > 0 && currentUser?.id === inspectId) {
      setInspectParam(null);
    }
  }, [currentUser?.id, detailTarget, searchParams, users]);

  async function handleDelete() {
    if (!deleteTarget || !canDeleteUsers) return;
    try {
      await api(`/api/auth/users/${deleteTarget.id}`, "DELETE");
      toast.success("User deleted");
      setDeleteTarget(null);
      await fetchUsers();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to delete user",
      );
    }
  }

  const counts = useMemo(
    () => ({
      total: users.length,
      online: users.filter((user) => user.online_now).length,
      listening: users.filter((user) => user.listening_now).length,
      devices: users.reduce((sum, user) => sum + (user.active_devices ?? 0), 0),
    }),
    [users],
  );

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return users
      .filter((user) => {
        const matchesFilter =
          filter === "all" ||
          (filter === "online" && user.online_now) ||
          (filter === "listening" && user.listening_now) ||
          (filter === "admins" &&
            rolesForUser(user).some(
              (role) => role === "admin" || role === "owner",
            )) ||
          (filter === "suspended" && userStatus(user) === "suspended") ||
          (filter === "deleted" && userStatus(user) === "deleted") ||
          (filter === "inactive" && userActivityStatus(user) === "inactive");

        const providerText = (user.connected_accounts || [])
          .map((account) => account.provider)
          .join(" ");
        const haystack = `${user.name} ${user.email} ${
          user.username ?? ""
        } ${providerText}`.toLowerCase();
        const matchesQuery =
          !normalizedQuery || haystack.includes(normalizedQuery);
        return matchesFilter && matchesQuery;
      })
      .sort(sortUsersByPresence);
  }, [filter, query, users]);

  const pageCount = Math.max(
    1,
    Math.ceil(filteredUsers.length / USERS_PAGE_SIZE),
  );
  const pageStart = (page - 1) * USERS_PAGE_SIZE;
  const paginatedUsers = filteredUsers.slice(
    pageStart,
    pageStart + USERS_PAGE_SIZE,
  );
  const showingStart = filteredUsers.length === 0 ? 0 : pageStart + 1;
  const showingEnd = Math.min(
    pageStart + USERS_PAGE_SIZE,
    filteredUsers.length,
  );

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-white/10 bg-panel-surface/95 p-5 shadow-[0_28px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-md border border-cyan-400/20 bg-cyan-400/12 text-primary shadow-[0_18px_40px_rgba(6,182,212,0.14)]">
                <UserRound size={22} />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-white">
                  Users
                </h1>
                <p className="text-sm text-white/55">
                  Presence, linked identities, active devices and recent
                  listening activity across the system.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <CrateChip icon={UserRound}>{counts.total} total users</CrateChip>
              <CrateChip
                icon={Activity}
                className={
                  counts.online > 0
                    ? "border-green-500/25 bg-green-500/10 text-green-300"
                    : undefined
                }
              >
                {counts.online} active now
              </CrateChip>
              <CrateChip
                icon={Headphones}
                className={
                  counts.listening > 0
                    ? "border-cyan-400/25 bg-cyan-400/10 text-cyan-200"
                    : undefined
                }
              >
                {counts.listening} listening
              </CrateChip>
              <CrateChip icon={Monitor}>
                {counts.devices} active devices
              </CrateChip>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canCreateUsers ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setInviteOpen(true)}
                >
                  <Send size={16} className="mr-2" />
                  Invite user
                </Button>
                <Button size="sm" onClick={() => setAddOpen(true)}>
                  <Plus size={16} className="mr-2" />
                  Add user
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </section>

      {canViewUserMap ? (
        <Suspense fallback={null}>
          <UserMap onInspectUser={(user) => inspectMapUser(user.id)} />
        </Suspense>
      ) : null}

      <Card className="border-white/10 bg-panel-surface shadow-[0_24px_70px_rgba(0,0,0,0.2)]">
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full max-w-md">
              <Search
                size={14}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/35"
              />
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="Search users..."
                className="pl-10"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                { key: "all", label: "All", count: users.length },
                {
                  key: "online",
                  label: "Active",
                  count: users.filter((user) => user.online_now).length,
                },
                {
                  key: "listening",
                  label: "Listening",
                  count: users.filter((user) => user.listening_now).length,
                },
                {
                  key: "admins",
                  label: "Admins",
                  count: users.filter((user) =>
                    rolesForUser(user).some(
                      (role) => role === "admin" || role === "owner",
                    ),
                  ).length,
                },
                {
                  key: "suspended",
                  label: "Suspended",
                  count: users.filter(
                    (user) => userStatus(user) === "suspended",
                  ).length,
                },
                {
                  key: "deleted",
                  label: "Deleted",
                  count: users.filter((user) => userStatus(user) === "deleted")
                    .length,
                },
                {
                  key: "inactive",
                  label: "Inactive",
                  count: users.filter(
                    (user) => userActivityStatus(user) === "inactive",
                  ).length,
                },
              ].map((item) => (
                <CratePill
                  key={item.key}
                  active={filter === item.key}
                  onClick={() => {
                    setFilter(item.key as UserFilter);
                    setPage(1);
                  }}
                >
                  {item.label} {item.count}
                </CratePill>
              ))}
            </div>
          </div>

          <div className="text-sm text-white/45">
            Showing {showingStart}-{showingEnd} of {filteredUsers.length} users
          </div>

          <div className="space-y-3">
            {paginatedUsers.map((user) => (
              <div
                key={user.id}
                className="rounded-md border border-white/8 bg-black/15 p-4 shadow-[0_16px_36px_rgba(0,0,0,0.16)]"
              >
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex items-start gap-3">
                      <UserAvatar user={user} size="md" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-lg font-semibold tracking-tight text-white">
                            {user.name || user.email}
                          </h2>
                          {rolesForUser(user).map((role) => (
                            <Badge
                              key={role}
                              variant={
                                role === "admin" || role === "owner"
                                  ? "default"
                                  : "secondary"
                              }
                            >
                              {roleLabel(role)}
                            </Badge>
                          ))}
                          <Badge
                            variant="outline"
                            className={statusBadgeClass(userStatus(user))}
                          >
                            {statusLabel(userStatus(user))}
                          </Badge>
                          {userActivityStatus(user) !== "active" ? (
                            <Badge
                              variant="outline"
                              className={activityBadgeClass(
                                userActivityStatus(user),
                              )}
                            >
                              {activityLabel(userActivityStatus(user))}
                            </Badge>
                          ) : null}
                          {user.username ? (
                            <Badge variant="outline">@{user.username}</Badge>
                          ) : null}
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-sm text-white/45">
                          <Mail size={13} />
                          <span className="truncate">{user.email}</span>
                        </div>
                      </div>
                    </div>

                    <UserPresence user={user} />

                    {user.listening_now && user.current_track ? (
                      <CurrentTrackLine track={user.current_track} />
                    ) : null}

                    <div className="flex flex-wrap gap-2">
                      {(user.connected_accounts || []).map((account) => (
                        <CrateChip
                          key={`${user.id}-${account.provider}`}
                          className="text-[11px]"
                        >
                          {account.provider}
                          {account.external_username
                            ? ` · ${account.external_username}`
                            : ""}
                        </CrateChip>
                      ))}
                      {(user.connected_accounts || []).length === 0 ? (
                        <CrateChip className="text-[11px] text-white/45">
                          No linked providers
                        </CrateChip>
                      ) : null}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-md border border-white/8 bg-black/15 p-3">
                        <div className="text-[11px] uppercase tracking-[0.12em] text-white/28">
                          Presence
                        </div>
                        <div className="mt-1 text-sm text-white/78">
                          {(user.active_devices ?? 0) > 0
                            ? `${user.active_devices} active device${
                                (user.active_devices ?? 0) === 1 ? "" : "s"
                              }`
                            : user.last_seen_at
                              ? `Seen ${formatRelativeTimestamp(
                                  user.last_seen_at,
                                )}`
                              : "No activity yet"}
                        </div>
                      </div>
                      <div className="rounded-md border border-white/8 bg-black/15 p-3">
                        <div className="text-[11px] uppercase tracking-[0.12em] text-white/28">
                          Playback
                        </div>
                        <div className="mt-1 text-sm text-white/78">
                          {user.current_track?.title
                            ? `${user.current_track.title}${
                                user.current_track.artist
                                  ? ` · ${user.current_track.artist}`
                                  : ""
                              }`
                            : user.last_played_at
                              ? `Last play ${formatRelativeTimestamp(
                                  user.last_played_at,
                                )}`
                              : "No play signal"}
                        </div>
                      </div>
                      <div className="rounded-md border border-white/8 bg-black/15 p-3">
                        <div className="text-[11px] uppercase tracking-[0.12em] text-white/28">
                          Identity
                        </div>
                        <div className="mt-1 text-sm text-white/78">
                          {authModeSummary(user)}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex min-w-[220px] flex-col gap-3 xl:items-end">
                    <div className="grid grid-cols-2 gap-3 text-sm text-white/45 xl:text-right">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.12em] text-white/28">
                          Last seen
                        </div>
                        <div className="mt-1 text-white/75">
                          {formatRelativeTimestamp(user.last_seen_at)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.12em] text-white/28">
                          Last login
                        </div>
                        <div className="mt-1 text-white/75">
                          {formatRelativeTimestamp(user.last_login)}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 xl:justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openUserDetail(user)}
                      >
                        <Info size={14} className="mr-2" />
                        Inspect
                      </Button>
                      {canDeleteUsers ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-red-500/25 text-red-300 hover:bg-red-500/10 hover:text-red-200"
                          onClick={() => setDeleteTarget(user)}
                          disabled={userStatus(user) === "deleted"}
                        >
                          <Trash2 size={14} className="mr-2" />
                          Delete
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {filteredUsers.length === 0 ? (
              <div className="rounded-md border border-dashed border-white/10 bg-black/15 px-6 py-10 text-center text-sm text-white/45">
                No users match the current search or filter.
              </div>
            ) : null}
          </div>

          {filteredUsers.length > 0 && pageCount > 1 ? (
            <div className="flex items-center justify-between gap-3 border-t border-white/8 pt-4">
              <Button
                size="sm"
                variant="outline"
                aria-label="Previous page"
                disabled={page === 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                <ChevronLeft size={15} className="mr-1" />
                Previous
              </Button>
              <span className="text-xs text-white/45">
                Page {page} of {pageCount}
              </span>
              <Button
                size="sm"
                variant="outline"
                aria-label="Next page"
                disabled={page === pageCount}
                onClick={() =>
                  setPage((current) => Math.min(pageCount, current + 1))
                }
              >
                Next
                <ChevronRight size={15} className="ml-1" />
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <AddUserDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSuccess={fetchUsers}
        canAssignRoles={canAssignRoles}
      />
      {canCreateUsers ? (
        <InviteUserDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      ) : null}

      <UserDetailDialog
        user={detailTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDetailTarget(null);
            setInspectParam(null);
          }
        }}
        onSuccess={fetchUsers}
        canManageStatus={canManageStatus}
        canManagePasswords={canManagePasswords}
        canManageSessions={canManageSessions}
        canAssignRoles={canAssignRoles}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete user"
        description={`Soft-delete ${
          deleteTarget?.name || deleteTarget?.email
        }? Open sessions will be revoked and owned contributions may be queued for cleanup.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  );
}

function UserDetailDialog({
  user,
  onOpenChange,
  onSuccess,
  canManageStatus,
  canManagePasswords,
  canManageSessions,
  canAssignRoles,
}: {
  user: UserRecord | null;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  canManageStatus: boolean;
  canManagePasswords: boolean;
  canManageSessions: boolean;
  canAssignRoles: boolean;
}) {
  const { user: currentUser, refetch } = useAuth();
  const open = !!user;
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>("active");
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [roleDraft, setRoleDraft] = useState<string[]>(["user"]);
  const [statusDraft, setStatusDraft] = useState("active");
  const [statusReason, setStatusReason] = useState("");
  const [roleSaving, setRoleSaving] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);

  async function fetchDetail(userId: number) {
    setLoading(true);
    try {
      const data = await api<UserDetail>(`/api/auth/users/${userId}`);
      setDetail(data);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to load user detail",
      );
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open || !user) {
      setDetail(null);
      setPasswordDialogOpen(false);
      return;
    }
    setSessionFilter("active");
    void fetchDetail(user.id);
  }, [open, user]);

  useEffect(() => {
    if (detail) {
      setRoleDraft(rolesForUser(detail));
    }
  }, [detail]);

  useEffect(() => {
    if (detail?.status) {
      setStatusDraft(userStatus(detail));
      setStatusReason(detail.status_reason ?? "");
    }
  }, [detail]);

  async function handleRoleSave() {
    if (
      !detail ||
      !canAssignRoles ||
      sameRoleSet(roleDraft, rolesForUser(detail))
    )
      return;
    setRoleSaving(true);
    try {
      const updated = await api<UserDetail>(
        `/api/auth/users/${detail.id}/role`,
        "PATCH",
        { roles: roleDraft },
      );
      setDetail(updated);
      toast.success("Role updated");
      onSuccess();
      if (currentUser?.id === detail.id) {
        refetch();
      }
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to update role",
      );
    } finally {
      setRoleSaving(false);
    }
  }

  async function handleStatusSave() {
    if (!detail || !canManageStatus || statusDraft === userStatus(detail))
      return;
    setStatusSaving(true);
    try {
      const updated = await api<UserDetail>(
        `/api/auth/users/${detail.id}/status`,
        "PATCH",
        {
          status: statusDraft,
          reason: statusReason || undefined,
          revoke_sessions: statusDraft !== "active",
        },
      );
      setDetail(updated);
      toast.success("User status updated");
      onSuccess();
      if (currentUser?.id === detail.id) {
        refetch();
      }
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to update user status",
      );
    } finally {
      setStatusSaving(false);
    }
  }

  async function handleRevokeSession(sessionId: string) {
    if (!detail || !canManageSessions) return;
    setRevokingId(sessionId);
    try {
      await api(`/api/auth/users/${detail.id}/sessions/${sessionId}`, "DELETE");
      toast.success("Session revoked");
      await fetchDetail(detail.id);
      onSuccess();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to revoke session",
      );
    } finally {
      setRevokingId(null);
    }
  }

  async function handleRevokeAll() {
    if (!detail || !canManageSessions) return;
    setRevokingAll(true);
    try {
      const result = await api<{ revoked: number }>(
        `/api/auth/users/${detail.id}/sessions/revoke-all`,
        "POST",
      );
      toast.success(
        `Revoked ${result.revoked} session${result.revoked === 1 ? "" : "s"}`,
      );
      await fetchDetail(detail.id);
      onSuccess();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to revoke sessions",
      );
    } finally {
      setRevokingAll(false);
    }
  }

  const visibleSessions = useMemo(
    () => filterSessions(detail?.sessions ?? [], sessionFilter),
    [detail?.sessions, sessionFilter],
  );
  const openSessions = useMemo(
    () => (detail?.sessions ?? []).filter((session) => !session.revoked_at),
    [detail?.sessions],
  );
  const staleOpenCount = useMemo(
    () =>
      openSessions.filter((session) => {
        const status = getSessionStatus(session).key;
        return status === "history" || status === "expired";
      }).length,
    [openSessions],
  );
  const sessionSourceSummary = useMemo(
    () => summarizeSessions(detail?.sessions ?? []),
    [detail?.sessions],
  );
  const sessionStatusCounts = useMemo(
    () =>
      (detail?.sessions ?? []).reduce(
        (acc, session) => {
          const status = getSessionStatus(session).key;
          if (status === "active") acc.connected += 1;
          else if (status === "recent") acc.recent += 1;
          else if (status === "revoked") acc.revoked += 1;
          else acc.history += 1;
          return acc;
        },
        { connected: 0, recent: 0, history: 0, revoked: 0 },
      ),
    [detail?.sessions],
  );
  const hiddenSessionsCount = Math.max(
    (detail?.sessions?.length ?? 0) - visibleSessions.length,
    0,
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>User Detail</DialogTitle>
            <DialogDescription>
              Inspect real-time presence, what the user is currently hearing,
              and filter session history by meaningful recency.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : detail ? (
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
              <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr_1fr]">
                <Card className="border-white/10 bg-panel-surface">
                  <CardContent className="pt-6">
                    <div className="flex items-start gap-4">
                      <UserAvatar user={detail} size="md" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-xl font-semibold tracking-tight text-white">
                            {detail.name || detail.email}
                          </h3>
                          {rolesForUser(detail).map((role) => (
                            <Badge
                              key={role}
                              variant={
                                role === "admin" || role === "owner"
                                  ? "default"
                                  : "secondary"
                              }
                            >
                              {roleLabel(role)}
                            </Badge>
                          ))}
                          <Badge
                            variant="outline"
                            className={statusBadgeClass(userStatus(detail))}
                          >
                            {statusLabel(userStatus(detail))}
                          </Badge>
                          {userActivityStatus(detail) !== "active" ? (
                            <Badge
                              variant="outline"
                              className={activityBadgeClass(
                                userActivityStatus(detail),
                              )}
                            >
                              {activityLabel(userActivityStatus(detail))}
                            </Badge>
                          ) : null}
                          {detail.username ? (
                            <Badge variant="outline">@{detail.username}</Badge>
                          ) : null}
                        </div>
                        <div className="mt-1 text-sm text-white/45">
                          {detail.email}
                        </div>
                      </div>
                    </div>
                    {detail.bio ? (
                      <p className="mt-4 text-sm leading-relaxed text-white/58">
                        {detail.bio}
                      </p>
                    ) : null}
                    <div className="mt-4 rounded-md border border-white/8 bg-black/15 p-3">
                      <div className="text-[11px] uppercase tracking-[0.12em] text-white/30">
                        Roles
                      </div>
                      {canAssignRoles ? (
                        <div className="mt-3 space-y-3">
                          <RolePicker
                            value={roleDraft}
                            onChange={setRoleDraft}
                            disabled={roleSaving}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              roleSaving ||
                              sameRoleSet(roleDraft, rolesForUser(detail))
                            }
                            onClick={handleRoleSave}
                          >
                            {roleSaving ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              "Save roles"
                            )}
                          </Button>
                        </div>
                      ) : (
                        <div className="mt-2 flex flex-wrap gap-2 text-sm text-white/70">
                          {rolesForUser(detail).map((role) => (
                            <CrateChip key={role}>{roleLabel(role)}</CrateChip>
                          ))}
                        </div>
                      )}
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {(detail.capabilities || [])
                          .slice(0, 8)
                          .map((capability) => (
                            <CrateChip
                              key={capability}
                              className="text-[10px] text-white/55"
                            >
                              {capability}
                            </CrateChip>
                          ))}
                        {(detail.capabilities?.length ?? 0) > 8 ? (
                          <CrateChip className="text-[10px] text-white/40">
                            +{(detail.capabilities?.length ?? 0) - 8} more
                          </CrateChip>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-4 rounded-md border border-white/8 bg-black/15 p-3">
                      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-white/30">
                        <ShieldCheck size={13} />
                        Account status
                      </div>
                      {canManageStatus ? (
                        <div className="mt-3 space-y-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <AdminSelect
                              value={statusDraft}
                              onChange={setStatusDraft}
                              options={STATUS_OPTIONS}
                              placeholder="Account status"
                              allowClear={false}
                              disabled={statusSaving}
                              triggerClassName="h-11 w-full max-w-none sm:w-48"
                              menuClassName="w-[220px]"
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                statusSaving ||
                                statusDraft === userStatus(detail)
                              }
                              onClick={handleStatusSave}
                            >
                              {statusSaving ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                "Save status"
                              )}
                            </Button>
                          </div>
                          <Input
                            value={statusReason}
                            onChange={(event) =>
                              setStatusReason(event.target.value)
                            }
                            placeholder="Reason for suspension/deletion"
                          />
                          {statusDraft !== "active" ? (
                            <p className="text-xs text-amber-200/75">
                              Saving this status revokes open sessions and
                              blocks future login/refresh attempts.
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <div className="mt-2 text-sm text-white/70">
                          {statusLabel(userStatus(detail))}
                        </div>
                      )}
                      {detail.status_reason ? (
                        <div className="mt-3 text-xs text-white/42">
                          Reason: {detail.status_reason}
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-md border border-white/8 bg-black/15 p-3">
                        <div className="text-[11px] uppercase tracking-[0.12em] text-white/30">
                          Created
                        </div>
                        <div className="mt-1 text-sm text-white/75">
                          {formatSessionTimestamp(detail.created_at)}
                        </div>
                      </div>
                      <div className="rounded-md border border-white/8 bg-black/15 p-3">
                        <div className="text-[11px] uppercase tracking-[0.12em] text-white/30">
                          Last login
                        </div>
                        <div className="mt-1 text-sm text-white/75">
                          {formatSessionTimestamp(detail.last_login)}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-white/10 bg-panel-surface">
                  <CardHeader>
                    <CardTitle className="text-base text-white">
                      Presence
                    </CardTitle>
                    <CardDescription>
                      Real activity, not just open tokens.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <UserPresence user={detail} />
                    <div className="grid gap-3">
                      <div className="rounded-md border border-white/8 bg-black/15 p-3">
                        <div className="text-[11px] uppercase tracking-[0.12em] text-white/30">
                          Last seen
                        </div>
                        <div className="mt-1 text-sm text-white/75">
                          {formatSessionTimestamp(detail.last_seen_at)}
                        </div>
                      </div>
                      <div className="rounded-md border border-white/8 bg-black/15 p-3">
                        <div className="text-[11px] uppercase tracking-[0.12em] text-white/30">
                          Last play event
                        </div>
                        <div className="mt-1 text-sm text-white/75">
                          {formatSessionTimestamp(detail.last_played_at)}
                        </div>
                      </div>
                    </div>
                    {detail.current_track ? (
                      <div className="rounded-md border border-cyan-400/15 bg-cyan-400/8 p-3">
                        <div className="mb-1 text-[11px] uppercase tracking-[0.12em] text-cyan-100/70">
                          {detail.listening_now
                            ? "Currently playing"
                            : "Latest track"}
                        </div>
                        <CurrentTrackLine track={detail.current_track} />
                      </div>
                    ) : null}
                  </CardContent>
                </Card>

                <Card className="border-white/10 bg-panel-surface">
                  <CardHeader>
                    <CardTitle className="text-base text-white">
                      Access & session footprint
                    </CardTitle>
                    <CardDescription>
                      Linked identity plus the real shape of the user’s device
                      history.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      {(detail.connected_accounts || []).length > 0 ? (
                        (detail.connected_accounts || []).map((account) => (
                          <CrateChip
                            key={`${detail.id}-${account.provider}`}
                            className="text-[11px]"
                          >
                            {account.provider}
                            {account.external_username
                              ? ` · ${account.external_username}`
                              : ""}
                          </CrateChip>
                        ))
                      ) : (
                        <CrateChip className="text-[11px] text-white/45">
                          No linked providers
                        </CrateChip>
                      )}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-md border border-white/8 bg-black/15 p-3">
                        <div className="text-[11px] uppercase tracking-[0.12em] text-white/30">
                          Active footprint
                        </div>
                        <div className="mt-1 text-lg font-semibold text-white">
                          {detail.active_devices ?? 0} device
                          {(detail.active_devices ?? 0) === 1 ? "" : "s"}
                        </div>
                        <div className="mt-1 text-xs text-white/38">
                          {detail.active_sessions ?? 0} active session token
                          {(detail.active_sessions ?? 0) === 1 ? "" : "s"}
                        </div>
                      </div>
                      <div className="rounded-md border border-white/8 bg-black/15 p-3">
                        <div className="text-[11px] uppercase tracking-[0.12em] text-white/30">
                          Historical tokens
                        </div>
                        <div className="mt-1 text-lg font-semibold text-white">
                          {detail.sessions.length}
                        </div>
                        <div className="mt-1 text-xs text-white/38">
                          {sessionStatusCounts.history} stale/history ·{" "}
                          {sessionStatusCounts.revoked} revoked
                        </div>
                      </div>
                    </div>
                    <div className="rounded-md border border-white/8 bg-black/15 p-3">
                      <div className="text-[11px] uppercase tracking-[0.12em] text-white/30">
                        Security
                      </div>
                      <div className="mt-1 text-sm text-white/78">
                        {authModeSummary(detail)}
                      </div>
                      {canManagePasswords ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setPasswordDialogOpen(true)}
                          >
                            <Key size={14} className="mr-2" />
                            {detail.has_password
                              ? "Reset password"
                              : "Set password"}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                    {sessionSourceSummary.length > 0 ? (
                      <div className="space-y-2">
                        <div className="text-[11px] uppercase tracking-[0.12em] text-white/30">
                          Top clients
                        </div>
                        <div className="space-y-2">
                          {sessionSourceSummary.slice(0, 4).map((source) => (
                            <div
                              key={source.key}
                              className="rounded-md border border-white/8 bg-black/15 p-3"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium text-white">
                                    {source.label}
                                  </div>
                                  <div className="mt-1 text-xs text-white/38">
                                    {source.app_id || "web"} · last seen{" "}
                                    {formatRelativeTimestamp(
                                      source.last_seen_at,
                                    )}
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {source.online + source.connected > 0 ? (
                                    <CrateChip className="border-green-500/25 bg-green-500/10 text-green-300 text-[11px]">
                                      {source.online + source.connected} active
                                    </CrateChip>
                                  ) : null}
                                  {source.recent > 0 ? (
                                    <CrateChip className="text-[11px]">
                                      {source.recent} recent
                                    </CrateChip>
                                  ) : null}
                                  {source.history > 0 ? (
                                    <CrateChip className="text-[11px] text-white/55">
                                      {source.history} history
                                    </CrateChip>
                                  ) : null}
                                  {source.revoked > 0 ? (
                                    <CrateChip className="text-[11px] text-white/45">
                                      {source.revoked} revoked
                                    </CrateChip>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {staleOpenCount > 0 ? (
                      <div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-100/80">
                        {staleOpenCount} open session
                        {staleOpenCount === 1 ? "" : "s"} look stale or
                        historical. They remain valid records, but they are not
                        counted as active devices anymore.
                      </div>
                    ) : null}
                    {canManageSessions ? (
                      <div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleRevokeAll}
                          disabled={revokingAll || detail.sessions.length === 0}
                        >
                          {revokingAll ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : null}
                          Revoke all sessions
                        </Button>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </div>

              <Card className="border-white/10 bg-panel-surface">
                <CardHeader>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <CardTitle className="text-base text-white">
                        Sessions
                      </CardTitle>
                      <CardDescription>
                        `Active` shows only real live sessions, `Recent` keeps
                        the last few days, and `All` exposes full history.
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <CratePill
                        active={sessionFilter === "active"}
                        onClick={() => setSessionFilter("active")}
                      >
                        Active
                      </CratePill>
                      <CratePill
                        active={sessionFilter === "recent"}
                        onClick={() => setSessionFilter("recent")}
                      >
                        Recent
                      </CratePill>
                      <CratePill
                        active={sessionFilter === "all"}
                        onClick={() => setSessionFilter("all")}
                      >
                        All history
                      </CratePill>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-sm text-white/45">
                    Showing {visibleSessions.length} of {detail.sessions.length}{" "}
                    recorded sessions
                  </div>
                  {sessionFilter !== "all" && hiddenSessionsCount > 0 ? (
                    <div className="rounded-md border border-white/8 bg-black/15 px-4 py-3 text-sm text-white/55">
                      {hiddenSessionsCount} historical or stale session
                      {hiddenSessionsCount === 1 ? "" : "s"} hidden to keep the
                      view focused on real devices and recent sign-ins.
                    </div>
                  ) : null}

                  {visibleSessions.length > 0 ? (
                    visibleSessions.map((session) => {
                      const status = getSessionStatus(session);
                      const metaLine = sessionMetaLine(session);
                      return (
                        <div
                          key={session.id}
                          className="flex flex-col gap-3 rounded-md border border-white/8 bg-black/15 p-4 lg:flex-row lg:items-start lg:justify-between"
                        >
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-medium text-white">
                                {sessionDisplayName(session)}
                              </div>
                              <Badge className={status.className}>
                                {status.label}
                              </Badge>
                              <CrateChip className="text-[11px]">
                                {session.app_id || "web"}
                              </CrateChip>
                            </div>
                            <div className="flex flex-wrap gap-4 text-sm text-white/45">
                              <span>
                                Seen{" "}
                                {formatRelativeTimestamp(
                                  session.last_seen_at || session.created_at,
                                )}
                              </span>
                              <span>
                                Created{" "}
                                {formatRelativeTimestamp(session.created_at)}
                              </span>
                              <span>IP {session.last_seen_ip || "—"}</span>
                            </div>
                            {metaLine ? (
                              <div className="text-xs text-white/28">
                                {metaLine}
                              </div>
                            ) : null}
                            {session.device_brand || session.device_model ? (
                              <div className="text-xs text-white/36">
                                {[session.device_brand, session.device_model]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </div>
                            ) : null}
                            <div className="text-xs font-mono text-white/20">
                              {session.id}
                            </div>
                          </div>
                          {canManageSessions ? (
                            <div className="flex shrink-0 gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={
                                  !!session.revoked_at ||
                                  revokingId === session.id
                                }
                                onClick={() => handleRevokeSession(session.id)}
                              >
                                {revokingId === session.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  "Revoke"
                                )}
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-md border border-dashed border-white/10 bg-black/15 px-6 py-10 text-center text-sm text-white/45">
                      No sessions match the current visibility filter.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {canManagePasswords ? (
        <SetPasswordDialog
          open={passwordDialogOpen && !!detail}
          onOpenChange={setPasswordDialogOpen}
          user={detail}
          onSuccess={async () => {
            if (detail) {
              await fetchDetail(detail.id);
            }
            onSuccess();
          }}
        />
      ) : null}
    </>
  );
}

function SetPasswordDialog({
  open,
  onOpenChange,
  user,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserDetail | null;
  onSuccess: () => Promise<void> | void;
}) {
  const [newPassword, setNewPassword] = useState("");
  const [revokeAllSessions, setRevokeAllSessions] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  function generatePassword() {
    const chars =
      "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
    const values = new Uint32Array(16);
    if (globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(values);
    } else {
      for (let index = 0; index < values.length; index += 1) {
        values[index] = Math.floor(Math.random() * chars.length);
      }
    }
    return Array.from(values, (value) => chars[value % chars.length]).join("");
  }

  useEffect(() => {
    if (!open) {
      setNewPassword("");
      setRevokeAllSessions(true);
      return;
    }
    setNewPassword(generatePassword());
    setRevokeAllSessions(true);
  }, [open]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!user) return;
    setSubmitting(true);
    try {
      const result = await api<{ revoked: number }>(
        `/api/auth/users/${user.id}/set-password`,
        "POST",
        {
          new_password: newPassword,
          revoke_all_sessions: revokeAllSessions,
        },
      );
      toast.success(
        revokeAllSessions
          ? `Password updated and ${result.revoked} session${
              result.revoked === 1 ? "" : "s"
            } revoked`
          : "Password updated",
      );
      onOpenChange(false);
      await onSuccess();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to update password",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {user?.has_password ? "Reset local password" : "Set local password"}
          </DialogTitle>
          <DialogDescription>
            {user?.has_password
              ? "Replace the current local password. SSO sign-in stays linked."
              : "Enable password login for this account without removing SSO providers."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label
                className="text-sm font-medium text-white/80"
                htmlFor="admin-user-password"
              >
                New password
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto px-2 py-1 text-xs text-white/60 hover:text-white"
                onClick={() => setNewPassword(generatePassword())}
              >
                Generate
              </Button>
            </div>
            <Input
              id="admin-user-password"
              type="text"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              minLength={8}
              required
            />
          </div>
          <label className="flex items-start gap-3 rounded-md border border-white/8 bg-black/15 p-3 text-sm text-white/72">
            <input
              type="checkbox"
              checked={revokeAllSessions}
              onChange={(event) => setRevokeAllSessions(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-white/20 bg-transparent"
            />
            <span>Revoke other sessions after changing the password</span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting || newPassword.trim().length < 8}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : user?.has_password ? (
                "Reset password"
              ) : (
                "Set password"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddUserDialog({
  open,
  onOpenChange,
  onSuccess,
  canAssignRoles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  canAssignRoles: boolean;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [roles, setRoles] = useState<string[]>(["user"]);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setEmail("");
    setName("");
    setPassword("");
    setRoles(["user"]);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await api("/api/auth/users", "POST", {
        email,
        name: name || undefined,
        password,
        roles: canAssignRoles ? roles : ["user"],
      });
      toast.success("User created");
      onOpenChange(false);
      reset();
      onSuccess();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to create user",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add User</DialogTitle>
          <DialogDescription>
            Create a new account with initial roles and password.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            placeholder="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
          <Input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={8}
          />
          {canAssignRoles ? (
            <div className="rounded-md border border-white/8 bg-black/15 p-3">
              <div className="mb-2 text-[11px] uppercase tracking-[0.12em] text-white/30">
                Roles
              </div>
              <RolePicker value={roles} onChange={setRoles} />
            </div>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Create"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InviteUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [email, setEmail] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("14");
  const [submitting, setSubmitting] = useState(false);
  const [invite, setInvite] = useState<AuthInvite | null>(null);

  const inviteUrl = invite ? listenRegisterUrl(invite.token) : "";

  useEffect(() => {
    if (open) return;
    setEmail("");
    setExpiresInDays("14");
    setInvite(null);
  }, [open]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;
    setSubmitting(true);
    try {
      const days = Math.max(1, Number.parseInt(expiresInDays, 10) || 14);
      const result = await api<AuthInvite>("/api/admin/auth/invites", "POST", {
        email: normalizedEmail,
        expires_in_hours: days * 24,
        max_uses: 1,
      });
      setInvite(result);
      toast.success(`Invite created for ${normalizedEmail}`);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to create invite",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function copyInvite() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      toast.success("Invite link copied");
    } catch {
      toast.error("Failed to copy invite link");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite user</DialogTitle>
          <DialogDescription>
            Create a single-use invite locked to the exact email address the
            user signs in with.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label
              className="text-sm font-medium text-white/80"
              htmlFor="invite-email"
            >
              Email
            </label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="person@example.com"
              required
            />
          </div>
          <div className="space-y-2">
            <label
              className="text-sm font-medium text-white/80"
              htmlFor="invite-expiry"
            >
              Expires in days
            </label>
            <Input
              id="invite-expiry"
              type="number"
              min={1}
              max={90}
              value={expiresInDays}
              onChange={(event) => setExpiresInDays(event.target.value)}
              required
            />
          </div>

          {invite ? (
            <div className="rounded-md border border-cyan-400/20 bg-cyan-400/8 p-3">
              <div className="text-xs uppercase tracking-[0.12em] text-cyan-100/70">
                Invite link
              </div>
              <div className="mt-2 break-all rounded-md border border-white/8 bg-black/25 p-3 font-mono text-xs text-white/72">
                {inviteUrl}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-white/42">
                <span>
                  Locked to {invite.email || email.trim().toLowerCase()} ·
                  single use
                  {invite.expires_at
                    ? ` · expires ${formatSessionTimestamp(invite.expires_at)}`
                    : ""}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={copyInvite}
                >
                  <Copy size={14} className="mr-2" />
                  Copy link
                </Button>
              </div>
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
            <Button type="submit" disabled={submitting || !email.trim()}>
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Create invite"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
