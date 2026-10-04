import { create } from 'zustand';
import type { User, LoginRequest, RegisterRequest, AuthResponse } from '@lexterrae/shared';
import {
  api,
  getAccessToken,
  getErrorMessage,
  getRefreshToken,
  getTokenExpiry,
  onAuthFailure,
  refreshAccessToken,
  setTokens,
  syncTokensFromStorage,
  type AuthResponseWithRefresh,
} from '../services/api';
import { useDocumentStore } from './documentStore';
import { useJurisdictionStore } from './jurisdictionStore';

/**
 * - `checking`: tokens exist but the access token is expired; a refresh is pending.
 * - `authenticated` / `unauthenticated`: settled.
 */
export type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  status: AuthStatus;
  isAuthenticated: boolean;
  /** True while a login/register request is in flight. */
  isLoading: boolean;
  error: string | null;

  login: (credentials: LoginRequest) => Promise<void>;
  register: (data: RegisterRequest) => Promise<void>;
  logout: () => void;
  setAuth: (response: AuthResponse | AuthResponseWithRefresh) => void;
  clearError: () => void;
  /** Refresh the access token. Rejects if the session can't be renewed. */
  refreshToken: () => Promise<void>;
  /** Resolve a `checking` status by attempting a refresh. Safe to call repeatedly. */
  initialize: () => Promise<void>;
}

const USER_KEY = 'user';
/** Refresh this long before the access token actually expires. */
const REFRESH_LEEWAY_MS = 60_000;
const RETRY_DELAY_MS = 30_000;

function readUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function writeUser(user: User | null): void {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    // ignore storage failures
  }
}

function isAccessTokenFresh(): boolean {
  const token = getAccessToken();
  if (!token) return false;
  const exp = getTokenExpiry(token);
  // If the expiry can't be decoded, trust the token; a 401 will trigger a refresh.
  return exp === null || exp - Date.now() > 5_000;
}

function initialStatus(): AuthStatus {
  if (isAccessTokenFresh()) return 'authenticated';
  // A previous session existed: try to restore it via the refresh cookie.
  if (getAccessToken() || getRefreshToken() || readUser()) return 'checking';
  return 'unauthenticated';
}

/** Clear per-user data held in other stores so the next user never sees it. */
function resetUserScopedStores(): void {
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useJurisdictionStore.setState(useJurisdictionStore.getInitialState(), true);
}

// ── Proactive refresh ───────────────────────────────────────────────
// Some stores read the access token straight from localStorage and don't
// retry on 401, so keep the token fresh ahead of expiry.

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function clearRefreshTimer(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
}

function scheduleRefresh(): void {
  clearRefreshTimer();
  const exp = getTokenExpiry();
  if (exp === null) return;
  const delay = Math.max(exp - Date.now() - REFRESH_LEEWAY_MS, 0);
  refreshTimer = setTimeout(() => {
    useAuthStore
      .getState()
      .refreshToken()
      .catch(() => {
        // Network hiccup: retry later. Auth failures already logged the user out.
        if (useAuthStore.getState().status === 'authenticated') {
          refreshTimer = setTimeout(scheduleRefresh, RETRY_DELAY_MS);
        }
      });
  }, delay);
}

let initPromise: Promise<void> | null = null;

const initial = initialStatus();

export const useAuthStore = create<AuthState>((set, get) => ({
  user: initial === 'unauthenticated' ? null : readUser(),
  accessToken: getAccessToken(),
  status: initial,
  isAuthenticated: initial === 'authenticated',
  isLoading: false,
  error: null,

  login: async (credentials: LoginRequest) => {
    set({ isLoading: true, error: null });
    try {
      const data = await api.login(credentials.email, credentials.password);
      get().setAuth(data);
    } catch (err) {
      set({ error: getErrorMessage(err, 'Sign in failed. Please try again.'), isLoading: false });
      throw err;
    }
  },

  register: async (data: RegisterRequest) => {
    set({ isLoading: true, error: null });
    try {
      const authData = await api.register(data.email, data.password, data.displayName);
      get().setAuth(authData);
    } catch (err) {
      set({
        error: getErrorMessage(err, 'Registration failed. Please try again.'),
        isLoading: false,
      });
      throw err;
    }
  },

  logout: () => {
    clearRefreshTimer();
    initPromise = null;
    void api.logout();
    writeUser(null);
    resetUserScopedStores();
    set({
      user: null,
      accessToken: null,
      status: 'unauthenticated',
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
  },

  setAuth: (response) => {
    const refresh = 'refreshToken' in response ? response.refreshToken : undefined;
    setTokens({ accessToken: response.accessToken, refreshToken: refresh });
    writeUser(response.user);
    set({
      user: response.user,
      accessToken: response.accessToken,
      status: 'authenticated',
      isAuthenticated: true,
      isLoading: false,
      error: null,
    });
    scheduleRefresh();
  },

  clearError: () => set({ error: null }),

  refreshToken: async () => {
    const token = await refreshAccessToken();
    set({ accessToken: token, status: 'authenticated', isAuthenticated: true });
    scheduleRefresh();
    if (!get().user) {
      // Restore the profile (e.g. storage was cleared but the cookie survived).
      api
        .me()
        .then((user) => {
          writeUser(user);
          set({ user });
        })
        .catch(() => undefined);
    }
  },

  initialize: () => {
    if (get().status !== 'checking') return Promise.resolve();
    if (!initPromise) {
      initPromise = get()
        .refreshToken()
        .catch(() => {
          // Refresh failed (expired/revoked token or server unreachable).
          // Auth failures already cleared stored state via onAuthFailure. For
          // outages (network/5xx) keep storage so a later reload can recover.
          if (get().status === 'checking') {
            set({ accessToken: null, status: 'unauthenticated', isAuthenticated: false });
          }
        })
        .finally(() => {
          initPromise = null;
        });
    }
    return initPromise;
  },
}));

// Session could not be renewed (refresh token expired/revoked) → sign out locally.
onAuthFailure(() => {
  clearRefreshTimer();
  writeUser(null);
  resetUserScopedStores();
  useAuthStore.setState({
    user: null,
    accessToken: null,
    status: 'unauthenticated',
    isAuthenticated: false,
    isLoading: false,
    error: null,
  });
});

if (initial === 'authenticated') {
  scheduleRefresh();
  if (!useAuthStore.getState().user) {
    api
      .me()
      .then((user) => {
        writeUser(user);
        useAuthStore.setState({ user });
      })
      .catch(() => undefined);
  }
}

if (typeof window !== 'undefined') {
  // Keep tabs in sync: logging out (or rotating tokens) in one tab applies to all.
  window.addEventListener('storage', (event) => {
    if (event.key !== 'accessToken' && event.key !== null) return;
    syncTokensFromStorage();
    const token = getAccessToken();
    if (!token) {
      clearRefreshTimer();
      resetUserScopedStores();
      useAuthStore.setState({
        user: null,
        accessToken: null,
        status: 'unauthenticated',
        isAuthenticated: false,
      });
    } else if (token && token !== useAuthStore.getState().accessToken) {
      useAuthStore.setState({
        user: readUser(),
        accessToken: token,
        status: 'authenticated',
        isAuthenticated: true,
      });
      scheduleRefresh();
    }
  });

  // Timers are throttled in background tabs; re-check when the tab is shown.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (useAuthStore.getState().status === 'authenticated' && !isAccessTokenFresh()) {
      useAuthStore
        .getState()
        .refreshToken()
        .catch(() => undefined);
    }
  });
}
