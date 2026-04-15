/**
 * Audio Engine — centralized volume fading, network resilience, and
 * Web Audio API graph management.
 *
 * Graph: HTMLAudioElement → MediaElementSourceNode → GainNode → destination
 *                                                 ↘ AnalyserNode (tee for visualizer)
 *
 * The GainNode is used for:
 *  - Smooth pause/resume fade (200ms)
 *  - Network-stall fade to pause
 *  - Future: crossfade between tracks
 *
 * The AnalyserNode tee is read by use-audio-visualizer.ts for spectrum data.
 */

const CTX_KEY = "__crateAudioCtx" as const;
const SRC_KEY = "__crateAudioSource" as const;
const GAIN_KEY = "__crateGainNode" as const;

const FADE_DURATION_MS = 200;
const NETWORK_FADE_DURATION_MS = 1500;
const RETRY_DELAYS = [1000, 2000, 4000, 8000, 15000];

type AudioExt = HTMLAudioElement & {
  [SRC_KEY]?: MediaElementAudioSourceNode;
  [GAIN_KEY]?: GainNode;
};

// ── Web Audio graph ──────────────────────────────────────────────

function getCtx(): AudioContext | null {
  return (window as unknown as Record<string, AudioContext>)[CTX_KEY] || null;
}

function ensureCtx(): AudioContext {
  let ctx = getCtx();
  if (!ctx) {
    ctx = new AudioContext();
    (window as unknown as Record<string, AudioContext>)[CTX_KEY] = ctx;
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

/**
 * Ensure the audio element is routed through a GainNode.
 * Safe to call multiple times — idempotent.
 *
 * Returns the GainNode (or null if Web Audio not available).
 */
export function ensureGainNode(audio: HTMLAudioElement): GainNode | null {
  const el = audio as AudioExt;
  if (el[GAIN_KEY]) return el[GAIN_KEY]!;

  try {
    const ctx = ensureCtx();

    // Get or create the source node
    let source = el[SRC_KEY];
    if (!source) {
      source = ctx.createMediaElementSource(audio);
      el[SRC_KEY] = source;
    }

    // Create gain node and insert into the chain
    const gain = ctx.createGain();
    gain.gain.value = 1.0;
    el[GAIN_KEY] = gain;

    // Disconnect source from any previous connections
    try { source.disconnect(); } catch { /* ok if not connected */ }

    // Connect: source → gain → destination
    source.connect(gain);
    gain.connect(ctx.destination);

    return gain;
  } catch (e) {
    console.warn("[audio-engine] Failed to create gain node:", e);
    return null;
  }
}

/**
 * Get the GainNode for an audio element (if ensureGainNode was called).
 */
export function getGainNode(audio: HTMLAudioElement): GainNode | null {
  return (audio as AudioExt)[GAIN_KEY] || null;
}

/**
 * Get the MediaElementSourceNode for an audio element.
 * Used by the visualizer to tap into the audio graph.
 */
export function getSourceNode(audio: HTMLAudioElement): MediaElementAudioSourceNode | null {
  return (audio as AudioExt)[SRC_KEY] || null;
}

// ── Fade helpers ─────────────────────────────────────────────────

let fadeTimer: ReturnType<typeof setTimeout> | null = null;

function cancelFade() {
  if (fadeTimer) {
    clearTimeout(fadeTimer);
    fadeTimer = null;
  }
}

/**
 * Ramp gain from current value to target over durationMs.
 * Uses Web Audio linearRampToValueAtTime for smooth interpolation.
 */
function rampGain(gain: GainNode, target: number, durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    cancelFade();
    const ctx = gain.context;
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(target, now + durationMs / 1000);
    fadeTimer = setTimeout(resolve, durationMs + 20);
  });
}

/**
 * Pause with smooth fade-out.
 * Returns a promise that resolves when the audio is paused.
 */
export async function fadeOutAndPause(audio: HTMLAudioElement, durationMs = FADE_DURATION_MS): Promise<void> {
  const gain = getGainNode(audio);
  if (gain && gain.gain.value > 0.01) {
    await rampGain(gain, 0, durationMs);
  }
  audio.pause();
  // Reset gain for next play
  if (gain) gain.gain.value = 0;
}

/**
 * Resume with smooth fade-in.
 */
