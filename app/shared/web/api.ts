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

  const withAbortSignal = async <T>(
    request: Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> => {
    if (!signal) return request;
    if (signal.aborted) {
      throw new DOMException("The request was aborted", "AbortError");
    }
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        cleanup();
        reject(new DOMException("The request was aborted", "AbortError"));
      };
      const cleanup = () => signal.removeEventListener("abort", onAbort);
      signal.addEventListener("abort", onAbort, { once: true });
      request.then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error) => {
          cleanup();
          reject(error);
        },
      );
    });
  };

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

    const execute = async (signal?: AbortSignal) => {
      const res = await fetch(`${base}${url}`, {
        ...requestOptions,
        signal,
      });
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

    if (method === "GET" && body === undefined) {
      if (options.signal?.aborted) {
        throw new DOMException("The request was aborted", "AbortError");
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
        return withAbortSignal(existing as Promise<T>, options.signal);
      }
      const request = execute().finally(() => {
        inflightGets.delete(key);
      });
      inflightGets.set(key, request);
      return withAbortSignal(request as Promise<T>, options.signal);
    }

    return execute(options.signal);
  };
}
