import {
  getCrossfadeDurationPreference,
  getInfinitePlaybackPreference,
  getSmartPlaylistSuggestionsCadencePreference,
  getSmartPlaylistSuggestionsPreference,
  setInfinitePlaybackPreference,
  setCrossfadeDurationPreference,
  setSmartPlaylistSuggestionsCadencePreference,
  setSmartPlaylistSuggestionsPreference,
} from "@/lib/player-playback-prefs";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Upload, BarChart3, LogOut, Lock, Moon, Radio, Shield, Smartphone, Users } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";
import {
  subscribeSleepTimer,
  startSleepTimer,
  cancelSleepTimer,
  formatRemaining,
  type SleepTimerMode,
  type SleepTimerState,
} from "@/lib/sleep-timer";

interface AuthProviderState {
  enabled: boolean;
  configured: boolean;
  login_url: string | null;
}

interface AuthPublicConfig {
  invite_only?: boolean;
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

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function RangeRow({
  label,
  description,
  value,
  min,
  max,
  step,
  displayValue,
  disabled = false,
  onChange,
}: {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className={`space-y-2 ${disabled ? "opacity-50" : ""}`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-foreground">{label}</div>
          {description ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p> : null}
        </div>
        <div className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-white/70">
          {displayValue ?? value}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-cyan-400 disabled:cursor-not-allowed"
      />
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p> : null}
      </div>
      <button
        type="button"
        aria-pressed={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full border transition-colors ${
          checked
            ? "border-cyan-400/50 bg-cyan-400/25"
            : "border-white/10 bg-white/[0.03]"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

export function Settings() {
  const { user, logout } = useAuth();
  const [crossfadeSeconds, setCrossfadeSeconds] = useState(getCrossfadeDurationPreference);
  const [infinitePlaybackEnabled, setInfinitePlaybackEnabled] = useState(getInfinitePlaybackPreference);
  const [smartPlaylistSuggestionsEnabled, setSmartPlaylistSuggestionsEnabled] = useState(
    getSmartPlaylistSuggestionsPreference,
  );
  const [smartPlaylistSuggestionsCadence, setSmartPlaylistSuggestionsCadence] = useState(
    getSmartPlaylistSuggestionsCadencePreference,
  );
  const publicProfilePath = useMemo(() => {
    return user?.username ? `/users/${user.username}` : "/people";
  }, [user?.username]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Fine-tune playback behavior for this device.
        </p>
      </div>

      <Section
        title="Playback"
        description="These preferences shape how the player behaves between tracks."
      >
        <ToggleRow
          label="Infinite playback"
          description="When an album or playlist ends, keep the session going with context-aware continuation."
          checked={infinitePlaybackEnabled}
          onChange={(value) => {
            setInfinitePlaybackEnabled(value);
            setInfinitePlaybackPreference(value);
          }}
        />
        <RangeRow
          label="Crossfade"
          description="Set a preferred crossfade length for compatible transitions. Continuous album playback should still favor the most seamless handoff available."
          value={crossfadeSeconds}
          min={0}
          max={12}
          step={1}
          displayValue={crossfadeSeconds === 0 ? "Off" : `${crossfadeSeconds}s`}
          onChange={(value) => {
            setCrossfadeSeconds(value);
            setCrossfadeDurationPreference(value);
          }}
        />
        <ToggleRow
          label="Smart playlist suggestions"
          description="While listening to a playlist, occasionally slip in one contextual recommendation without changing the playlist itself."
          checked={smartPlaylistSuggestionsEnabled}
          onChange={(value) => {
            setSmartPlaylistSuggestionsEnabled(value);
            setSmartPlaylistSuggestionsPreference(value);
          }}
        />
        <RangeRow
          label="Suggestion cadence"
          description="How many original playlist tracks should play before a suggested track can be inserted."
          value={smartPlaylistSuggestionsCadence}
          min={2}
          max={10}
          step={1}
          displayValue={`Every ${smartPlaylistSuggestionsCadence} tracks`}
          disabled={!smartPlaylistSuggestionsEnabled}
          onChange={(value) => {
            setSmartPlaylistSuggestionsCadence(value);
            setSmartPlaylistSuggestionsCadencePreference(value);
          }}
        />
      </Section>

      <SleepTimerSection />

      <AccountSection />

      <Section title="Quick links">
        <div className="flex flex-col gap-2">
          <Link to={publicProfilePath} className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-foreground hover:bg-white/5 transition-colors">
            <Users size={18} className="text-muted-foreground" /> Public profile
          </Link>
          <Link to="/people" className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-foreground hover:bg-white/5 transition-colors">
            <Users size={18} className="text-muted-foreground" /> Find people
          </Link>
          <Link to="/jam" className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-foreground hover:bg-white/5 transition-colors">
            <Radio size={18} className="text-muted-foreground" /> Jam sessions
          </Link>
          <Link to="/upload" className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-foreground hover:bg-white/5 transition-colors">
            <Upload size={18} className="text-muted-foreground" /> Upload music
          </Link>
          <Link to="/stats" className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-foreground hover:bg-white/5 transition-colors">
            <BarChart3 size={18} className="text-muted-foreground" /> Listening stats
          </Link>
          <button onClick={logout} className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-red-400 hover:bg-white/5 transition-colors w-full text-left">
            <LogOut size={18} /> Sign out
          </button>
        </div>
      </Section>
    </div>
  );
}

const SLEEP_MODES: { mode: SleepTimerMode; label: string }[] = [
  { mode: "15min", label: "15 min" },
  { mode: "30min", label: "30 min" },
  { mode: "45min", label: "45 min" },
  { mode: "1hr", label: "1 hour" },
  { mode: "end_of_track", label: "End of track" },
];

function SleepTimerSection() {
  const { pause } = usePlayerActions();
  const [timer, setTimer] = useState<SleepTimerState>({ active: false, remainingSeconds: 0, mode: null });
  useEffect(() => subscribeSleepTimer(setTimer), []);

  return (
    <Section title="Sleep Timer" description="Automatically pause playback after a set duration.">
      <div className="flex flex-wrap gap-2">
        {SLEEP_MODES.map(({ mode, label }) => (
          <button
            key={mode}
            onClick={() => startSleepTimer(mode, pause)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              timer.mode === mode
                ? "bg-primary text-white"
                : "bg-white/5 text-white/60 hover:bg-white/10"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {timer.active && timer.remainingSeconds > 0 ? (
        <div className="flex items-center justify-between rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3">
          <div className="flex items-center gap-2">
            <Moon size={16} className="text-primary" />
            <span className="text-sm text-foreground">
              Pausing in <span className="font-mono font-semibold text-primary">{formatRemaining(timer.remainingSeconds)}</span>
            </span>
          </div>
          <button
            onClick={cancelSleepTimer}
            className="rounded-full px-3 py-1.5 text-xs font-medium bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : null}
    </Section>
  );
}

function AccountSection() {
  const { user, refetch, logout } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [username, setUsername] = useState(user?.username || "");
  const [bio, setBio] = useState(user?.bio || "");
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [providers, setProviders] = useState<Record<string, AuthProviderState>>({});
  const [authConfig, setAuthConfig] = useState<AuthPublicConfig>({});
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);
  const [linkingProvider, setLinkingProvider] = useState<string | null>(null);
  const [unlinkingProvider, setUnlinkingProvider] = useState<string | null>(null);

  useEffect(() => {
    setName(user?.name || "");
    setUsername(user?.username || "");
    setBio(user?.bio || "");
  }, [user?.bio, user?.name, user?.username]);

  useEffect(() => {
    api<Record<string, AuthProviderState>>("/api/auth/providers")
      .then(setProviders)
      .catch(() => {});
    api<AuthPublicConfig>("/api/auth/config")
      .then(setAuthConfig)
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoadingSessions(true);
    api<UserSession[]>("/api/auth/sessions")
      .then(setSessions)
      .catch(() => {})
      .finally(() => setLoadingSessions(false));
  }, []);

  async function handleSaveName() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api("/api/auth/profile", "PUT", {
        name: name.trim(),
        username: username.trim() || null,
        bio: bio.trim() || null,
      });
      toast.success("Profile updated");
      await refetch();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("Username is already taken")) {
        toast.error("That username is already taken");
      } else {
        toast.error("Failed to update profile");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword() {
    if (!newPassword || newPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords don't match");
      return;
    }
    setSaving(true);
    try {
      await api("/api/me/password", "PUT", { current_password: currentPassword, new_password: newPassword });
      toast.success("Password changed");
      setShowPassword(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      toast.error("Failed to change password — check your current password");
    } finally {
      setSaving(false);
    }
  }

  async function handleLinkProvider(provider: string) {
    setLinkingProvider(provider);
    try {
      const response = await api<{ login_url: string }>(`/api/auth/oauth/${provider}/link`, "POST", {
        return_to: `${window.location.origin}/settings`,
      });
      window.location.href = response.login_url;
    } catch {
      toast.error(`Failed to start ${provider} link flow`);
      setLinkingProvider(null);
    }
  }

  async function handleUnlinkProvider(provider: string) {
    setUnlinkingProvider(provider);
    try {
      await api(`/api/auth/oauth/${provider}/unlink`, "POST");
      toast.success(`${provider} account unlinked`);
      await refetch();
    } catch {
      toast.error(`Failed to unlink ${provider}`);
    } finally {
      setUnlinkingProvider(null);
    }
  }

  async function handleRevokeSession(sessionId: string) {
    setRevokingSessionId(sessionId);
    try {
      await api(`/api/auth/sessions/${sessionId}`, "DELETE");
      if (user?.session_id === sessionId) {
        toast.success("This session was revoked");
        await logout();
        return;
      }
      setSessions((prev) => prev.filter((session) => session.id !== sessionId));
      toast.success("Session revoked");
    } catch {
      toast.error("Failed to revoke session");
    } finally {
      setRevokingSessionId(null);
    }
  }

  async function handleRevokeOthers() {
    setRevokingOthers(true);
    try {
      const result = await api<{ revoked: number }>("/api/auth/sessions/revoke-all", "POST");
      setSessions((prev) => prev.filter((session) => session.id === user?.session_id));
      toast.success(`Revoked ${result.revoked} other session${result.revoked === 1 ? "" : "s"}`);
    } catch {
      toast.error("Failed to revoke other sessions");
    } finally {
      setRevokingOthers(false);
    }
  }

  const connectedAccounts = user?.connected_accounts || [];
  const linkedProviders = new Set(
    connectedAccounts
      .filter((item) => item.status !== "unlinked")
      .map((item) => item.provider),
  );
  const socialProviders = Object.entries(providers).filter(
    ([provider, state]) => provider !== "password" && state.configured && state.enabled,
  );

  return (
    <Section title="Account" description="Manage your profile, social identity, and credentials.">
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Display name</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 h-10 px-3 rounded-lg bg-white/5 text-sm text-white outline-none focus:bg-white/8"
              placeholder="Your name"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Username</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value.replace(/\s+/g, "-"))}
            className="w-full h-10 px-3 rounded-lg bg-white/5 text-sm text-white outline-none focus:bg-white/8"
            placeholder="your-handle"
          />
          <p className="text-xs text-muted-foreground">
            This powers your public profile URL and social discovery.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Bio</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            className="min-h-24 w-full rounded-lg bg-white/5 px-3 py-3 text-sm text-white outline-none focus:bg-white/8"
            placeholder="A short note about what you listen to"
          />
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleSaveName}
            disabled={
              saving || (
                name.trim() === (user?.name || "")
                && username.trim() === (user?.username || "")
                && bio.trim() === (user?.bio || "")
              )
            }
            className="h-10 px-4 rounded-lg bg-primary text-sm font-medium text-white disabled:opacity-40 transition-opacity"
          >
            {saving ? "Saving..." : "Save profile"}
          </button>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Email</label>
          <p className="text-sm text-white/60 px-1">{user?.email || "—"}</p>
        </div>

        {socialProviders.length > 0 ? (
          <div className="space-y-3 rounded-xl bg-white/5 p-4">
            <div>
              <div className="text-sm font-medium text-foreground">Connected accounts</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Link Google or Apple so this profile can use social sign-in directly from Listen.
              </p>
            </div>
            {socialProviders.map(([provider]) => {
              const linked = linkedProviders.has(provider);
              const busy = linkingProvider === provider || unlinkingProvider === provider;
              return (
                <div key={provider} className="flex items-center justify-between gap-4 rounded-lg border border-white/10 px-3 py-3">
                  <div>
                    <div className="text-sm font-medium text-foreground capitalize">{provider}</div>
                    <div className="text-xs text-muted-foreground">
                      {linked ? "Linked to this account" : "Not linked yet"}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => linked ? void handleUnlinkProvider(provider) : void handleLinkProvider(provider)}
                    className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-foreground hover:bg-white/10 transition-colors disabled:opacity-50"
                  >
                    {busy ? "Working..." : linked ? "Unlink" : "Link"}
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="space-y-3 rounded-xl bg-white/5 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-foreground">Active sessions</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Review where this account is signed in and revoke devices you no longer trust.
              </p>
            </div>
            <button
              type="button"
              disabled={revokingOthers || sessions.filter((session) => session.id !== user?.session_id).length === 0}
              onClick={() => void handleRevokeOthers()}
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-foreground hover:bg-white/10 transition-colors disabled:opacity-50"
            >
              {revokingOthers ? "Revoking…" : "Revoke others"}
            </button>
          </div>

          {loadingSessions ? (
            <div className="text-sm text-muted-foreground">Loading sessions…</div>
          ) : (
            <div className="space-y-2">
              {sessions.map((session) => {
                const isCurrent = session.id === user?.session_id;
                const lastSeen = session.last_seen_at || session.created_at;
                const label = session.device_label || session.app_id || "Unknown device";
                return (
                  <div key={session.id} className="flex items-start justify-between gap-4 rounded-lg border border-white/10 px-3 py-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                          <Smartphone size={14} className="text-muted-foreground" />
                          {label}
                        </div>
                        {isCurrent ? (
                          <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[11px] font-medium text-cyan-300">
                            Current
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Last seen {lastSeen ? new Date(lastSeen).toLocaleString() : "recently"}
                      </div>
                      {session.user_agent ? (
                        <div className="mt-1 truncate text-xs text-white/45">{session.user_agent}</div>
                      ) : null}
                      {session.last_seen_ip ? (
                        <div className="mt-1 text-[11px] text-white/35">IP {session.last_seen_ip}</div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      disabled={revokingSessionId === session.id}
                      onClick={() => void handleRevokeSession(session.id)}
                      className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-300 hover:bg-red-500/15 transition-colors disabled:opacity-50"
                    >
                      {revokingSessionId === session.id ? "Revoking…" : isCurrent ? "Sign out" : "Revoke"}
                    </button>
                  </div>
                );
              })}
              {sessions.length === 0 ? (
                <div className="text-sm text-muted-foreground">No active sessions found.</div>
              ) : null}
            </div>
          )}
        </div>

        {authConfig.invite_only ? (
          <div className="flex items-start gap-3 rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100">
            <Shield size={16} className="mt-0.5 flex-shrink-0" />
            <div>
              This instance is currently invite-only for new accounts. Existing accounts can still sign in normally.
            </div>
          </div>
        ) : null}

        {!showPassword ? (
          <button
            onClick={() => setShowPassword(true)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Lock size={14} /> Change password
          </button>
        ) : (
          <div className="space-y-2 rounded-xl bg-white/5 p-4">
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Current password"
              className="w-full h-10 px-3 rounded-lg bg-white/5 text-sm text-white outline-none focus:bg-white/8"
              autoComplete="current-password"
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password"
              className="w-full h-10 px-3 rounded-lg bg-white/5 text-sm text-white outline-none focus:bg-white/8"
              autoComplete="new-password"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              className="w-full h-10 px-3 rounded-lg bg-white/5 text-sm text-white outline-none focus:bg-white/8"
              autoComplete="new-password"
            />
            <div className="flex gap-2 pt-1">
              <button onClick={handleChangePassword} disabled={saving} className="h-9 px-4 rounded-lg bg-primary text-sm font-medium text-white disabled:opacity-40">
                Change
              </button>
              <button onClick={() => { setShowPassword(false); setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); }} className="h-9 px-4 rounded-lg bg-white/5 text-sm text-white/60">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
