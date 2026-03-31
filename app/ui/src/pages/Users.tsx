import { useEffect, useState, type FormEvent } from "react";
import { Link2, Loader2, Plus, RefreshCw, Trash2, Unlink } from "lucide-react";
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
  role: string;
  last_login: string | null;
  created_at: string;
  navidrome_username?: string | null;
  navidrome_status?: string | null;
  navidrome_last_error?: string | null;
  navidrome_last_task_id?: string | null;
  navidrome_last_synced_at?: string | null;
}

interface NavidromeUser {
  username: string;
  email?: string;
  admin_role?: boolean;
}

export function Users() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserRecord | null>(null);
  const [navidromeTarget, setNavidromeTarget] = useState<UserRecord | null>(null);

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
              <TableHead>Navidrome</TableHead>
              <TableHead>Last Login</TableHead>
              <TableHead className="w-[140px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.name}</TableCell>
                <TableCell className="text-muted-foreground">{u.email}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{u.username || "—"}</TableCell>
                <TableCell>
                  <Badge variant={u.role === "admin" ? "default" : "secondary"}>
                    {u.role}
                  </Badge>
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

      <ManageNavidromeDialog
        user={navidromeTarget}
        onOpenChange={(open) => { if (!open) setNavidromeTarget(null); }}
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
