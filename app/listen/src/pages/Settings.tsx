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
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Upload, BarChart3, LogOut, Lock, Moon } from "lucide-react";
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
  const { logout } = useAuth();
  const [crossfadeSeconds, setCrossfadeSeconds] = useState(getCrossfadeDurationPreference);
  const [infinitePlaybackEnabled, setInfinitePlaybackEnabled] = useState(getInfinitePlaybackPreference);
  const [smartPlaylistSuggestionsEnabled, setSmartPlaylistSuggestionsEnabled] = useState(
    getSmartPlaylistSuggestionsPreference,
  );
  const [smartPlaylistSuggestionsCadence, setSmartPlaylistSuggestionsCadence] = useState(
    getSmartPlaylistSuggestionsCadencePreference,
  );

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
  const { user, refetch } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  async function handleSaveName() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api("/api/me/profile", "PUT", { name: name.trim() });
      toast.success("Name updated");
      refetch();
    } catch {
      toast.error("Failed to update name");
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

  return (
    <Section title="Account" description="Manage your profile and credentials.">
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
            <button
              onClick={handleSaveName}
              disabled={saving || name.trim() === (user?.name || "")}
              className="h-10 px-4 rounded-lg bg-primary text-sm font-medium text-white disabled:opacity-40 transition-opacity"
            >
              Save
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Email</label>
          <p className="text-sm text-white/60 px-1">{user?.email || "—"}</p>
        </div>

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
