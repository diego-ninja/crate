export const PLAYER_PLAYBACK_PREFS_EVENT = "listen-player-playback-prefs";

const CROSSFADE_DURATION_KEY = "listen-player-crossfade-seconds";

export function getCrossfadeDurationPreference(): number {
  try {
    const raw = localStorage.getItem(CROSSFADE_DURATION_KEY);
    if (!raw) return 0;
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.min(parsed, 12);
  } catch {
    return 0;
  }
}

export function setCrossfadeDurationPreference(seconds: number) {
  const value = Math.max(0, Math.min(seconds, 12));
  try {
    localStorage.setItem(CROSSFADE_DURATION_KEY, String(value));
    window.dispatchEvent(new CustomEvent(PLAYER_PLAYBACK_PREFS_EVENT, { detail: { crossfadeSeconds: value } }));
  } catch {
    // ignore localStorage failures in private mode or restricted environments
  }
}
