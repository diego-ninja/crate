import { lazy, type ComponentType, type LazyExoticComponent } from "react";

export interface PreloadableLazyComponent<TProps> {
  Component: LazyExoticComponent<ComponentType<TProps>>;
  preload: () => Promise<unknown>;
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
