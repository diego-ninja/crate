import { useEffect, useState, type FormEvent } from "react";
import { Info, Loader2, Plus, Trash2 } from "lucide-react";
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
}

function UserAvatar({ user, size = "sm" }: { user: { name?: string; email?: string; avatar?: string | null }; size?: "sm" | "md" }) {
  const dim = size === "md" ? "h-10 w-10" : "h-7 w-7";
  const textSize = size === "md" ? "text-sm" : "text-xs";
  const initial = (user.name || user.email || "?").charAt(0).toUpperCase();
  if (user.avatar) {
    return <img src={user.avatar} alt="" className={`${dim} rounded-md object-cover shrink-0`} />;
  }
  return (
    <div className={`${dim} rounded-md bg-muted flex items-center justify-center shrink-0 ${textSize} font-medium text-muted-foreground`}>
      {initial}
    </div>
  );
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

      <div className="border border-border rounded-md overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Username</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Connected</TableHead>
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
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
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
              <div className="rounded-md border border-border p-4">
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

              <div className="rounded-md border border-border p-4">
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

            <div className="rounded-md border border-border overflow-hidden">
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

