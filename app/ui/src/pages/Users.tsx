import { lazy, Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";
import {
  Activity,
  Headphones,
  Info,
  Loader2,
  Mail,
  Monitor,
  Music,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";

const UserMap = lazy(() => import("@/components/users/UserMap").then((m) => ({ default: m.UserMap })));
import { toast } from "sonner";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { AdminSelect } from "@/components/ui/AdminSelect";
import { CrateChip, CratePill } from "@/components/ui/CrateBadge";
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
  track_storage_id?: string | null;
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
  active_sessions?: number;
  active_devices?: number;
  online_now?: boolean;
  listening_now?: boolean;
  current_track?: CurrentTrack | null;
  last_played_at?: string | null;
  last_seen_at?: string | null;
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
}

interface UserDetail extends UserRecord {
  bio?: string | null;
  sessions: UserSession[];
}

type UserFilter = "all" | "online" | "listening" | "admins";
type SessionFilter = "connected" | "recent" | "all";

const SESSION_ONLINE_WINDOW_MS = 10 * 60 * 1000;
const SESSION_CONNECTED_WINDOW_MS = 30 * 60 * 1000;
const SESSION_RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

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
    return <img src={user.avatar} alt="" className={`${dim} rounded-md object-cover shrink-0`} />;
  }

  return (
    <div className={`${dim} rounded-md border border-white/10 bg-white/[0.04] flex items-center justify-center shrink-0 font-medium text-white/60`}>
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

function sessionUaLabel(userAgent?: string | null) {
  const raw = (userAgent || "").trim();
  if (!raw) return "Unknown client";
  const lowered = raw.toLowerCase();
  if (lowered.startsWith("curl/")) return "curl";
  if (lowered.startsWith("wget")) return "Wget";
  if (lowered.startsWith("python-urllib")) return "Python urllib";
  if (lowered.includes("chrome")) return "Chrome";
  if (lowered.includes("safari") && !lowered.includes("chrome")) return "Safari";
  if (lowered.includes("firefox")) return "Firefox";
  return raw.split(" ")[0]?.split("/")[0] || "Unknown client";
}

function sessionDisplayName(session: UserSession) {
  return session.device_label || session.app_id || sessionUaLabel(session.user_agent);
}

function sessionSourceKey(session: UserSession) {
  return [
    session.device_label?.trim().toLowerCase() || "",
    session.app_id?.trim().toLowerCase() || "",
    sessionUaLabel(session.user_agent).trim().toLowerCase(),
  ].join("::");
}

function getSessionStatus(session: UserSession) {
  const now = Date.now();
  const lastSeen = new Date(session.last_seen_at || session.created_at).getTime();
  const expires = new Date(session.expires_at).getTime();

  if (session.revoked_at) {
    return {
      key: "revoked",
      label: "Revoked",
      className: "border-white/12 bg-transparent text-white/60",
    };
  }
  if (!Number.isNaN(expires) && expires < now) {
    return {
      key: "expired",
      label: "Expired",
      className: "border-amber-500/25 bg-amber-500/10 text-amber-200",
    };
  }
  if (!Number.isNaN(lastSeen) && (now - lastSeen) <= SESSION_ONLINE_WINDOW_MS) {
    return {
      key: "online",
      label: "Online now",
      className: "border-green-500/25 bg-green-500/10 text-green-300",
    };
  }
  if (!Number.isNaN(lastSeen) && (now - lastSeen) <= SESSION_CONNECTED_WINDOW_MS) {
    return {
      key: "connected",
      label: "Connected",
      className: "border-cyan-400/25 bg-cyan-400/10 text-cyan-200",
    };
  }
  if (!Number.isNaN(lastSeen) && (now - lastSeen) <= SESSION_RECENT_WINDOW_MS) {
    return {
      key: "recent",
      label: "Recent",
      className: "border-white/12 bg-white/[0.04] text-white/70",
    };
  }
  return {
    key: "history",
    label: "History",
    className: "border-white/8 bg-black/15 text-white/45",
  };
}

function filterSessions(sessions: UserSession[], mode: SessionFilter) {
  if (mode === "all") return sessions;
  return sessions.filter((session) => {
    const status = getSessionStatus(session).key;
    if (mode === "connected") return status === "online" || status === "connected";
    return status === "online" || status === "connected" || status === "recent";
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
      existing.last_seen_at = toTimestamp(lastSeenAt) > toTimestamp(existing.last_seen_at) ? lastSeenAt : existing.last_seen_at;
      if (status === "online") existing.online += 1;
      else if (status === "connected") existing.connected += 1;
      else if (status === "recent") existing.recent += 1;
      else if (status === "revoked") existing.revoked += 1;
      else existing.history += 1;
      continue;
    }

    groups.set(key, {
      key,
      label: sessionDisplayName(session),
      count: 1,
      online: status === "online" ? 1 : 0,
      connected: status === "connected" ? 1 : 0,
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
  if (left.listening_now !== right.listening_now) return Number(right.listening_now) - Number(left.listening_now);
  if (left.online_now !== right.online_now) return Number(right.online_now) - Number(left.online_now);
  if ((left.active_devices ?? 0) !== (right.active_devices ?? 0)) return (right.active_devices ?? 0) - (left.active_devices ?? 0);
  if ((left.active_sessions ?? 0) !== (right.active_sessions ?? 0)) return (right.active_sessions ?? 0) - (left.active_sessions ?? 0);
  const lastSeenDiff = toTimestamp(right.last_seen_at || right.last_login) - toTimestamp(left.last_seen_at || left.last_login);
  if (lastSeenDiff !== 0) return lastSeenDiff;
  return (left.name || left.email).localeCompare(right.name || right.email);
}

function UserPresence({
  user,
  compact = false,
}: {
  user: Pick<UserRecord, "online_now" | "listening_now" | "active_devices" | "active_sessions" | "last_seen_at" | "current_track">;
  compact?: boolean;
}) {
  const baseClass = compact ? "text-[11px]" : "text-xs";

  return (
    <div className="flex flex-wrap gap-2">
      <CrateChip
        icon={Activity}
        className={user.online_now ? "border-green-500/25 bg-green-500/10 text-green-300" : "border-white/10 bg-white/[0.04] text-white/55"}
      >
        {user.online_now ? "Online now" : user.last_seen_at ? `Last seen ${formatRelativeTimestamp(user.last_seen_at)}` : "Offline"}
      </CrateChip>
      <CrateChip
        icon={Headphones}
        className={user.listening_now ? "border-cyan-400/25 bg-cyan-400/10 text-cyan-200" : "border-white/10 bg-white/[0.04] text-white/55"}
      >
        {user.listening_now ? "Listening now" : "Not playing"}
      </CrateChip>
      <CrateChip icon={Monitor} className={baseClass}>
        {user.active_devices ?? 0} device{(user.active_devices ?? 0) === 1 ? "" : "s"}
      </CrateChip>
      <CrateChip icon={ShieldCheck} className={baseClass}>
        {user.active_sessions ?? 0} live session{(user.active_sessions ?? 0) === 1 ? "" : "s"}
      </CrateChip>
    </div>
  );
}

function CurrentTrackLine({ track }: { track?: CurrentTrack | null }) {
  if (!track?.title) return null;
  const artistHref = track.artist_id != null
    ? artistPagePath({ artistId: track.artist_id, artistSlug: track.artist_slug || undefined, artistName: track.artist || "" })
    : null;
  const albumHref = track.album_id != null
    ? albumPagePath({ albumId: track.album_id, albumSlug: track.album_slug || undefined, artistName: track.artist || "", albumName: track.album || "" })
    : null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm text-white/65">
      <Music size={14} className="text-cyan-300" />
      <span className="text-white/82">{track.title}</span>
      {track.artist ? (
        <>
          <span className="text-white/28">by</span>
          {artistHref ? <Link to={artistHref} className="hover:text-white">{track.artist}</Link> : <span>{track.artist}</span>}
        </>
      ) : null}
      {track.album ? (
        <>
          <span className="text-white/28">on</span>
          {albumHref ? <Link to={albumHref} className="hover:text-white">{track.album}</Link> : <span>{track.album}</span>}
        </>
      ) : null}
    </div>
  );
}

export function Users() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserRecord | null>(null);
  const [detailTarget, setDetailTarget] = useState<UserRecord | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<UserFilter>("all");

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

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await api(`/api/auth/users/${deleteTarget.id}`, "DELETE");
      toast.success("User deleted");
      setDeleteTarget(null);
      await fetchUsers();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete user");
    }
  }

  const counts = useMemo(() => ({
    total: users.length,
    online: users.filter((user) => user.online_now).length,
    listening: users.filter((user) => user.listening_now).length,
    devices: users.reduce((sum, user) => sum + (user.active_devices ?? 0), 0),
  }), [users]);

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return users
      .filter((user) => {
        const matchesFilter =
          filter === "all"
          || (filter === "online" && user.online_now)
          || (filter === "listening" && user.listening_now)
          || (filter === "admins" && user.role === "admin");

        const providerText = (user.connected_accounts || []).map((account) => account.provider).join(" ");
        const haystack = `${user.name} ${user.email} ${user.username ?? ""} ${providerText}`.toLowerCase();
        const matchesQuery = !normalizedQuery || haystack.includes(normalizedQuery);
        return matchesFilter && matchesQuery;
      })
      .sort(sortUsersByPresence);
  }, [filter, query, users]);

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
                <h1 className="text-2xl font-semibold tracking-tight text-white">Users</h1>
                <p className="text-sm text-white/55">
                  Presence, linked identities, active devices and recent listening activity across the system.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <CrateChip icon={UserRound}>{counts.total} total users</CrateChip>
              <CrateChip icon={Activity} className={counts.online > 0 ? "border-green-500/25 bg-green-500/10 text-green-300" : undefined}>
                {counts.online} online now
              </CrateChip>
              <CrateChip icon={Headphones} className={counts.listening > 0 ? "border-cyan-400/25 bg-cyan-400/10 text-cyan-200" : undefined}>
                {counts.listening} listening
              </CrateChip>
              <CrateChip icon={Monitor}>{counts.devices} active devices</CrateChip>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus size={16} className="mr-2" />
              Add user
            </Button>
          </div>
        </div>
      </section>

      <Suspense fallback={null}>
        <UserMap />
      </Suspense>

      <Card className="border-white/10 bg-panel-surface shadow-[0_24px_70px_rgba(0,0,0,0.2)]">
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full max-w-md">
              <Search size={14} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/35" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search users..."
                className="pl-10"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                { key: "all", label: "All", count: users.length },
                { key: "online", label: "Online", count: users.filter((user) => user.online_now).length },
                { key: "listening", label: "Listening", count: users.filter((user) => user.listening_now).length },
                { key: "admins", label: "Admins", count: users.filter((user) => user.role === "admin").length },
              ].map((item) => (
                <CratePill key={item.key} active={filter === item.key} onClick={() => setFilter(item.key as UserFilter)}>
                  {item.label} {item.count}
                </CratePill>
              ))}
            </div>
          </div>

          <div className="text-sm text-white/45">
            Showing {filteredUsers.length} of {users.length} users
          </div>

          <div className="space-y-3">
            {filteredUsers.map((user) => (
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
                          <h2 className="text-lg font-semibold tracking-tight text-white">{user.name || user.email}</h2>
                          <Badge variant={user.role === "admin" ? "default" : "secondary"}>{user.role}</Badge>
                          {user.username ? <Badge variant="outline">@{user.username}</Badge> : null}
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
                        <CrateChip key={`${user.id}-${account.provider}`} className="text-[11px]">
                          {account.provider}
                          {account.external_username ? ` · ${account.external_username}` : ""}
                        </CrateChip>
                      ))}
                      {(user.connected_accounts || []).length === 0 ? (
                        <CrateChip className="text-[11px] text-white/45">No linked providers</CrateChip>
                      ) : null}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-md border border-white/8 bg-black/15 p-3">
                        <div className="text-[11px] uppercase tracking-[0.12em] text-white/28">Presence</div>
                        <div className="mt-1 text-sm text-white/78">
                          {(user.active_devices ?? 0) > 0
                            ? `${user.active_devices} live device${(user.active_devices ?? 0) === 1 ? "" : "s"}`
                            : user.last_seen_at
                              ? `Seen ${formatRelativeTimestamp(user.last_seen_at)}`
                              : "No activity yet"}
                        </div>
                      </div>
                      <div className="rounded-md border border-white/8 bg-black/15 p-3">
                        <div className="text-[11px] uppercase tracking-[0.12em] text-white/28">Playback</div>
                        <div className="mt-1 text-sm text-white/78">
                          {user.current_track?.title
                            ? `${user.current_track.title}${user.current_track.artist ? ` · ${user.current_track.artist}` : ""}`
                            : user.last_played_at
                              ? `Last play ${formatRelativeTimestamp(user.last_played_at)}`
                              : "No play signal"}
                        </div>
                      </div>
                      <div className="rounded-md border border-white/8 bg-black/15 p-3">
                        <div className="text-[11px] uppercase tracking-[0.12em] text-white/28">Identity</div>
                        <div className="mt-1 text-sm text-white/78">
                          {(user.connected_accounts || []).length > 0
                            ? `${user.connected_accounts?.length ?? 0} linked provider${(user.connected_accounts?.length ?? 0) === 1 ? "" : "s"}`
                            : "Password-only account"}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex min-w-[220px] flex-col gap-3 xl:items-end">
                    <div className="grid grid-cols-2 gap-3 text-sm text-white/45 xl:text-right">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.12em] text-white/28">Last seen</div>
                        <div className="mt-1 text-white/75">{formatRelativeTimestamp(user.last_seen_at)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.12em] text-white/28">Last login</div>
                        <div className="mt-1 text-white/75">{formatRelativeTimestamp(user.last_login)}</div>
                      </div>
                    </div>
                    <div className="flex gap-2 xl:justify-end">
                      <Button variant="outline" size="sm" onClick={() => setDetailTarget(user)}>
                        <Info size={14} className="mr-2" />
                        Inspect
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-red-500/25 text-red-300 hover:bg-red-500/10 hover:text-red-200"
                        onClick={() => setDeleteTarget(user)}
                      >
                        <Trash2 size={14} className="mr-2" />
                        Delete
                      </Button>
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
        </CardContent>
      </Card>

      <AddUserDialog open={addOpen} onOpenChange={setAddOpen} onSuccess={fetchUsers} />

      <UserDetailDialog
        user={detailTarget}
        onOpenChange={(open) => { if (!open) setDetailTarget(null); }}
        onSuccess={fetchUsers}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete user"
        description={`Are you sure you want to delete ${deleteTarget?.name}? This action cannot be undone.`}
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
}: {
  user: UserRecord | null;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const open = !!user;
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>("connected");

  async function fetchDetail(userId: number) {
    setLoading(true);
    try {
      const data = await api<UserDetail>(`/api/auth/users/${userId}`);
      setDetail(data);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to load user detail");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open || !user) {
      setDetail(null);
      return;
    }
    setSessionFilter("connected");
    void fetchDetail(user.id);
  }, [open, user]);

  async function handleRevokeSession(sessionId: string) {
    if (!detail) return;
    setRevokingId(sessionId);
    try {
      await api(`/api/auth/users/${detail.id}/sessions/${sessionId}`, "DELETE");
      toast.success("Session revoked");
      await fetchDetail(detail.id);
      onSuccess();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to revoke session");
    } finally {
      setRevokingId(null);
    }
  }

  async function handleRevokeAll() {
    if (!detail) return;
    setRevokingAll(true);
    try {
      const result = await api<{ revoked: number }>(`/api/auth/users/${detail.id}/sessions/revoke-all`, "POST");
      toast.success(`Revoked ${result.revoked} session${result.revoked === 1 ? "" : "s"}`);
      await fetchDetail(detail.id);
      onSuccess();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to revoke sessions");
    } finally {
      setRevokingAll(false);
    }
  }

  const visibleSessions = useMemo(() => filterSessions(detail?.sessions ?? [], sessionFilter), [detail?.sessions, sessionFilter]);
  const openSessions = useMemo(() => (detail?.sessions ?? []).filter((session) => !session.revoked_at), [detail?.sessions]);
  const staleOpenCount = useMemo(
    () => openSessions.filter((session) => {
      const status = getSessionStatus(session).key;
      return status === "history" || status === "expired";
    }).length,
    [openSessions],
  );
  const sessionSourceSummary = useMemo(() => summarizeSessions(detail?.sessions ?? []), [detail?.sessions]);
  const sessionStatusCounts = useMemo(
    () => (detail?.sessions ?? []).reduce(
      (acc, session) => {
        const status = getSessionStatus(session).key;
        if (status === "online" || status === "connected") acc.connected += 1;
        else if (status === "recent") acc.recent += 1;
        else if (status === "revoked") acc.revoked += 1;
        else acc.history += 1;
        return acc;
      },
      { connected: 0, recent: 0, history: 0, revoked: 0 },
    ),
    [detail?.sessions],
  );
  const hiddenSessionsCount = Math.max((detail?.sessions?.length ?? 0) - visibleSessions.length, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>User Detail</DialogTitle>
          <DialogDescription>
            Inspect real-time presence, what the user is currently hearing, and filter session history by meaningful recency.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : detail ? (
          <div className="space-y-5">
            <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr_1fr]">
              <Card className="border-white/10 bg-panel-surface">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-4">
                    <UserAvatar user={detail} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-xl font-semibold tracking-tight text-white">{detail.name || detail.email}</h3>
                        <Badge variant={detail.role === "admin" ? "default" : "secondary"}>{detail.role}</Badge>
                        {detail.username ? <Badge variant="outline">@{detail.username}</Badge> : null}
                      </div>
                      <div className="mt-1 text-sm text-white/45">{detail.email}</div>
                    </div>
                  </div>
                  {detail.bio ? <p className="mt-4 text-sm leading-relaxed text-white/58">{detail.bio}</p> : null}
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-md border border-white/8 bg-black/15 p-3">
                      <div className="text-[11px] uppercase tracking-[0.12em] text-white/30">Created</div>
                      <div className="mt-1 text-sm text-white/75">{formatSessionTimestamp(detail.created_at)}</div>
                    </div>
                    <div className="rounded-md border border-white/8 bg-black/15 p-3">
                      <div className="text-[11px] uppercase tracking-[0.12em] text-white/30">Last login</div>
                      <div className="mt-1 text-sm text-white/75">{formatSessionTimestamp(detail.last_login)}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-panel-surface">
                <CardHeader>
                  <CardTitle className="text-base text-white">Presence</CardTitle>
                  <CardDescription>Real activity, not just open tokens.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <UserPresence user={detail} />
                  <div className="grid gap-3">
                    <div className="rounded-md border border-white/8 bg-black/15 p-3">
                      <div className="text-[11px] uppercase tracking-[0.12em] text-white/30">Last seen</div>
                      <div className="mt-1 text-sm text-white/75">{formatSessionTimestamp(detail.last_seen_at)}</div>
                    </div>
                    <div className="rounded-md border border-white/8 bg-black/15 p-3">
                      <div className="text-[11px] uppercase tracking-[0.12em] text-white/30">Last play event</div>
                      <div className="mt-1 text-sm text-white/75">{formatSessionTimestamp(detail.last_played_at)}</div>
                    </div>
                  </div>
                  {detail.current_track ? (
                    <div className="rounded-md border border-cyan-400/15 bg-cyan-400/8 p-3">
                      <div className="mb-1 text-[11px] uppercase tracking-[0.12em] text-cyan-100/70">
                        {detail.listening_now ? "Currently playing" : "Latest track"}
                      </div>
                      <CurrentTrackLine track={detail.current_track} />
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-panel-surface">
                <CardHeader>
                  <CardTitle className="text-base text-white">Access & session footprint</CardTitle>
                  <CardDescription>Linked identity plus the real shape of the user’s device history.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {(detail.connected_accounts || []).length > 0 ? (
                      (detail.connected_accounts || []).map((account) => (
                        <CrateChip key={`${detail.id}-${account.provider}`} className="text-[11px]">
                          {account.provider}
                          {account.external_username ? ` · ${account.external_username}` : ""}
                        </CrateChip>
                      ))
                    ) : (
                      <CrateChip className="text-[11px] text-white/45">No linked providers</CrateChip>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-md border border-white/8 bg-black/15 p-3">
                      <div className="text-[11px] uppercase tracking-[0.12em] text-white/30">Live footprint</div>
                      <div className="mt-1 text-lg font-semibold text-white">
                        {detail.active_devices ?? 0} device{(detail.active_devices ?? 0) === 1 ? "" : "s"}
                      </div>
                      <div className="mt-1 text-xs text-white/38">
                        {detail.active_sessions ?? 0} current session token{(detail.active_sessions ?? 0) === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div className="rounded-md border border-white/8 bg-black/15 p-3">
                      <div className="text-[11px] uppercase tracking-[0.12em] text-white/30">Historical tokens</div>
                      <div className="mt-1 text-lg font-semibold text-white">{detail.sessions.length}</div>
                      <div className="mt-1 text-xs text-white/38">
                        {sessionStatusCounts.history} stale/history · {sessionStatusCounts.revoked} revoked
                      </div>
                    </div>
                  </div>
                  {sessionSourceSummary.length > 0 ? (
                    <div className="space-y-2">
                      <div className="text-[11px] uppercase tracking-[0.12em] text-white/30">Top clients</div>
                      <div className="space-y-2">
                        {sessionSourceSummary.slice(0, 4).map((source) => (
                          <div key={source.key} className="rounded-md border border-white/8 bg-black/15 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-white">{source.label}</div>
                                <div className="mt-1 text-xs text-white/38">
                                  {source.app_id || "web"} · last seen {formatRelativeTimestamp(source.last_seen_at)}
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {(source.online + source.connected) > 0 ? (
                                  <CrateChip className="border-green-500/25 bg-green-500/10 text-green-300 text-[11px]">
                                    {source.online + source.connected} live
                                  </CrateChip>
                                ) : null}
                                {source.recent > 0 ? <CrateChip className="text-[11px]">{source.recent} recent</CrateChip> : null}
                                {source.history > 0 ? <CrateChip className="text-[11px] text-white/55">{source.history} history</CrateChip> : null}
                                {source.revoked > 0 ? <CrateChip className="text-[11px] text-white/45">{source.revoked} revoked</CrateChip> : null}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {staleOpenCount > 0 ? (
                    <div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-100/80">
                      {staleOpenCount} open session{staleOpenCount === 1 ? "" : "s"} look stale or historical. These rows are real session records, but they do not mean the user has that many devices connected right now.
                    </div>
                  ) : null}
                  <div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleRevokeAll}
                      disabled={revokingAll || detail.sessions.length === 0}
                    >
                      {revokingAll ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Revoke all sessions
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="border-white/10 bg-panel-surface">
              <CardHeader>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <CardTitle className="text-base text-white">Sessions</CardTitle>
                    <CardDescription>
                      `Connected` shows live devices, `Recent` keeps the last few days, and `All` exposes full history.
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <CratePill active={sessionFilter === "connected"} onClick={() => setSessionFilter("connected")}>
                      Connected
                    </CratePill>
                    <CratePill active={sessionFilter === "recent"} onClick={() => setSessionFilter("recent")}>
                      Recent
                    </CratePill>
                    <CratePill active={sessionFilter === "all"} onClick={() => setSessionFilter("all")}>
                      All history
                    </CratePill>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm text-white/45">
                  Showing {visibleSessions.length} of {detail.sessions.length} recorded sessions
                </div>
                {sessionFilter !== "all" && hiddenSessionsCount > 0 ? (
                  <div className="rounded-md border border-white/8 bg-black/15 px-4 py-3 text-sm text-white/55">
                    {hiddenSessionsCount} historical or stale session{hiddenSessionsCount === 1 ? "" : "s"} hidden to keep the view focused on real devices and recent sign-ins.
                  </div>
                ) : null}

                {visibleSessions.length > 0 ? (
                  visibleSessions.map((session) => {
                    const status = getSessionStatus(session);
                    return (
                      <div
                        key={session.id}
                        className="flex flex-col gap-3 rounded-md border border-white/8 bg-black/15 p-4 lg:flex-row lg:items-start lg:justify-between"
                      >
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-medium text-white">{sessionDisplayName(session)}</div>
                            <Badge className={status.className}>{status.label}</Badge>
                            <CrateChip className="text-[11px]">{session.app_id || "web"}</CrateChip>
                          </div>
                          <div className="flex flex-wrap gap-4 text-sm text-white/45">
                            <span>Seen {formatRelativeTimestamp(session.last_seen_at || session.created_at)}</span>
                            <span>Created {formatRelativeTimestamp(session.created_at)}</span>
                            <span>IP {session.last_seen_ip || "—"}</span>
                          </div>
                          <div className="text-xs text-white/28">
                            {session.user_agent || "No user agent"}
                          </div>
                          <div className="text-xs font-mono text-white/20">
                            {session.id}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!!session.revoked_at || revokingId === session.id}
                            onClick={() => handleRevokeSession(session.id)}
                          >
                            {revokingId === session.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Revoke"}
                          </Button>
                        </div>
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
  );
}

function AddUserDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setEmail("");
    setName("");
    setPassword("");
    setRole("user");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await api("/api/auth/users", "POST", { email, name: name || undefined, password, role });
      toast.success("User created");
      onOpenChange(false);
      reset();
      onSuccess();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create user");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add User</DialogTitle>
          <DialogDescription>Create a new account with an initial role and password.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input placeholder="Name" value={name} onChange={(event) => setName(event.target.value)} required />
          <Input type="email" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={6}
          />
          <AdminSelect
            value={role}
            onChange={setRole}
            options={[
              { value: "admin", label: "Admin" },
              { value: "user", label: "User" },
              { value: "viewer", label: "Viewer" },
            ]}
            placeholder="Select role"
            allowClear={false}
            triggerClassName="max-w-full"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
