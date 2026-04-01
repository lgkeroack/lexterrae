import { create } from 'zustand';
import type { ProvinceData, MunicipalityData } from '@lexterrae/shared';
import { getAccessToken } from '../services/api';

export interface JurisdictionSelection {
  id: string;
  name: string;
  level: 'federal' | 'provincial' | 'territorial' | 'municipal';
  parentCode?: string;
  parentName?: string;
}

interface JurisdictionState {
  provinces: ProvinceData[];
  isLoadingProvinces: boolean;
  selections: JurisdictionSelection[];
  isFederalSelected: boolean;
  activeProvince: string | null;
  fetchProvinces: () => Promise<void>;
  toggleFederal: () => void;
  toggleProvince: (code: string) => void;
  toggleMunicipality: (provinceCode: string, municipality: MunicipalityData) => void;
  toggleEntireProvince: (code: string) => void;
  removeSelection: (id: string) => void;
  clearAll: () => void;
  setActiveProvince: (code: string | null) => void;
  getSelectionIds: () => string[];
}

const API_BASE = '/api';

const DEFAULT_PROVINCES: ProvinceData[] = [
  { name: 'Alberta', code: 'AB', level: 'provincial', legalSystem: 'common_law', municipalities: [{ name: 'Calgary', code: 'AB-CAL' }, { name: 'Edmonton', code: 'AB-EDM' }, { name: 'Red Deer', code: 'AB-RDD' }, { name: 'Lethbridge', code: 'AB-LET' }] },
  { name: 'British Columbia', code: 'BC', level: 'provincial', legalSystem: 'common_law', municipalities: [{ name: 'Vancouver', code: 'BC-VAN' }, { name: 'Victoria', code: 'BC-VIC' }, { name: 'Surrey', code: 'BC-SUR' }, { name: 'Burnaby', code: 'BC-BUR' }] },
  { name: 'Manitoba', code: 'MB', level: 'provincial', legalSystem: 'common_law', municipalities: [{ name: 'Winnipeg', code: 'MB-WPG' }, { name: 'Brandon', code: 'MB-BRA' }] },
  { name: 'New Brunswick', code: 'NB', level: 'provincial', legalSystem: 'common_law', municipalities: [{ name: 'Fredericton', code: 'NB-FRE' }, { name: 'Saint John', code: 'NB-SJO' }, { name: 'Moncton', code: 'NB-MON' }] },
  { name: 'Newfoundland and Labrador', code: 'NL', level: 'provincial', legalSystem: 'common_law', municipalities: [{ name: "St. John's", code: 'NL-STJ' }, { name: 'Corner Brook', code: 'NL-COB' }] },
  { name: 'Nova Scotia', code: 'NS', level: 'provincial', legalSystem: 'common_law', municipalities: [{ name: 'Halifax', code: 'NS-HAL' }, { name: 'Sydney', code: 'NS-SYD' }] },
  { name: 'Ontario', code: 'ON', level: 'provincial', legalSystem: 'common_law', municipalities: [{ name: 'Toronto', code: 'ON-TOR' }, { name: 'Ottawa', code: 'ON-OTT' }, { name: 'Mississauga', code: 'ON-MIS' }, { name: 'Hamilton', code: 'ON-HAM' }, { name: 'London', code: 'ON-LON' }] },
  { name: 'Prince Edward Island', code: 'PE', level: 'provincial', legalSystem: 'common_law', municipalities: [{ name: 'Charlottetown', code: 'PE-CHA' }] },
  { name: 'Quebec', code: 'QC', level: 'provincial', legalSystem: 'civil_law', municipalities: [{ name: 'Montreal', code: 'QC-MTL' }, { name: 'Quebec City', code: 'QC-QUE' }, { name: 'Laval', code: 'QC-LAV' }, { name: 'Gatineau', code: 'QC-GAT' }] },
  { name: 'Saskatchewan', code: 'SK', level: 'provincial', legalSystem: 'common_law', municipalities: [{ name: 'Regina', code: 'SK-REG' }, { name: 'Saskatoon', code: 'SK-SAS' }] },
  { name: 'Northwest Territories', code: 'NT', level: 'territorial', legalSystem: 'common_law', municipalities: [{ name: 'Yellowknife', code: 'NT-YEL' }] },
  { name: 'Nunavut', code: 'NU', level: 'territorial', legalSystem: 'common_law', municipalities: [{ name: 'Iqaluit', code: 'NU-IQA' }] },
  { name: 'Yukon', code: 'YT', level: 'territorial', legalSystem: 'common_law', municipalities: [{ name: 'Whitehorse', code: 'YT-WHI' }] },
];

