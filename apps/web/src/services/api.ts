import type {
  AuthResponse,
  TokenRefreshResponse,
  LoginRequest,
  RegisterRequest,
  Document,
  DocumentWithJurisdictions,
  DocumentUploadRequest,
  DocumentUpdateRequest,
  DocumentQueryParams,
  PaginatedResponse,
  JurisdictionTreeNode,
  ApiErrorResponse,
} from '@lexterrae/shared';

const BASE_URL = '/api';

function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// ── Token storage ───────────────────────────────────────────────────
// Tokens are persisted in localStorage so a page reload keeps the session.
// The `accessToken` key is also read directly by some stores, so it must
// always reflect the current access token.

const ACCESS_TOKEN_KEY = 'accessToken';
const REFRESH_TOKEN_KEY = 'refreshToken';

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Storage unavailable (private mode / quota) — keep in-memory only.
  }
}

let accessToken: string | null = readStorage(ACCESS_TOKEN_KEY);
let refreshToken: string | null = readStorage(REFRESH_TOKEN_KEY);

export function setAccessToken(token: string | null): void {
  accessToken = token;
  writeStorage(ACCESS_TOKEN_KEY, token);
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setRefreshToken(token: string | null): void {
  refreshToken = token;
  writeStorage(REFRESH_TOKEN_KEY, token);
}

export function getRefreshToken(): string | null {
  return refreshToken;
}

/** Set both tokens at once (e.g. after login). */
export function setTokens(tokens: { accessToken: string | null; refreshToken?: string | null }): void {
  setAccessToken(tokens.accessToken);
  if (tokens.refreshToken !== undefined) setRefreshToken(tokens.refreshToken);
}

export function clearTokens(): void {
  setAccessToken(null);
  setRefreshToken(null);
}

/** Re-read tokens from storage (another tab may have rotated them). */
export function syncTokensFromStorage(): void {
  accessToken = readStorage(ACCESS_TOKEN_KEY);
  refreshToken = readStorage(REFRESH_TOKEN_KEY);
}

/** Returns the access token's expiry in ms since epoch, or null if it can't be decoded. */
export function getTokenExpiry(token: string | null = accessToken): number | null {
  if (!token) return null;
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

// Listeners notified when the session can no longer be refreshed.
type AuthFailureListener = () => void;
const authFailureListeners = new Set<AuthFailureListener>();

export function onAuthFailure(listener: AuthFailureListener): () => void {
  authFailureListeners.add(listener);
  return () => authFailureListeners.delete(listener);
}

function notifyAuthFailure(): void {
  authFailureListeners.forEach((listener) => listener());
}

// ── Errors ──────────────────────────────────────────────────────────

interface ProblemBody extends ApiErrorResponse {
  code?: string;
  errors?: { path?: string; message?: string }[];
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ProblemBody,
  ) {
    super(body.detail || body.title || 'Request failed');
    this.name = 'ApiError';
  }

  /** True when the request never reached the server (offline, DNS, CORS, proxy down). */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

const NETWORK_ERROR_MESSAGE =
  'Unable to reach the server. Check your connection and try again.';

function fallbackMessage(status: number, statusText: string): string {
  if (status === 401) return 'Your session has expired. Please sign in again.';
  if (status === 403) return 'You do not have permission to perform this action.';
  if (status === 404) return 'The requested resource was not found.';
  if (status === 413) return 'The file is too large.';
  if (status === 429) return 'Too many requests. Please wait a moment and try again.';
  if (status === 502 || status === 503 || status === 504) {
    return 'The server is unavailable right now. Please try again shortly.';
  }
  if (status >= 500) return 'Something went wrong on the server. Please try again.';
  return `Request failed (${status}${statusText ? ` ${statusText}` : ''}).`;
}

function makeError(status: number, statusText: string, detail?: string): ApiError {
  return new ApiError(status, {
    type: 'about:blank',
    title: statusText || 'Error',
    status,
    detail: detail || fallbackMessage(status, statusText),
    instance: '',
  });
}

function networkError(): ApiError {
  return makeError(0, 'Network Error', NETWORK_ERROR_MESSAGE);
}

/** Parse an error response into an ApiError, tolerating non-JSON bodies. */
export async function parseErrorResponse(response: Response): Promise<ApiError> {
  let body: unknown;
  try {
    const text = await response.text();
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }

  if (body && typeof body === 'object' && ('detail' in body || 'title' in body)) {
    const problem = body as ProblemBody;
    // Surface the first field-level validation message when available — it's
    // far more useful than the generic "Request validation failed".
    const firstIssue = problem.errors?.find((e) => e?.message)?.message;
    if (firstIssue && problem.code === 'VALIDATION_ERROR') {
      return new ApiError(response.status, { ...problem, detail: firstIssue });
    }
    if (!problem.detail) {
      return new ApiError(response.status, {
        ...problem,
        detail: fallbackMessage(response.status, response.statusText),
      });
    }
    return new ApiError(response.status, problem);
  }

  return makeError(response.status, response.statusText);
}

/** Extract a user-facing message from any thrown value. */
export function getErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof TypeError) return NETWORK_ERROR_MESSAGE;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

// ── Refresh ─────────────────────────────────────────────────────────

let refreshPromise: Promise<string> | null = null;

async function doRefresh(): Promise<string> {
  const tokenUsed = refreshToken;
  if (!tokenUsed) throw makeError(401, 'Unauthorized');

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': generateRequestId(),
      },
      body: JSON.stringify({ refreshToken: tokenUsed }),
    });
  } catch {
    // Network failure: keep tokens so the session can recover once online.
    throw networkError();
  }

  if (!response.ok) {
    const error = await parseErrorResponse(response);
    // Another tab may have rotated the refresh token while we were waiting.
    const stored = readStorage(REFRESH_TOKEN_KEY);
    const storedAccess = readStorage(ACCESS_TOKEN_KEY);
    if (stored && stored !== tokenUsed && storedAccess) {
      syncTokensFromStorage();
      return storedAccess;
    }
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      clearTokens();
      notifyAuthFailure();
    }
    throw error;
  }

  const data = (await response.json()) as TokenRefreshResponse & { refreshToken?: string };
  setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken ?? refreshToken });
  return data.accessToken;
}

