import { lazy, type ComponentType, type LazyExoticComponent } from "react";

const LAZY_IMPORT_RECOVERY_KEY = "listen:lazy-import-recovery";
const LAZY_IMPORT_RECOVERY_WINDOW_MS = 10_000;

export interface PreloadableLazyComponent<TProps> {
  Component: LazyExoticComponent<ComponentType<TProps>>;
  preload: () => Promise<unknown>;
}

function isLazyImportFetchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("Importing a module script failed") ||
    message.includes("Outdated Optimize Dep") ||
    message.includes("Loading chunk")
  );
}

function scheduleLazyImportRecovery(error: unknown): boolean {
  if (typeof window === "undefined" || !isLazyImportFetchError(error)) {
    return false;
  }

  try {
    const key = `${LAZY_IMPORT_RECOVERY_KEY}:${window.location.pathname}`;
    const lastRecoveryAt = Number(window.sessionStorage.getItem(key) || "0");
    const now = Date.now();
    if (Number.isFinite(lastRecoveryAt) && now - lastRecoveryAt < LAZY_IMPORT_RECOVERY_WINDOW_MS) {
      return false;
    }
    window.sessionStorage.setItem(key, String(now));
  } catch {
    // If sessionStorage is unavailable, a single reload is still the best recovery path.
  }

  window.location.reload();
  return true;
}

export function createPreloadableLazy<TProps, TModule>(
  loader: () => Promise<TModule>,
  resolveComponent: (module: TModule) => ComponentType<TProps>,
): PreloadableLazyComponent<TProps> {
  let promise: Promise<TModule> | null = null;

  const load = () => {
    if (!promise) {
      promise = loader().catch((error) => {
        promise = null;
        if (scheduleLazyImportRecovery(error)) {
          return new Promise<TModule>(() => {});
        }
        throw error;
      });
    }
    return promise;
  };

  return {
    Component: lazy(async () => {
      const module = await load();
      return {
        default: resolveComponent(module),
      };
    }),
    preload: load,
  };
}
