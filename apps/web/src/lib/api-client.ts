import { env } from "./env";
import { useAuthStore } from "./auth-store";
import { getGuestToken } from "./guest-session";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public requestId?: string,
  ) {
    super(message);
  }
}

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const { refreshToken, setAccessToken, clear } = useAuthStore.getState();
  if (!refreshToken) return null;

  if (!refreshInFlight) {
    refreshInFlight = fetch(`${env.apiUrl}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    })
      .then(async (res) => {
        if (!res.ok) {
          clear();
          return null;
        }
        const data = await res.json();
        setAccessToken(data.accessToken);
        return data.accessToken as string;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

/**
 * Fetch wrapper for the Arutech Meet API: attaches the bearer access token and
 * transparently retries once after a silent refresh on 401 (access token expiry is
 * expected/routine, not an error condition the caller should have to handle).
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit & { skipAuth?: boolean } = {},
): Promise<T> {
  // A meeting guest has no access token at all — only a meeting-scoped guest
  // token (see lib/guest-session.ts) — so every REST call a guest's meeting
  // screen makes (chat history, whiteboard, polls, reactions...) would
  // otherwise silently go out with no Authorization header at all and 401.
  // A signed-in user's real token always takes precedence.
  const { accessToken } = useAuthStore.getState();
  const token = accessToken ?? getGuestToken();
  const doFetch = (token: string | null) =>
    fetch(`${env.apiUrl}/api/v1${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token && !options.skipAuth ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });

  let response = await doFetch(token);

  // Refreshing only ever applies to a real access token (it needs a stored
  // refreshToken, which a guest never has — see refreshAccessToken) — a
  // guest token 401ing just fails through as-is.
  if (response.status === 401 && !options.skipAuth) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      response = await doFetch(newToken);
    }
  }

  const requestId = response.headers.get("x-request-id") ?? undefined;

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      message = Array.isArray(body?.error?.message)
        ? body.error.message.join(", ")
        : (body?.error?.message ?? message);
    } catch {
      // response had no JSON body
    }
    throw new ApiError(response.status, message, requestId);
  }

  if (response.status === 204) return undefined as T;
  // A void-returning Nest controller method (e.g. markRead, remove) still
  // sends 200/201 with an empty body, not 204 — response.json() throws
  // "Unexpected end of JSON input" on that empty body if called
  // unconditionally. Read as text first and only parse when there's
  // something to parse.
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

/**
 * Like apiFetch, but for endpoints that return a binary body (a CSV/file
 * export) instead of JSON — attaches the bearer token, retries once after a
 * silent refresh on 401 exactly like apiFetch, and throws the same ApiError
 * on a non-ok response instead of returning it. That last part is the whole
 * point of this function existing: a plain `fetch(...).then(r => r.blob())`
 * has no concept of "ok" at all — an error response's JSON body (e.g. a 401
 * "Unauthorized" or 403 "Forbidden" payload) gets turned into a Blob just as
 * happily as a real file would, and a caller that unconditionally hands that
 * blob to a download link ends up silently saving the error message to disk
 * as if it were the requested export, with no visible indication anything
 * went wrong.
 */
export async function apiFetchBlob(
  path: string,
  options: RequestInit & { skipAuth?: boolean } = {},
): Promise<Blob> {
  const { accessToken } = useAuthStore.getState();
  const token = accessToken ?? getGuestToken();
  const doFetch = (token: string | null) =>
    fetch(`${env.apiUrl}/api/v1${path}`, {
      ...options,
      headers: {
        ...(token && !options.skipAuth ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });

  let response = await doFetch(token);

  if (response.status === 401 && !options.skipAuth) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      response = await doFetch(newToken);
    }
  }

  if (!response.ok) {
    const requestId = response.headers.get("x-request-id") ?? undefined;
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      message = Array.isArray(body?.error?.message)
        ? body.error.message.join(", ")
        : (body?.error?.message ?? message);
    } catch {
      // response had no JSON body
    }
    throw new ApiError(response.status, message, requestId);
  }

  return response.blob();
}
