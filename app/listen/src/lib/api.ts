export { ApiError } from "../../../shared/web/api";

import { createApiClient } from "../../../shared/web/api";

/** Base URL for the backend API. Empty string in web (uses relative paths via
 *  Vite proxy or same-origin), full URL in Capacitor builds. */
export const API_BASE = import.meta.env.VITE_API_URL || "";

/** Resolve an API path to a full URL. Use for raw fetch() calls and stream URLs. */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export const api = createApiClient({
  base: API_BASE,
  credentials: "include",
  onUnauthorized: () => {
    if (window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
  },
});
