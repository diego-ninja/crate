export { ApiError } from "../../../shared/web/api";

import { createApiClient } from "../../../shared/web/api";
import { captureApiError } from "./sentry";

export const api = createApiClient({
  onError: captureApiError,
  onUnauthorized: () => {
    if (window.location.pathname !== "/login") {
      const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.href = `/login?redirect=${encodeURIComponent(redirect)}`;
    }
  },
});

export function apiSseUrl(path: string): string {
  return path;
}
