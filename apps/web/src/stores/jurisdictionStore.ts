import { create } from 'zustand';
import type { ProvinceData, MunicipalityData, JurisdictionTreeNode } from '@lexterrae/shared';
import { api, getErrorMessage } from '../services/api';
import { PROVINCES, FEDERAL_CODE } from '../data/provinces';

/**
 * A jurisdiction picked in the UI. `id` is the jurisdiction *code* (e.g. "CA", "ON",
 * "ON-TORONTO"); it is resolved to the API's UUID via `idByCode` when submitting.
 */
export interface JurisdictionSelection {
  id: string;
  name: string;
  level: 'federal' | 'provincial' | 'territorial' | 'municipal';
  parentCode?: string;
  parentName?: string;
}

/** The API rejects uploads tagged with more than this many jurisdictions. */
export const MAX_JURISDICTION_SELECTIONS = 10;

interface JurisdictionState {
  provinces: ProvinceData[];
  /** Jurisdiction code -> database UUID, populated from GET /api/jurisdictions. */
  idByCode: Record<string, string>;
  isLoadingProvinces: boolean;
  hasLoadedProvinces: boolean;
  provincesError: string | null;
  selections: JurisdictionSelection[];
  isFederalSelected: boolean;
  activeProvince: string | null;
  fetchProvinces: (force?: boolean) => Promise<void>;
  toggleFederal: () => void;
  /** Select/deselect an entire province (replaces any individual municipality picks). */
  toggleProvince: (code: string) => void;
  toggleMunicipality: (provinceCode: string, municipality: MunicipalityData) => void;
  toggleEntireProvince: (code: string) => void;
  removeSelection: (id: string) => void;
  clearAll: () => void;
  /** Clears selections and drill-down state (e.g. after a successful upload). */
  reset: () => void;
  setActiveProvince: (code: string | null) => void;
  /** API UUIDs for the current selections; `missing` lists selections that could not be resolved. */
  getSelectionIds: () => { ids: string[]; missing: JurisdictionSelection[] };
}

const FEDERAL_SELECTION: JurisdictionSelection = {
  id: FEDERAL_CODE,
  name: 'Federal (All of Canada)',
  level: 'federal',
};

function isProvinceLevel(level: string): level is 'provincial' | 'territorial' {
  return level === 'provincial' || level === 'territorial';
}

/** Converts the API's Federal -> Provincial -> Municipal tree into picker data. */
function buildFromTree(tree: JurisdictionTreeNode[]): {
  provinces: ProvinceData[];
  idByCode: Record<string, string>;
} {
  const idByCode: Record<string, string> = {};
  const all: JurisdictionTreeNode[] = [];
  const walk = (nodes: JurisdictionTreeNode[]) => {
    for (const n of nodes) {
      all.push(n);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(tree);

  for (const n of all) idByCode[n.code] = n.id;
  const federal = all.find((n) => n.level === 'federal');
  if (federal) idByCode[FEDERAL_CODE] = federal.id;

  const provinces: ProvinceData[] = all
    .filter((n) => isProvinceLevel(n.level))
    .map((p) => ({
      name: p.name,
      code: p.code,
      level: p.level as 'provincial' | 'territorial',
      legalSystem: (p.legalSystem === 'civil_law' ? 'civil_law' : 'common_law') as ProvinceData['legalSystem'],
      municipalities: (p.children ?? [])
        .filter((c) => c.level === 'municipal')
        .map((c) => ({ name: c.name, code: c.code }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) =>
      a.level === b.level ? a.name.localeCompare(b.name) : a.level === 'provincial' ? -1 : 1,
    );

  return { provinces, idByCode };
}

let inFlight: Promise<void> | null = null;

export const useJurisdictionStore = create<JurisdictionState>((set, get) => ({
  provinces: PROVINCES,
  idByCode: {},
  isLoadingProvinces: false,
  hasLoadedProvinces: false,
  provincesError: null,
  selections: [],
  isFederalSelected: false,
  activeProvince: null,

  fetchProvinces: (force = false) => {
    if (inFlight) return inFlight;
    if (get().hasLoadedProvinces && !force) return Promise.resolve();
    set({ isLoadingProvinces: true, provincesError: null });
    inFlight = (async () => {
      try {
        const tree = await api.getJurisdictions();
        const { provinces, idByCode } = buildFromTree(Array.isArray(tree) ? tree : []);
        if (provinces.length === 0) throw new Error('No jurisdictions are configured on the server.');
        // Drop any selection that no longer exists in the authoritative data.
        const selections = get().selections.filter((s) => idByCode[s.id]);
        set({
          provinces,
          idByCode,
          selections,
          isFederalSelected: selections.some((s) => s.level === 'federal'),
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

  toggleFederal: () => {
    const { isFederalSelected, selections } = get();
    if (isFederalSelected) {
      set({ isFederalSelected: false, selections: selections.filter((s) => s.level !== 'federal') });
    } else {
      set({ isFederalSelected: true, selections: [FEDERAL_SELECTION, ...selections] });
    }
  },

  toggleProvince: (code: string) => get().toggleEntireProvince(code),

  toggleMunicipality: (provinceCode: string, municipality: MunicipalityData) => {
    const { selections, provinces } = get();
    const province = provinces.find((p) => p.code === provinceCode);
    if (!province) return;
    const existing = selections.find((s) => s.id === municipality.code);
    if (existing) {
      set({ selections: selections.filter((s) => s.id !== municipality.code) });
    } else {
      set({
        selections: [
          ...selections,
          {
            id: municipality.code,
            name: municipality.name,
            level: 'municipal',
            parentCode: provinceCode,
            parentName: province.name,
          },
        ],
      });
    }
  },

  toggleEntireProvince: (code: string) => {
    const { selections, provinces } = get();
    const province = provinces.find((p) => p.code === code);
    if (!province) return;
    const isProvinceSelected = selections.some((s) => s.id === code && isProvinceLevel(s.level));
    if (isProvinceSelected) {
      set({ selections: selections.filter((s) => s.id !== code && s.parentCode !== code) });
    } else {
      // Selecting the whole province supersedes individual municipality picks.
      const withoutMunis = selections.filter((s) => s.parentCode !== code);
      set({ selections: [...withoutMunis, { id: code, name: province.name, level: province.level }] });
    }
  },

  removeSelection: (id: string) => {
    const { selections } = get();
    const target = selections.find((s) => s.id === id);
    if (target?.level === 'federal') {
      set({ isFederalSelected: false, selections: selections.filter((s) => s.level !== 'federal') });
    } else {
      set({ selections: selections.filter((s) => s.id !== id && s.parentCode !== id) });
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
  },

  getSelectionIds: () => {
    const { selections, idByCode } = get();
    const ids: string[] = [];
    const missing: JurisdictionSelection[] = [];
    for (const s of selections) {
      const id = idByCode[s.id];
      if (id) ids.push(id);
      else missing.push(s);
    }
    return { ids: [...new Set(ids)], missing };
  },
}));
