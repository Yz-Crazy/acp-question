export class ApiRequestError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  const data = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("auth-expired"));
    throw new ApiRequestError(data.error || "请求失败，请稍后重试", response.status);
  }
  return data as T;
}

export function queryString(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  return params.toString();
}
