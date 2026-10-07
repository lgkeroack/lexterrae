import { create } from 'zustand';
import type { BackendRole } from '@lexterrae/shared';
import { api, getErrorMessage } from '../services/api';

/** The signed-in user's backend access: who may use document management and manage users. */
interface AccessState {
  role: BackendRole | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  load: () => Promise<void>;
}

let pending: Promise<void> | null = null;

export const useAccessStore = create<AccessState>((set) => ({
  role: null,
  status: 'idle',
  error: null,
  load: () => {
    pending ??= api
      .getBackendAccess()
      .then((role) => set({ role, status: 'ready', error: null }))
      .catch((err: unknown) =>
        set({ status: 'error', error: getErrorMessage(err, 'Could not check your access.') }),
      )
      .finally(() => {
        pending = null;
      });
    set((s) => (s.status === 'ready' ? s : { status: 'loading', error: null }));
    return pending;
  },
}));
