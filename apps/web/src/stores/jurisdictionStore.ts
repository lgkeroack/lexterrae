import { create } from 'zustand';
import type { JurisdictionLevel, JurisdictionSearchResult } from '@lexterrae/shared';
import { MAX_JURISDICTIONS_PER_DOCUMENT } from '@lexterrae/shared';
import { api, getErrorMessage } from '../services/api';
import { PROVINCES, FEDERAL_CODE, type ProvinceInfo } from '../data/provinces';
import { useUndoStore } from './undoStore';

/**
 * A jurisdiction picked in the UI. `id` is the jurisdiction *code* (e.g. "CA", "ON",
 * "ON-TORONTO"), which is unique and stable; `uuid` is its database ID.
 */
export interface JurisdictionSelection {
  id: string;
  /** Database UUID. Missing only for Canada/provinces picked before the list loaded. */
  uuid?: string;
  name: string;
  level: JurisdictionLevel;
  subtype?: string | null;
  /** Province/territory code this jurisdiction is in (drives the map's "partly selected"). */
  parentCode?: string;
  /** Where it is, for display, e.g. "Peel, Ontario". */
  parentName?: string;
  isCustom?: boolean;
}

/** The API rejects uploads tagged with more than this many jurisdictions (shared constant). */
export const MAX_JURISDICTION_SELECTIONS = MAX_JURISDICTIONS_PER_DOCUMENT;

/** Everything inside one province/territory, loaded when the user browses it. */
export interface ProvinceContents {
  status: 'loading' | 'loaded' | 'error';
  items: JurisdictionSearchResult[];
  error?: string;
}

interface JurisdictionState {
  provinces: ProvinceInfo[];
  federalId: string | null;
  isLoadingProvinces: boolean;
  hasLoadedProvinces: boolean;
  provincesError: string | null;
  /** Keyed by province/territory code. */
  contents: Record<string, ProvinceContents>;
  selections: JurisdictionSelection[];
  isFederalSelected: boolean;
  activeProvince: string | null;
  fetchProvinces: (force?: boolean) => Promise<void>;
  loadProvinceContents: (code: string, force?: boolean) => Promise<void>;
  toggleFederal: () => void;
  /** Select/deselect an entire province (replaces any individual picks inside it). */
  toggleProvince: (code: string) => void;
  toggleEntireProvince: (code: string) => void;
  /** Select/deselect any jurisdiction below the provinces (regional, municipal, Indigenous). */
  toggleJurisdiction: (item: JurisdictionSearchResult) => void;
  isSelected: (code: string) => boolean;
  /** Deletes a jurisdiction the user added; the undo notice can re-create it. */
  deleteCustomJurisdiction: (item: JurisdictionSearchResult) => Promise<void>;
  /** Records a jurisdiction the user just added, and selects it. */
  addCustomJurisdiction: (item: JurisdictionSearchResult) => void;
  removeSelection: (id: string) => void;
  clearAll: () => void;
  /** Clears selections and drill-down state (e.g. after a successful upload). */
  reset: () => void;
  setActiveProvince: (code: string | null) => void;
  /** API UUIDs for the current selections; `missing` lists selections that could not be resolved. */
  getSelectionIds: () => { ids: string[]; missing: JurisdictionSelection[] };
}

const PROVINCE_LEVELS = new Set<JurisdictionLevel>(['provincial', 'territorial']);

function isProvinceLevel(level: string): level is 'provincial' | 'territorial' {
  return PROVINCE_LEVELS.has(level as JurisdictionLevel);
}

/** The province/territory a result sits in (its first ancestor, or itself). */
export function provinceOf(item: JurisdictionSearchResult): { code: string; name: string } | null {
  if (isProvinceLevel(item.level)) return { code: item.code, name: item.name };
  const top = item.path.find((p) => isProvinceLevel(p.level));
  return top ? { code: top.code, name: top.name } : null;
}

/** "Peel, Ontario": the ancestors, most specific first. */
export function describePath(item: JurisdictionSearchResult): string {
  return [...item.path]
    .reverse()
    .map((p) => p.name)
    .join(', ');
}

function selectionFrom(item: JurisdictionSearchResult): JurisdictionSelection {
  const province = provinceOf(item);
  return {
    id: item.code,
    uuid: item.id,
    name: item.name,
    level: item.level,
    subtype: item.subtype,
    parentCode: province && province.code !== item.code ? province.code : undefined,
    parentName: describePath(item) || undefined,
    isCustom: item.isCustom,
  };
}

let inFlight: Promise<void> | null = null;
const contentsInFlight = new Map<string, Promise<void>>();

