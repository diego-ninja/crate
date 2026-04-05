/**
 * Sleep timer module — pauses playback after a countdown.
 * Singleton state, framework-agnostic.
 */

type Listener = (state: SleepTimerState) => void;

export interface SleepTimerState {
  active: boolean;
  remainingSeconds: number;
  mode: SleepTimerMode | null;
}

export type SleepTimerMode = "15min" | "30min" | "45min" | "1hr" | "end_of_track";

const DURATIONS: Record<Exclude<SleepTimerMode, "end_of_track">, number> = {
  "15min": 15 * 60,
  "30min": 30 * 60,
  "45min": 45 * 60,
  "1hr": 60 * 60,
};

let _state: SleepTimerState = { active: false, remainingSeconds: 0, mode: null };
let _interval: ReturnType<typeof setInterval> | null = null;
let _pauseFn: (() => void) | null = null;
const _listeners = new Set<Listener>();

function _notify() {
  for (const fn of _listeners) fn({ ..._state });
}

export function subscribeSleepTimer(fn: Listener): () => void {
  _listeners.add(fn);
  fn({ ..._state });
  return () => { _listeners.delete(fn); };
}

export function getSleepTimerState(): SleepTimerState {
  return { ..._state };
}

export function startSleepTimer(mode: SleepTimerMode, pauseFn: () => void) {
  cancelSleepTimer();
  _pauseFn = pauseFn;

  if (mode === "end_of_track") {
    _state = { active: true, remainingSeconds: 0, mode };
    _notify();
    return;
  }

  const seconds = DURATIONS[mode];
  _state = { active: true, remainingSeconds: seconds, mode };
  _notify();

  _interval = setInterval(() => {
    _state.remainingSeconds = Math.max(0, _state.remainingSeconds - 1);
    if (_state.remainingSeconds <= 0) {
      _pauseFn?.();
      cancelSleepTimer();
    }
    _notify();
  }, 1000);
}

export function cancelSleepTimer() {
  if (_interval) { clearInterval(_interval); _interval = null; }
  _state = { active: false, remainingSeconds: 0, mode: null };
  _pauseFn = null;
  _notify();
}

/** Call from PlayerContext when a track ends — handles "end_of_track" mode. */
export function onTrackEnded() {
  if (_state.active && _state.mode === "end_of_track") {
    _pauseFn?.();
    cancelSleepTimer();
  }
}

export function formatRemaining(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
