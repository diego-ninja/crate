import { useEffect, useState, type FormEvent } from "react";
import { Info, Link2, Loader2, Plus, RefreshCw, Trash2, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { api, ApiError } from "@/lib/api";

interface UserRecord {
  id: number;
  email: string;
  username?: string | null;
  name: string;
  avatar?: string | null;
  role: string;
  active_sessions?: number;
  connected_accounts?: Array<{ provider: string; status: string }>;
  last_login: string | null;
  created_at: string;
  navidrome_username?: string | null;
  navidrome_status?: string | null;
  navidrome_last_error?: string | null;
  navidrome_last_task_id?: string | null;
  navidrome_last_synced_at?: string | null;
}

function UserAvatar({ user, size = "sm" }: { user: { name?: string; email?: string; avatar?: string | null }; size?: "sm" | "md" }) {
  const dim = size === "md" ? "h-10 w-10" : "h-7 w-7";
  const textSize = size === "md" ? "text-sm" : "text-xs";
  const initial = (user.name || user.email || "?").charAt(0).toUpperCase();
  if (user.avatar) {
    return <img src={user.avatar} alt="" className={`${dim} rounded-full object-cover shrink-0`} />;
  }
  return (
    <div className={`${dim} rounded-full bg-muted flex items-center justify-center shrink-0 ${textSize} font-medium text-muted-foreground`}>
      {initial}
    </div>
  );
}

interface NavidromeUser {
  username: string;
  email?: string;
  admin_role?: boolean;
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

export function Users() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserRecord | null>(null);
  const [navidromeTarget, setNavidromeTarget] = useState<UserRecord | null>(null);
  const [detailTarget, setDetailTarget] = useState<UserRecord | null>(null);

  async function fetchUsers() {
    try {
      const data = await api<UserRecord[]>("/api/auth/users");
      setUsers(data);
    } catch {
      toast.error("Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchUsers();
  }, []);

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await api(`/api/auth/users/${deleteTarget.id}`, "DELETE");
      toast.success("User deleted");
      setDeleteTarget(null);
      fetchUsers();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to delete user");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Users</h1>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus size={16} className="mr-1" /> Add User
        </Button>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Username</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Connected</TableHead>
              <TableHead>Navidrome</TableHead>
              <TableHead>Last Login</TableHead>
              <TableHead className="w-[140px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <UserAvatar user={u} />
                    <span className="font-medium">{u.name}</span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{u.email}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{u.username || "—"}</TableCell>
                <TableCell>
                  <Badge variant={u.role === "admin" ? "default" : "secondary"}>
                    {u.role}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">
                      {u.active_sessions ?? 0} active session{(u.active_sessions ?? 0) === 1 ? "" : "s"}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {(u.connected_accounts || []).map((account) => (
                        <Badge key={account.provider} variant="outline">
                          {account.provider}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="space-y-1">
                    <Badge variant={badgeVariantForNavidromeStatus(u.navidrome_status)}>
                      {labelForNavidromeStatus(u.navidrome_status)}
                    </Badge>
                    {u.navidrome_username ? (
                      <div className="text-xs text-muted-foreground">{u.navidrome_username}</div>
                    ) : null}
                    {u.navidrome_last_error ? (
                      <div className="text-xs text-destructive line-clamp-2">{u.navidrome_last_error}</div>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {u.last_login ? new Date(u.last_login).toLocaleDateString() : "Never"}
                </TableCell>
                <TableCell className="space-x-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground"
                    onClick={() => setDetailTarget(u)}
                  >
                    <Info size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground"
                    onClick={() => setNavidromeTarget(u)}
                  >
                    <Link2 size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleteTarget(u)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {users.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  No users found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <AddUserDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSuccess={fetchUsers}
      />

      <ManageNavidromeDialog
        user={navidromeTarget}
        onOpenChange={(open) => { if (!open) setNavidromeTarget(null); }}
        onSuccess={fetchUsers}
      />

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

function formatSessionTimestamp(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>User Detail</DialogTitle>
          <DialogDescription>
            Inspect linked providers, last login, and revoke individual sessions when needed.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : detail ? (
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-border p-4">
                <div className="flex items-center gap-3">
                  <UserAvatar user={detail} size="md" />
                  <div className="min-w-0">
                    <div className="text-lg font-semibold">{detail.name || detail.email}</div>
                    <div className="text-sm text-muted-foreground truncate">{detail.email}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant={detail.role === "admin" ? "default" : "secondary"}>{detail.role}</Badge>
                  {detail.username ? <Badge variant="outline">@{detail.username}</Badge> : null}
                </div>
                {detail.bio ? <p className="mt-3 text-sm text-muted-foreground">{detail.bio}</p> : null}
                <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <div className="font-medium text-foreground">Created</div>
                    <div>{formatSessionTimestamp(detail.created_at)}</div>
                  </div>
                  <div>
                    <div className="font-medium text-foreground">Last login</div>
                    <div>{formatSessionTimestamp(detail.last_login)}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border p-4">
                <div className="text-sm font-semibold">Connected providers</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(detail.connected_accounts || []).length > 0 ? (
                    detail.connected_accounts?.map((account) => (
                      <Badge key={account.provider} variant={account.status === "linked" || account.status === "synced" ? "default" : "outline"}>
                        {account.provider} · {account.status}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">No linked providers</span>
                  )}
                </div>
                <div className="mt-4 text-sm font-semibold">Sessions</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {detail.sessions.filter((session) => !session.revoked_at).length} active · {detail.sessions.length} total
                </div>
                <div className="mt-4">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleRevokeAll}
                    disabled={revokingAll || detail.sessions.length === 0}
                  >
                    {revokingAll ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                    Revoke all sessions
                  </Button>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>App</TableHead>
                    <TableHead>Last Seen</TableHead>
                    <TableHead>Device</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[120px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.sessions.map((session) => (
                    <TableRow key={session.id}>
                      <TableCell>
                        <div className="text-sm font-medium">{session.app_id || "web"}</div>
                        <div className="text-xs text-muted-foreground">{session.id.slice(0, 8)}</div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatSessionTimestamp(session.last_seen_at || session.created_at)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[180px] truncate" title={session.user_agent || undefined}>
                        {session.device_label || "Unknown device"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {session.last_seen_ip || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={session.revoked_at ? "outline" : "default"}>
                          {session.revoked_at ? "Revoked" : "Active"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!!session.revoked_at || revokingId === session.id}
                          onClick={() => handleRevokeSession(session.id)}
                        >
                          {revokingId === session.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Revoke"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {detail.sessions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        No sessions recorded
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function labelForNavidromeStatus(status?: string | null) {
  if (status === "synced") return "Synced";
  if (status === "pending") return "Pending";
  if (status === "errored") return "Errored";
  return "Unlinked";
}

function badgeVariantForNavidromeStatus(status?: string | null): "default" | "secondary" | "destructive" | "outline" {
  if (status === "synced") return "default";
  if (status === "pending") return "secondary";
  if (status === "errored") return "destructive";
  return "outline";
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const created = await api<{ navidrome_task_id?: string }>("/api/auth/users", "POST", { email, name, password, role });
      toast.success(created.navidrome_task_id ? "User created and Navidrome sync queued" : "User created");
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
          <DialogDescription>Create a new user account.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="viewer">Viewer</SelectItem>
            </SelectContent>
          </Select>
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

function ManageNavidromeDialog({
  user,
  onOpenChange,
  onSuccess,
}: {
  user: UserRecord | null;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const open = !!user;
  const [existingUsers, setExistingUsers] = useState<NavidromeUser[]>([]);
  const [mode, setMode] = useState<"existing" | "create">("existing");
  const [username, setUsername] = useState("");
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    setMode(user.navidrome_status === "unlinked" || !user.navidrome_username ? "create" : "existing");
    setUsername(user.navidrome_username || user.username || user.email.split("@")[0] || "");
    setLoadingUsers(true);
    api<NavidromeUser[]>("/api/auth/navidrome/users")
      .then((data) => setExistingUsers(data))
      .catch((err) => {
        toast.error(err instanceof ApiError ? err.message : "Failed to load Navidrome users");
        setExistingUsers([]);
      })
      .finally(() => setLoadingUsers(false));
  }, [open, user]);

  async function handleLink() {
    if (!user || !username.trim()) return;
    setSubmitting(true);
    try {
      const result = await api<{ task_id?: string }>(`/api/auth/users/${user.id}/navidrome-link`, "POST", {
        username: username.trim(),
        create_if_missing: mode === "create",
      });
      toast.success(
        mode === "create"
          ? `Navidrome sync queued${result.task_id ? ` · task ${result.task_id.slice(0, 8)}` : ""}`
          : "Navidrome user linked",
      );
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to link Navidrome user");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUnlink() {
    if (!user) return;
    setSubmitting(true);
    try {
      await api(`/api/auth/users/${user.id}/navidrome-unlink`, "POST");
      toast.success("Navidrome link removed");
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to unlink Navidrome user");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Navidrome Sync</DialogTitle>
          <DialogDescription>
            Link {user?.name || user?.email} to an existing Navidrome user or create/sync one automatically.
          </DialogDescription>
        </DialogHeader>

        {user ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-border p-3 space-y-1">
              <div className="text-sm font-medium">{user.name || user.email}</div>
              <div className="text-xs text-muted-foreground">{user.email}</div>
              <div className="flex items-center gap-2 pt-1">
                <Badge variant={badgeVariantForNavidromeStatus(user.navidrome_status)}>
                  {labelForNavidromeStatus(user.navidrome_status)}
                </Badge>
                {user.navidrome_username ? (
                  <span className="text-xs text-muted-foreground">{user.navidrome_username}</span>
                ) : null}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Mode</div>
              <Select value={mode} onValueChange={(value: "existing" | "create") => setMode(value)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="existing">Link existing user</SelectItem>
                  <SelectItem value="create">Create or sync user</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {mode === "existing" ? (
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Existing Navidrome user</div>
                <Select value={username} onValueChange={setUsername} disabled={loadingUsers || existingUsers.length === 0}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={loadingUsers ? "Loading users..." : "Select Navidrome user"} />
                  </SelectTrigger>
                  <SelectContent>
                    {existingUsers.map((navUser) => (
                      <SelectItem key={navUser.username} value={navUser.username}>
                        {navUser.username}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {existingUsers.length === 0 && !loadingUsers ? (
                  <p className="text-xs text-muted-foreground">No Navidrome users found.</p>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Navidrome username</div>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="navidrome username"
                />
                <p className="text-xs text-muted-foreground">
                  This queues a background sync task. If Navidrome is down, Dramatiq will retry before leaving it errored.
                </p>
              </div>
            )}

            {user.navidrome_last_error ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {user.navidrome_last_error}
              </div>
            ) : null}

            <div className="flex justify-between gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleUnlink}
                disabled={submitting || !user.navidrome_username}
              >
                <Unlink size={14} className="mr-1" />
                Unlink
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="button" onClick={handleLink} disabled={submitting || !username.trim()}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "create" ? <RefreshCw size={14} className="mr-1" /> : <Link2 size={14} className="mr-1" />}
                  {mode === "create" ? "Sync user" : "Link user"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
