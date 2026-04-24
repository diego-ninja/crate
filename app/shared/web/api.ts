export type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ApiClientOptions {
  base?: string;
  credentials?: RequestCredentials;
  defaultHeaders?: Record<string, string> | (() => Record<string, string>);
  onUnauthorized?: () => void;
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
    onUnauthorized,
  } = options;
  const inflightGets = new Map<string, Promise<unknown>>();

  return async function api<T = unknown>(
    url: string,
    method: ApiMethod = "GET",
    body?: unknown,
    options: ApiRequestOptions = {},
  ): Promise<T> {
    const resolved = typeof defaultHeaders === "function" ? defaultHeaders() : defaultHeaders;
    const headers: Record<string, string> = { ...resolved };
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

    const execute = async () => {
      const res = await fetch(`${base}${url}`, requestOptions);
      if (!res.ok) {
        if (res.status === 401 && onUnauthorized && !url.includes("/auth/login")) {
          onUnauthorized();
        }
        const text = await res.text().catch(() => "Request failed");
        throw new ApiError(res.status, text);
      }
      const text = await res.text();
      return text ? JSON.parse(text) : (null as T);
    };

    const isAbortableGet = method === "GET" && body === undefined && options.signal != null;

    if (method === "GET" && body === undefined) {
      if (options.signal?.aborted) {
        throw new DOMException("The request was aborted", "AbortError");
      }
      if (isAbortableGet) {
        return execute();
      }
      const key = JSON.stringify({
        base,
        url,
        method,
        credentials,
        headers,
      });
      const existing = inflightGets.get(key);
      if (existing) {
        return existing as Promise<T>;
      }
      const request = execute().finally(() => {
        inflightGets.delete(key);
      });
      inflightGets.set(key, request);
      return request as Promise<T>;
    }

    return execute();
  };
}