/**
 * Obtain a fresh access token. Concurrent callers share a single in-flight
 * request so a burst of 401s triggers exactly one refresh (important because
 * refresh tokens are rotated and single-use).
 */
export function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/** The API also returns a (rotating) refresh token alongside the access token. */
export type AuthResponseWithRefresh = AuthResponse & { refreshToken?: string };

// ── Requests ────────────────────────────────────────────────────────

const NO_REFRESH_PATHS = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout'];

async function send(path: string, options: RequestInit, token: string | null): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set('X-Request-Id', generateRequestId());
  if (token) headers.set('Authorization', `Bearer ${token}`);
  else headers.delete('Authorization');
  // Only set Content-Type for string (JSON) bodies; FormData sets its own boundary.
  if (typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  try {
    return await fetch(`${BASE_URL}${path}`, { ...options, headers, credentials: 'include' });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw networkError();
  }
}

/**
 * Authenticated fetch against the API (path relative to `/api`). Attaches the
 * bearer token and transparently refreshes + retries once on 401. Returns the
 * raw Response (callers handle `ok`); throws ApiError on network failure.
 */
export async function authFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const tokenAtSend = accessToken;
  const response = await send(path, options, tokenAtSend);

  if (response.status !== 401 || NO_REFRESH_PATHS.includes(path) || !refreshToken) {
    return response;
  }

  let newToken: string;
  if (accessToken && accessToken !== tokenAtSend) {
    // Token was already refreshed by a concurrent request while this one was in flight.
    newToken = accessToken;
  } else {
    try {
      newToken = await refreshAccessToken();
    } catch {
      return response;
    }
  }
  return send(path, options, newToken);
}

async function parseJson<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw makeError(response.status, response.statusText, 'The server returned an unexpected response.');
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await authFetch(path, options);
  if (!response.ok) {
    throw await parseErrorResponse(response);
  }
  return parseJson<T>(response);
}

function buildQueryString(params: Record<string, unknown>): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.set(key, String(value));
    }
  }
  const qs = searchParams.toString();
  return qs ? `?${qs}` : '';
}

export const api = {
  // ── Auth ──────────────────────────────────────────────────────────

  async login(email: string, password: string): Promise<AuthResponse> {
    const body: LoginRequest = { email, password };
    const data = await request<AuthResponseWithRefresh>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken ?? null });
    return data;
  },

  async register(
    email: string,
    password: string,
    displayName: string,
  ): Promise<AuthResponse> {
    const body: RegisterRequest = { email, password, displayName };
    const data = await request<AuthResponseWithRefresh>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken ?? null });
    return data;
  },

  /** Revoke the refresh token server-side (best effort) and clear local tokens. */
  async logout(): Promise<void> {
    const token = refreshToken;
    clearTokens();
    if (!token) return;
    try {
      await send('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken: token }) }, null);
    } catch {
      // Ignore — local session is already cleared.
    }
  },

  async refreshToken(): Promise<TokenRefreshResponse> {
    const token = await refreshAccessToken();
    return { accessToken: token };
  },

  // ── Documents ─────────────────────────────────────────────────────

  async getDocuments(
    params: DocumentQueryParams = {},
  ): Promise<PaginatedResponse<Document>> {
    const qs = buildQueryString(params as Record<string, unknown>);
    return request<PaginatedResponse<Document>>(`/documents${qs}`);
  },

  async getDocument(id: string): Promise<DocumentWithJurisdictions> {
    return request<DocumentWithJurisdictions>(`/documents/${encodeURIComponent(id)}`);
  },

  async uploadDocument(
    file: File,
    metadata: DocumentUploadRequest,
  ): Promise<Document> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', metadata.title);
    if (metadata.description) {
      formData.append('description', metadata.description);
    }
    if (metadata.tags) {
      formData.append('tags', JSON.stringify(metadata.tags));
    }
    formData.append('jurisdictionIds', JSON.stringify(metadata.jurisdictionIds));

    return request<Document>('/documents', {
      method: 'POST',
      body: formData,
    });
  },

  async updateDocument(
    id: string,
    updates: DocumentUpdateRequest,
  ): Promise<Document> {
    return request<Document>(`/documents/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  },

  async deleteDocument(id: string): Promise<void> {
    return request<void>(`/documents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  // ── Jurisdictions ─────────────────────────────────────────────────

  async getJurisdictions(): Promise<JurisdictionTreeNode[]> {
    return request<JurisdictionTreeNode[]>('/jurisdictions');
  },
} as const;
