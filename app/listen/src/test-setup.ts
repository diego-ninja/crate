/**
 * Vitest setup: polyfill localStorage. jsdom's implementation is
 * incomplete in some environments — replace with an in-memory map for
 * test isolation.
 */
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number { return this.store.size; }
  clear(): void { this.store.clear(); }
  getItem(key: string): string | null { return this.store.get(key) ?? null; }
  key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null; }
  removeItem(key: string): void { this.store.delete(key); }
  setItem(key: string, value: string): void { this.store.set(key, String(value)); }
}

Object.defineProperty(globalThis, "localStorage", {
  value: new MemoryStorage(),
  writable: true,
  configurable: true,
});

Object.defineProperty(globalThis, "sessionStorage", {
  value: new MemoryStorage(),
  writable: true,
  configurable: true,
});

// jsdom's window is a different context; patch it too in case some code
// reads window.localStorage directly.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "localStorage", {
    value: globalThis.localStorage,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, "sessionStorage", {
    value: globalThis.sessionStorage,
    writable: true,
    configurable: true,
  });
}