export const useJurisdictionStore = create<JurisdictionState>((set, get) => ({
  provinces: PROVINCES,
  federalId: null,
  isLoadingProvinces: false,
  hasLoadedProvinces: false,
  provincesError: null,
  contents: {},
  selections: [],
  isFederalSelected: false,
  activeProvince: null,

  fetchProvinces: (force = false) => {
    if (inFlight) return inFlight;
    if (get().hasLoadedProvinces && !force) return Promise.resolve();
    set({ isLoadingProvinces: true, provincesError: null });
    inFlight = (async () => {
      try {
        const top = await api.getTopLevelJurisdictions();
        if (top.provinces.length === 0) {
          throw new Error('No jurisdictions are configured on the server.');
        }
        const provinces: ProvinceInfo[] = top.provinces
          .map((p) => ({
            id: p.id,
            name: p.name,
            code: p.code,
            level: p.level,
            legalSystem: p.legalSystem,
          }))
          .sort((a, b) =>
            a.level === b.level ? a.name.localeCompare(b.name) : a.level === 'provincial' ? -1 : 1,
          );
        set({
          provinces,
          federalId: top.federal.id,
          isLoadingProvinces: false,
          hasLoadedProvinces: true,
        });
      } catch (err) {
        set({
          isLoadingProvinces: false,
          provincesError: getErrorMessage(err, 'Could not load jurisdictions.'),
        });
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  },

  loadProvinceContents: async (code, force = false) => {
    const existing = get().contents[code];
    if (!force && (existing?.status === 'loaded' || contentsInFlight.has(code))) {
      return contentsInFlight.get(code);
    }
    if (!get().hasLoadedProvinces) await get().fetchProvinces();
    const province = get().provinces.find((p) => p.code === code);
    if (!province?.id) {
      set((s) => ({
        contents: {
          ...s.contents,
          [code]: { status: 'error', items: [], error: 'Jurisdictions could not be loaded.' },
        },
      }));
      return;
    }
    set((s) => ({
      contents: { ...s.contents, [code]: { status: 'loading', items: existing?.items ?? [] } },
    }));
    const request = api
      .getJurisdictionDescendants(province.id)
      .then((items) => {
        set((s) => ({ contents: { ...s.contents, [code]: { status: 'loaded', items } } }));
      })
      .catch((err: unknown) => {
        set((s) => ({
          contents: {
            ...s.contents,
            [code]: {
              status: 'error',
              items: [],
              error: getErrorMessage(err, 'Could not load jurisdictions.'),
            },
          },
        }));
      })
      .finally(() => contentsInFlight.delete(code));
    contentsInFlight.set(code, request);
    return request;
  },

  toggleFederal: () => {
    const { isFederalSelected, selections, federalId } = get();
    if (isFederalSelected) {
      set({
        isFederalSelected: false,
        selections: selections.filter((s) => s.level !== 'federal'),
      });
    } else {
      set({
        isFederalSelected: true,
        selections: [
          {
            id: FEDERAL_CODE,
            uuid: federalId ?? undefined,
            name: 'Federal (All of Canada)',
            level: 'federal',
          },
          ...selections,
        ],
      });
    }
  },

  toggleProvince: (code: string) => get().toggleEntireProvince(code),

  toggleEntireProvince: (code: string) => {
    const { selections, provinces } = get();
    const province = provinces.find((p) => p.code === code);
    if (!province) return;
    const isProvinceSelected = selections.some((s) => s.id === code && isProvinceLevel(s.level));
    if (isProvinceSelected) {
      set({ selections: selections.filter((s) => s.id !== code && s.parentCode !== code) });
    } else {
      // Selecting the whole province supersedes individual picks inside it.
      const withoutInner = selections.filter((s) => s.parentCode !== code);
      set({
        selections: [
          ...withoutInner,
          { id: code, uuid: province.id, name: province.name, level: province.level },
        ],
      });
    }
  },

  toggleJurisdiction: (item) => {
    if (item.level === 'federal') {
      get().toggleFederal();
      return;
    }
    if (isProvinceLevel(item.level) && get().provinces.some((p) => p.code === item.code)) {
      get().toggleEntireProvince(item.code);
      return;
    }
    const { selections } = get();
    if (selections.some((s) => s.id === item.code)) {
      set({ selections: selections.filter((s) => s.id !== item.code) });
      return;
    }
    const selection = selectionFrom(item);
    // Picking something inside a fully selected province narrows it to that pick
    set({
      selections: [
        ...selections.filter((s) => !(isProvinceLevel(s.level) && s.id === selection.parentCode)),
        selection,
      ],
    });
  },

  isSelected: (code) => get().selections.some((s) => s.id === code),

  deleteCustomJurisdiction: async (item) => {
    await api.deleteJurisdiction(item.id);
    const wasSelected = get().isSelected(item.code);
    const forget = (code: string) =>
      set((s) => {
        const province = provinceOf(item)?.code;
        const current = province ? s.contents[province] : undefined;
        return {
          selections: s.selections.filter((sel) => sel.id !== code),
          contents:
            province && current
              ? {
                  ...s.contents,
                  [province]: { ...current, items: current.items.filter((i) => i.code !== code) },
                }
              : s.contents,
        };
      });
    forget(item.code);
    useUndoStore.getState().push({
      message: `Deleted “${item.name}”`,
      undo: async () => {
        // Re-created with the same details (it gets a new ID)
        const again = await api.createJurisdiction({
          name: item.name,
          level: item.level,
          parentId: item.parentId ?? undefined,
          subtype: item.subtype ?? undefined,
        });
        const province = provinceOf(again);
        set((s) => {
          const current = province ? s.contents[province.code] : undefined;
          return {
            contents:
              province && current?.status === 'loaded'
                ? {
                    ...s.contents,
                    [province.code]: { ...current, items: [...current.items, again] },
                  }
                : s.contents,
            selections: wasSelected ? [...s.selections, selectionFrom(again)] : s.selections,
          };
        });
      },
    });
  },

  addCustomJurisdiction: (item) => {
    const province = provinceOf(item);
    if (province) {
      set((s) => {
        const current = s.contents[province.code];
        if (current?.status !== 'loaded') return s;
        return {
          contents: {
            ...s.contents,
            [province.code]: { ...current, items: [...current.items, item] },
          },
        };
      });
    }
    // Already covered when its whole province is selected
    const provinceSelected =
      province !== null &&
      province.code !== item.code &&
      get().selections.some((s) => isProvinceLevel(s.level) && s.id === province.code);
    if (!provinceSelected && !get().isSelected(item.code)) get().toggleJurisdiction(item);
  },

  removeSelection: (id: string) => {
    const { selections } = get();
    const target = selections.find((s) => s.id === id);
    if (target?.level === 'federal') {
      set({
        isFederalSelected: false,
        selections: selections.filter((s) => s.level !== 'federal'),
      });
    } else {
      set({ selections: selections.filter((s) => s.id !== id) });
    }
  },

  clearAll: () => {
    set({ selections: [], isFederalSelected: false });
  },

  reset: () => {
    set({ selections: [], isFederalSelected: false, activeProvince: null });
  },

  setActiveProvince: (code: string | null) => {
    set({ activeProvince: code });
    if (code) void get().loadProvinceContents(code);
  },

  getSelectionIds: () => {
    const { selections, provinces, federalId } = get();
    const ids: string[] = [];
    const missing: JurisdictionSelection[] = [];
    for (const s of selections) {
      const id =
        s.uuid ??
        (s.level === 'federal'
          ? federalId
          : provinces.find((p) => p.code === s.id && isProvinceLevel(s.level))?.id) ??
        undefined;
      if (id) ids.push(id);
      else missing.push(s);
    }
    return { ids: [...new Set(ids)], missing };
  },
}));

// ── Undo ────────────────────────────────────────────────────────────
// Every change to the selections can be reversed from the undo notice ("Selected Peel · Undo").

const UNDOABLE_ACTIONS = [
  'toggleFederal',
  'toggleProvince',
  'toggleEntireProvince',
  'toggleJurisdiction',
  'removeSelection',
  'clearAll',
] as const;

/** "Selected Peel", "Removed Toronto", "Cleared 4 jurisdictions", … or null if nothing changed. */
export function describeSelectionChange(
  before: JurisdictionSelection[],
  after: JurisdictionSelection[],
): string | null {
  const beforeIds = new Set(before.map((s) => s.id));
  const afterIds = new Set(after.map((s) => s.id));
  const added = after.filter((s) => !beforeIds.has(s.id));
  const removed = before.filter((s) => !afterIds.has(s.id));
  if (added.length === 0 && removed.length === 0) return null;
  if (added.length === 1 && removed.length === 0) return `Selected ${added[0]!.name}`;
  if (added.length === 0 && removed.length === 1) return `Removed ${removed[0]!.name}`;
  if (added.length === 0) return `Cleared ${removed.length} jurisdictions`;
  if (added.length === 1) {
    return `Selected ${added[0]!.name} (replacing ${removed.length} inside it)`;
  }
  return `Changed ${added.length + removed.length} jurisdictions`;
}

{
  const actions = useJurisdictionStore.getState();
  const wrapped: Partial<JurisdictionState> = {};
  for (const name of UNDOABLE_ACTIONS) {
    const action = actions[name] as (...args: unknown[]) => void;
    wrapped[name] = ((...args: unknown[]) => {
      const { selections, isFederalSelected } = useJurisdictionStore.getState();
      action(...args);
      const message = describeSelectionChange(
        selections,
        useJurisdictionStore.getState().selections,
      );
      if (message) {
        useUndoStore.getState().push({
          message,
          undo: () => useJurisdictionStore.setState({ selections, isFederalSelected }),
        });
      }
    }) as never;
  }
  useJurisdictionStore.setState(wrapped);
}
