export { ApiError } from "../../../shared/web/api";

import { createApiClient } from "../../../shared/web/api";

export const api = createApiClient({
  onUnauthorized: () => {
    if (window.location.pathname !== "/login") {
      const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.href = `/login?redirect=${encodeURIComponent(redirect)}`;
    }
  },
});