export const useJurisdictionStore = create<JurisdictionState>((set, get) => ({
  provinces: DEFAULT_PROVINCES,
  isLoadingProvinces: false,
  selections: [],
  isFederalSelected: false,
  activeProvince: null,

  fetchProvinces: async () => {
    set({ isLoadingProvinces: true });
    try {
      const token = getAccessToken();
      const res = await fetch(`${API_BASE}/jurisdictions/provinces`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        set({ provinces: data, isLoadingProvinces: false });
      } else {
        set({ isLoadingProvinces: false });
      }
    } catch {
      set({ isLoadingProvinces: false });
    }
  },

  toggleFederal: () => {
    const { isFederalSelected, selections } = get();
    if (isFederalSelected) {
      set({ isFederalSelected: false, selections: selections.filter((s) => s.id !== 'federal') });
    } else {
      set({ isFederalSelected: true, selections: [...selections, { id: 'federal', name: 'Federal (All of Canada)', level: 'federal' }] });
    }
  },

  toggleProvince: (code: string) => {
    const { selections, provinces } = get();
    const province = provinces.find((p) => p.code === code);
    if (!province) return;
    const existing = selections.find((s) => s.id === code && s.level !== 'municipal');
    if (existing) {
      set({ selections: selections.filter((s) => s.id !== code && s.parentCode !== code) });
    } else {
      set({ selections: [...selections, { id: code, name: province.name, level: province.level }] });
    }
  },

  toggleMunicipality: (provinceCode: string, municipality: MunicipalityData) => {
    const { selections, provinces } = get();
    const province = provinces.find((p) => p.code === provinceCode);
    if (!province) return;
    const existing = selections.find((s) => s.id === municipality.code);
    if (existing) {
      set({ selections: selections.filter((s) => s.id !== municipality.code) });
    } else {
      set({ selections: [...selections, { id: municipality.code, name: municipality.name, level: 'municipal', parentCode: provinceCode, parentName: province.name }] });
    }
  },

  toggleEntireProvince: (code: string) => {
    const { selections, provinces } = get();
    const province = provinces.find((p) => p.code === code);
    if (!province) return;
    const isProvinceSelected = selections.some((s) => s.id === code && (s.level === 'provincial' || s.level === 'territorial'));
    if (isProvinceSelected) {
      set({ selections: selections.filter((s) => s.id !== code && s.parentCode !== code) });
    } else {
      const withoutMunis = selections.filter((s) => s.parentCode !== code);
      set({ selections: [...withoutMunis, { id: code, name: province.name, level: province.level }] });
    }
  },

  removeSelection: (id: string) => {
    const { selections } = get();
    if (id === 'federal') {
      set({ isFederalSelected: false, selections: selections.filter((s) => s.id !== 'federal') });
    } else {
      set({ selections: selections.filter((s) => s.id !== id && s.parentCode !== id) });
    }
  },

  clearAll: () => { set({ selections: [], isFederalSelected: false }); },

  setActiveProvince: (code: string | null) => { set({ activeProvince: code }); },

  getSelectionIds: () => get().selections.map((s) => s.id),
}));
