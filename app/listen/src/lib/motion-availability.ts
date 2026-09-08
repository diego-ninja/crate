import type { MotionPreference } from "@crate/ui/lib/appearance-types";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const motionListeners = new Set<() => void>();
let motionPreference: MotionPreference = "system";

export function getMotionPreference(): MotionPreference {
  return motionPreference;
}

export function setMotionPreference(preference: MotionPreference): void {
  if (motionPreference === preference) return;
  motionPreference = preference;
  motionListeners.forEach((listener) => listener());
}

export function isMotionBlocked(
  preference: MotionPreference = motionPreference,
): boolean {
  if (
    typeof document !== "undefined" &&
    document.visibilityState === "hidden"
  ) {
    return true;
  }

  return (
    preference === "reduced" ||
    (typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia(REDUCED_MOTION_QUERY).matches)
  );
}

export function subscribeToMotionAvailability(
  onChange: () => void,
): () => void {
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onChange);
  }
  motionListeners.add(onChange);

  const mediaQuery =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(REDUCED_MOTION_QUERY)
      : null;
  mediaQuery?.addEventListener("change", onChange);

  return () => {
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onChange);
    }
    motionListeners.delete(onChange);
    mediaQuery?.removeEventListener("change", onChange);
  };
}