export async function fadeInAndPlay(audio: HTMLAudioElement, targetVolume = 1.0, durationMs = FADE_DURATION_MS): Promise<void> {
  const gain = getGainNode(audio);
  if (gain) {
    gain.gain.value = 0;
  }
  try {
    await audio.play();
  } catch (e) {
    console.warn("[audio-engine] play failed:", e);
    return;
  }
  if (gain) {
    await rampGain(gain, targetVolume, durationMs);
  }
}

// ── Network resilience ───────────────────────────────────────────

interface RetryState {
  active: boolean;
  attempt: number;
  lastPosition: number;
  url: string;
  timer: ReturnType<typeof setTimeout> | null;
}

const retryStates = new WeakMap<HTMLAudioElement, RetryState>();

function getRetryState(audio: HTMLAudioElement): RetryState {
  let state = retryStates.get(audio);
  if (!state) {
    state = { active: false, attempt: 0, lastPosition: 0, url: "", timer: null };
    retryStates.set(audio, state);
  }
  return state;
}

/**
 * Handle a stalled/error event on the audio element.
 * Fades out gracefully, then retries with backoff.
 *
 * Call this from the PlayerContext stalled/error handlers.
 */
export function handleStreamStall(
  audio: HTMLAudioElement,
  callbacks: {
    onRetrying?: (attempt: number) => void;
    onRecovered?: () => void;
    onGaveUp?: () => void;
    onFadingOut?: () => void;
  } = {},
): void {
  const state = getRetryState(audio);

  // Already retrying
  if (state.active) return;

  // Don't retry if no source
  if (!audio.src || audio.src === "" || audio.src === window.location.href) return;

  state.active = true;
  state.lastPosition = audio.currentTime;
  state.url = audio.src;
  state.attempt = 0;

  // Fade out gracefully instead of hard cut
  callbacks.onFadingOut?.();
  const gain = getGainNode(audio);
  if (gain && gain.gain.value > 0.01) {
    rampGain(gain, 0, NETWORK_FADE_DURATION_MS).then(() => {
      attemptRetry(audio, state, callbacks);
    });
  } else {
    attemptRetry(audio, state, callbacks);
  }
}

function attemptRetry(
  audio: HTMLAudioElement,
  state: RetryState,
  callbacks: {
    onRetrying?: (attempt: number) => void;
    onRecovered?: () => void;
    onGaveUp?: () => void;
  },
): void {
  if (state.attempt >= RETRY_DELAYS.length) {
    // Give up
    state.active = false;
    audio.pause();
    callbacks.onGaveUp?.();
    return;
  }

  const delay = RETRY_DELAYS[state.attempt]!;
  state.attempt++;
  callbacks.onRetrying?.(state.attempt);

  state.timer = setTimeout(() => {
    // Try to resume from last position
    try {
      audio.currentTime = state.lastPosition;
      audio.play()
        .then(() => {
          // Recovered!
          state.active = false;
          state.attempt = 0;
          // Fade back in
          const gain = getGainNode(audio);
          if (gain) {
            gain.gain.value = 0;
            rampGain(gain, 1.0, FADE_DURATION_MS);
          }
          callbacks.onRecovered?.();
        })
        .catch(() => {
          // Still failing — try again
          attemptRetry(audio, state, callbacks);
        });
    } catch {
      attemptRetry(audio, state, callbacks);
    }
  }, delay);
}

/**
 * Cancel any active retry for this audio element.
 */
export function cancelRetry(audio: HTMLAudioElement): void {
  const state = retryStates.get(audio);
  if (state) {
    if (state.timer) clearTimeout(state.timer);
    state.active = false;
    state.attempt = 0;
  }
}

/**
 * Called when network comes back online.
 * If we have a stalled audio, try to resume immediately.
 */
export function onNetworkRestored(audio: HTMLAudioElement): void {
  const state = retryStates.get(audio);
  if (state?.active) {
    // Cancel the scheduled retry and try immediately
    if (state.timer) clearTimeout(state.timer);
    state.attempt = 0;
    audio.currentTime = state.lastPosition;
    audio.play()
      .then(() => {
        state.active = false;
        const gain = getGainNode(audio);
        if (gain) {
          gain.gain.value = 0;
          rampGain(gain, 1.0, FADE_DURATION_MS);
        }
      })
      .catch(() => {});
  }
}
