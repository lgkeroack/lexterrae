import { create } from 'zustand';

/**
 * One undoable action at a time, shown by <UndoToast /> on every page. Anything that changes
 * or removes something the user picked registers how to reverse it here, so there is always a
 * way back from a selection or a deletion.
 */
export interface UndoableAction {
  message: string;
  undo: () => void | Promise<void>;
}

interface UndoState {
  current: (UndoableAction & { id: number }) | null;
  isUndoing: boolean;
  error: string | null;
  push: (action: UndoableAction) => void;
  dismiss: () => void;
  undo: () => Promise<void>;
}

let nextId = 1;

export const useUndoStore = create<UndoState>((set, get) => ({
  current: null,
  isUndoing: false,
  error: null,
  push: (action) => set({ current: { ...action, id: nextId++ }, error: null }),
  dismiss: () => set({ current: null, error: null }),
  undo: async () => {
    const action = get().current;
    if (!action || get().isUndoing) return;
    set({ isUndoing: true, error: null });
    try {
      await action.undo();
      // A newer action may have arrived while undoing; only clear the one we undid
      if (get().current?.id === action.id) set({ current: null });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Could not undo.' });
    } finally {
      set({ isUndoing: false });
    }
  },
}));
