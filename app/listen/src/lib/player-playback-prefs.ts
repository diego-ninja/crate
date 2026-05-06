export const PLAYER_PLAYBACK_PREFS_EVENT = "listen-player-playback-prefs";

const CROSSFADE_DURATION_KEY = "listen-player-crossfade-seconds";
const SMART_CROSSFADE_KEY = "listen-player-smart-crossfade";
const INFINITE_PLAYBACK_KEY = "listen-player-infinite-playback";
const SMART_PLAYLIST_SUGGESTIONS_KEY = "listen-player-smart-playlist-suggestions";
const SMART_PLAYLIST_SUGGESTIONS_CADENCE_KEY = "listen-player-smart-playlist-suggestions-cadence";
const PLAYBACK_DELIVERY_POLICY_KEY = "listen-player-delivery-policy";
const MOBILE_ENHANCED_AUDIO_KEY = "listen-player-mobile-enhanced-audio";

export type PlaybackDeliveryPolicy = "original" | "balanced" | "data_saver";

const PLAYBACK_DELIVERY_POLICIES = new Set<PlaybackDeliveryPolicy>([
  "original",
  "balanced",
  "data_saver",
]);

function isMobileRuntime(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || window.innerWidth < 768;
}

function normalizePlaybackDeliveryPolicy(value: string | null | undefined): PlaybackDeliveryPolicy | null {
  const normalized = (value || "").trim().toLowerCase().replace(/-/g, "_");
  return PLAYBACK_DELIVERY_POLICIES.has(normalized as PlaybackDeliveryPolicy)
    ? normalized as PlaybackDeliveryPolicy
    : null;
}

export function getDefaultPlaybackDeliveryPolicy(): PlaybackDeliveryPolicy {
  return isMobileRuntime() ? "balanced" : "original";
}

export function getPlaybackDeliveryPolicyPreference(): PlaybackDeliveryPolicy {
  try {
    return normalizePlaybackDeliveryPolicy(localStorage.getItem(PLAYBACK_DELIVERY_POLICY_KEY))
      ?? getDefaultPlaybackDeliveryPolicy();
  } catch {
    return getDefaultPlaybackDeliveryPolicy();
  }
}

export function setPlaybackDeliveryPolicyPreference(policy: PlaybackDeliveryPolicy) {
  const value = normalizePlaybackDeliveryPolicy(policy) ?? getDefaultPlaybackDeliveryPolicy();
  try {
    localStorage.setItem(PLAYBACK_DELIVERY_POLICY_KEY, value);
    window.dispatchEvent(
      new CustomEvent(PLAYER_PLAYBACK_PREFS_EVENT, {
        detail: { playbackDeliveryPolicy: value },
      }),
    );
  } catch {
    // ignore localStorage failures in private mode or restricted environments
  }
}

export function getMobileEnhancedAudioPreference(): boolean {
  try {
    return localStorage.getItem(MOBILE_ENHANCED_AUDIO_KEY) === "true";
  } catch {
    return false;
  }
}

export function setMobileEnhancedAudioPreference(enabled: boolean) {
  try {
    localStorage.setItem(MOBILE_ENHANCED_AUDIO_KEY, enabled ? "true" : "false");
    window.dispatchEvent(
      new CustomEvent(PLAYER_PLAYBACK_PREFS_EVENT, {
        detail: { mobileEnhancedAudioEnabled: enabled },
      }),
    );
  } catch {
    // ignore localStorage failures in private mode or restricted environments
  }
}

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

export function getSmartCrossfadePreference(): boolean {
  try {
    const raw = localStorage.getItem(SMART_CROSSFADE_KEY);
    if (raw == null) return true;
    return raw !== "false";
  } catch {
    return true;
  }
}

export function setSmartCrossfadePreference(enabled: boolean) {
  try {
    localStorage.setItem(SMART_CROSSFADE_KEY, enabled ? "true" : "false");
    window.dispatchEvent(
      new CustomEvent(PLAYER_PLAYBACK_PREFS_EVENT, {
        detail: { smartCrossfadeEnabled: enabled },
      }),
    );
  } catch {
    // ignore localStorage failures in private mode or restricted environments
  }
}

export function getInfinitePlaybackPreference(): boolean {
  try {
    const raw = localStorage.getItem(INFINITE_PLAYBACK_KEY);
    if (raw == null) return true;
    return raw !== "false";
  } catch {
    return true;
  }
}

export function setInfinitePlaybackPreference(enabled: boolean) {
  try {
    localStorage.setItem(INFINITE_PLAYBACK_KEY, enabled ? "true" : "false");
    window.dispatchEvent(
      new CustomEvent(PLAYER_PLAYBACK_PREFS_EVENT, {
        detail: { infinitePlaybackEnabled: enabled },
      }),
    );
  } catch {
    // ignore localStorage failures in private mode or restricted environments
  }
}

export function getSmartPlaylistSuggestionsPreference(): boolean {
  try {
    const raw = localStorage.getItem(SMART_PLAYLIST_SUGGESTIONS_KEY);
    if (raw == null) return false;
    return raw === "true";
  } catch {
    return false;
  }
}

export function setSmartPlaylistSuggestionsPreference(enabled: boolean) {
  try {
    localStorage.setItem(SMART_PLAYLIST_SUGGESTIONS_KEY, enabled ? "true" : "false");
    window.dispatchEvent(
      new CustomEvent(PLAYER_PLAYBACK_PREFS_EVENT, {
        detail: { smartPlaylistSuggestionsEnabled: enabled },
      }),
    );
  } catch {
    // ignore localStorage failures in private mode or restricted environments
  }
}

export function getSmartPlaylistSuggestionsCadencePreference(): number {
  try {
    const raw = localStorage.getItem(SMART_PLAYLIST_SUGGESTIONS_CADENCE_KEY);
    if (!raw) return 5;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 2) return 5;
    return Math.min(parsed, 10);
  } catch {
    return 5;
  }
}

export function setSmartPlaylistSuggestionsCadencePreference(count: number) {
  const value = Math.max(2, Math.min(count, 10));
  try {
    localStorage.setItem(SMART_PLAYLIST_SUGGESTIONS_CADENCE_KEY, String(value));
    window.dispatchEvent(
      new CustomEvent(PLAYER_PLAYBACK_PREFS_EVENT, {
        detail: { smartPlaylistSuggestionsCadence: value },
      }),
    );
  } catch {
    // ignore localStorage failures in private mode or restricted environments
  }
}
