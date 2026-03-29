const BASE = "";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(
  url: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  body?: unknown,
): Promise<T> {
  const opts: RequestInit = { method, headers: {}, credentials: "include" };
  if (body) {
    (opts.headers as Record<string, string>)["Content-Type"] =
      "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${url}`, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => "Request failed");
    throw new ApiError(res.status, text);
  }
  return res.json();
}
