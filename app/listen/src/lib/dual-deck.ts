/**
 * Dual-deck audio manager — two permanent HTMLAudioElements that
 * alternate roles between "active" (playing) and "standby" (preloading).
 *
 * On crossfade:
 *  1. Standby starts playing (gain 0→1)
 *  2. Active fades out (gain 1→0)
 *  3. Roles swap: standby becomes active, active becomes standby
 *
 * No src copying, no seeking, no rebuffering. Each element keeps
 * its own stream intact throughout its lifecycle.
 */

import { ensureGainNode } from "./audio-engine";

const DECK_A_KEY = "__listenPlayerAudio" as const;
const DECK_B_KEY = "__listenPlayerPreloadAudio" as const;

interface DeckState {
  deckA: HTMLAudioElement;
  deckB: HTMLAudioElement;
  activeKey: typeof DECK_A_KEY | typeof DECK_B_KEY;
}

let state: DeckState | null = null;

export function initDecks(deckA: HTMLAudioElement, deckB: HTMLAudioElement): void {
  state = { deckA, deckB, activeKey: DECK_A_KEY };
}

/** The currently playing deck */
export function getActiveDeck(): HTMLAudioElement | null {
  if (!state) return null;
  return state.activeKey === DECK_A_KEY ? state.deckA : state.deckB;
}

/** The standby deck (preloading / waiting) */
export function getStandbyDeck(): HTMLAudioElement | null {
  if (!state) return null;
  return state.activeKey === DECK_A_KEY ? state.deckB : state.deckA;
}

/** Swap roles: standby becomes active, active becomes standby */
export function swapDecks(): void {
  if (!state) return;
  state.activeKey = state.activeKey === DECK_A_KEY ? DECK_B_KEY : DECK_A_KEY;
}

/**
 * Execute a crossfade from active → standby.
 *
 * 1. Starts the standby deck at gain=0
 * 2. Ramps active 1→0 and standby 0→1 over durationMs
 * 3. After completion, pauses old active, resets its gain, swaps roles
 *
 * Returns a promise that resolves when crossfade completes.
 */
export function crossfade(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    const active = getActiveDeck();
    const standby = getStandbyDeck();
    if (!active || !standby || !standby.src) {
      resolve();
      return;
    }

    const activeGain = ensureGainNode(active);
    const standbyGain = ensureGainNode(standby);

    // Start standby at gain 0
    if (standbyGain) standbyGain.gain.value = 0;

    standby.play().catch(() => {});

    // Ramp gains
    if (activeGain) {
      const ctx = activeGain.context;
      const now = ctx.currentTime;
      activeGain.gain.cancelScheduledValues(now);
      activeGain.gain.setValueAtTime(1.0, now);
      activeGain.gain.linearRampToValueAtTime(0, now + durationMs / 1000);
    }
    if (standbyGain) {
      const ctx = standbyGain.context;
      const now = ctx.currentTime;
      standbyGain.gain.cancelScheduledValues(now);
      standbyGain.gain.setValueAtTime(0, now);
      standbyGain.gain.linearRampToValueAtTime(1.0, now + durationMs / 1000);
    }

    setTimeout(() => {
      // Crossfade done — clean up old active
      active.pause();
      active.src = "";
      if (activeGain) activeGain.gain.value = 1.0;

      // Swap roles
      swapDecks();
      resolve();
    }, durationMs + 50);
  });
}

/** Whether a crossfade is currently in progress */
let _crossfading = false;

export async function executeCrossfade(durationMs: number): Promise<void> {
  _crossfading = true;
  try {
    await crossfade(durationMs);
  } finally {
    _crossfading = false;
  }
}

export function isCrossfadeActive(): boolean {
  return _crossfading;
}

/** Load a URL into the standby deck for preloading */
export function preloadOnStandby(url: string): void {
  const standby = getStandbyDeck();
  if (!standby) return;
  standby.src = url;
  standby.preload = "auto";
}

/** Clear the standby deck */
export function clearStandby(): void {
  const standby = getStandbyDeck();
  if (!standby) return;
  standby.pause();
  standby.src = "";
}

/** Is the standby deck ready to play? */
export function isStandbyReady(): boolean {
  const standby = getStandbyDeck();
  return !!standby && standby.readyState >= 3 && !!standby.src;
}
