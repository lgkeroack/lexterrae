import type {
  AuthResponse,
  TokenRefreshResponse,
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
  return crypto.randomUUID();
}

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorResponse,
  ) {
    super(body.detail || body.title);
    this.name = 'ApiError';
  }
}

async function parseErrorResponse(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as ApiErrorResponse;
    return new ApiError(response.status, body);
  } catch {
    return new ApiError(response.status, {
      type: 'about:blank',
      title: response.statusText,
      status: response.status,
      detail: `HTTP ${response.status}: ${response.statusText}`,
      instance: '',
    });
  }
}

let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  // Deduplicate concurrent refresh calls
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const response = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'X-Request-Id': generateRequestId(),
      },
    });

    if (!response.ok) {
      accessToken = null;
      throw await parseErrorResponse(response);
    }

    const data = (await response.json()) as TokenRefreshResponse;
    accessToken = data.accessToken;
    return data.accessToken;
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'X-Request-Id': generateRequestId(),
    ...(options.headers as Record<string, string> | undefined),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  // Only set Content-Type for non-FormData bodies
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  // Handle 401 with token refresh
  if (response.status === 401 && accessToken) {
    try {
      const newToken = await refreshAccessToken();
      headers['Authorization'] = `Bearer ${newToken}`;

      const retryResponse = await fetch(`${BASE_URL}${path}`, {
        ...options,
        headers,
        credentials: 'include',
      });

      if (!retryResponse.ok) {
        throw await parseErrorResponse(retryResponse);
      }

      if (retryResponse.status === 204) return undefined as T;
      return (await retryResponse.json()) as T;
    } catch {
      accessToken = null;
      throw await parseErrorResponse(response);
    }
  }

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
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

  async getGoogleConfig(): Promise<{ clientId: string; redirectUri: string }> {
    return request('/auth/google/config');
  },

  async googleCallback(code: string, redirectUri: string): Promise<AuthResponse> {
    const data = await request<AuthResponse>('/auth/google/callback', {
      method: 'POST',
      body: JSON.stringify({ code, redirectUri }),
    });
    accessToken = data.accessToken;
    return data;
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
