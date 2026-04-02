export { ApiError } from "../../../shared/web/api";

import { createApiClient } from "../../../shared/web/api";

export const api = createApiClient({
  onUnauthorized: () => {
    if (window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
  },
});
