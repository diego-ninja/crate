export type ApiMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface ApiClientOptions {
  base?: string;
  credentials?: RequestCredentials;
  defaultHeaders?: Record<string, string>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function createApiClient(options: ApiClientOptions = {}) {
  const {
    base = "",
    credentials,
    defaultHeaders = {},
  } = options;

  return async function api<T = unknown>(
    url: string,
    method: ApiMethod = "GET",
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = { ...defaultHeaders };
    const requestOptions: RequestInit = {
      method,
      headers,
    };

    if (credentials) {
      requestOptions.credentials = credentials;
    }

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      requestOptions.body = JSON.stringify(body);
    }

    const res = await fetch(`${base}${url}`, requestOptions);
    if (!res.ok) {
      const text = await res.text().catch(() => "Request failed");
      throw new ApiError(res.status, text);
    }
    return res.json();
  };
}
