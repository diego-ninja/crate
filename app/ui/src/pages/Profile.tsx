import { useState, type FormEvent } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { User, Lock, Link2, Unlink } from "lucide-react";

export function Profile() {
  const { user, refetch } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [username, setUsername] = useState(user?.username || "");
  const [bio, setBio] = useState(user?.bio || "");
  const [saving, setSaving] = useState(false);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [changingPw, setChangingPw] = useState(false);

  const connectedAccounts = user?.connected_accounts || [];
  const linkedProviders = new Set(connectedAccounts.filter((item) => item.status !== "unlinked").map((item) => item.provider));

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api("/api/auth/profile", "PUT", { name, username: username.trim() || null, bio });
      toast.success("Profile updated");
      await refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    if (newPw !== confirmPw) {
      toast.error("Passwords don't match");
      return;
    }
    if (newPw.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setChangingPw(true);
    try {
      await api("/api/auth/change-password", "POST", {
        current_password: currentPw,
        new_password: newPw,
      });
      toast.success("Password changed");
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to change password");
    } finally {
      setChangingPw(false);
    }
  }

  async function handleUnlinkProvider(provider: string) {
    try {
      await api(`/api/auth/oauth/${provider}/unlink`, "POST");
      toast.success(`${provider} account unlinked`);
      await refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to unlink");
    }
  }

  function startProviderLink(provider: string) {
    window.location.href = `/api/auth/${provider}?return_to=${encodeURIComponent(window.location.origin + "/profile")}`;
  }

  if (!user) return null;

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold mb-6">Profile</h1>

      {/* Profile info */}
      <div className="bg-card border border-border rounded-lg p-6 mb-6">
        <div className="flex items-center gap-4 mb-6">
          {user.avatar ? (
            <img src={user.avatar} alt="" className="w-16 h-16 rounded-full" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <User size={24} className="text-primary" />
            </div>
          )}
          <div>
            <div className="font-semibold text-lg">{user.name || user.email}</div>
            <div className="text-sm text-muted-foreground">{user.email}</div>
            <Badge variant="secondary" className="mt-1">{user.role}</Badge>
          </div>
        </div>

        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Display Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Username</label>
            <Input value={username} onChange={(e) => setUsername(e.target.value.replace(/\s+/g, "-"))} />
          </div>
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Bio</label>
            <Input value={bio} onChange={(e) => setBio(e.target.value)} />
          </div>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </form>
      </div>

      {/* Change password */}
      <div className="bg-card border border-border rounded-lg p-6 mb-6">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Lock size={16} /> Change Password
        </h2>
        <form onSubmit={handleChangePassword} className="space-y-3">
          <Input
            type="password"
            placeholder="Current password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            required
          />
          <Input
            type="password"
            placeholder="New password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            required
            minLength={6}
          />
          <Input
            type="password"
            placeholder="Confirm new password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            required
          />
          <Button type="submit" size="sm" disabled={changingPw}>
            {changingPw ? "Changing..." : "Change Password"}
          </Button>
        </form>
      </div>

      {/* Connected accounts */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Link2 size={16} /> Connected Accounts
        </h2>

        {["google", "apple"].map((provider, index) => {
          const linked = linkedProviders.has(provider);
          return (
            <div
              key={provider}
              className={`flex items-center justify-between py-3 ${index === 0 ? "border-b border-border" : ""}`}
            >
              <div>
                <div className="text-sm font-medium">{provider.charAt(0).toUpperCase() + provider.slice(1)}</div>
                <div className="text-xs text-muted-foreground">
                  {linked ? "Linked" : "Not linked"}
                </div>
              </div>
              {linked ? (
                <Button size="sm" variant="outline" onClick={() => handleUnlinkProvider(provider)}>
                  <Unlink size={14} className="mr-1" /> Unlink
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => startProviderLink(provider)}>
                  <Link2 size={14} className="mr-1" /> Link
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
