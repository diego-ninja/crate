export type ApiMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface ApiClientOptions {
  base?: string;
  credentials?: RequestCredentials;
  defaultHeaders?: Record<string, string>;
}

export interface ApiRequestOptions {
  signal?: AbortSignal;
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
    options: ApiRequestOptions = {},
  ): Promise<T> {
    const headers: Record<string, string> = { ...defaultHeaders };
    const requestOptions: RequestInit = {
      method,
      headers,
      signal: options.signal,
    };

    if (credentials) {
      requestOptions.credentials = credentials;
    }

    if (body !== undefined) {
      if (body instanceof FormData) {
        requestOptions.body = body;
      } else {
        headers["Content-Type"] = "application/json";
        requestOptions.body = JSON.stringify(body);
      }
    }

    const res = await fetch(`${base}${url}`, requestOptions);
    if (!res.ok) {
      const text = await res.text().catch(() => "Request failed");
      throw new ApiError(res.status, text);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : (null as T);
  };
}
