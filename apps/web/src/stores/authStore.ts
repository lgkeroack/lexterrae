import { create } from 'zustand';
import type { User, AuthResponse } from '@lexterrae/shared';
import { setAccessToken } from '../services/api';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  setAuth: (response: AuthResponse) => void;
  logout: () => Promise<void>;
  clearError: () => void;
  refreshToken: () => Promise<void>;
  fetchUser: () => Promise<void>;
}

const API_BASE = '/api';

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,

  setAuth: (response: AuthResponse) => {
    setAccessToken(response.accessToken);
    set({
      user: response.user,
      isAuthenticated: true,
      isLoading: false,
      error: null,
    });
  },

  logout: async () => {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Best-effort logout
    }
    setAccessToken(null);
    set({ user: null, isAuthenticated: false, error: null });
  },

  clearError: () => set({ error: null }),

  refreshToken: async () => {
    try {
      set({ isLoading: true });
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        setAccessToken(null);
        set({ user: null, isAuthenticated: false, isLoading: false });
        return;
      }
      const data = await res.json();
      setAccessToken(data.accessToken);
      set({ isAuthenticated: true, isLoading: false });

      // Fetch user profile if we don't have it
      if (!get().user) {
        await get().fetchUser();
      }
    } catch {
      setAccessToken(null);
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  fetchUser: async () => {
    try {
      const { getAccessToken } = await import('../services/api');
      const token = getAccessToken();
      if (!token) return;

      const res = await fetch(`${API_BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        set({ user: data.user });
      }
    } catch {
      // Non-critical - user display info can be missing temporarily
    }
  },
}));
