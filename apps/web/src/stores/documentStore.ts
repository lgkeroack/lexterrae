import { create } from 'zustand';
import type {
  DocumentWithJurisdictions,
  DocumentQueryParams,
  DocumentUpdateRequest,
  PaginatedResponse,
} from '@lexterrae/shared';

interface DocumentState {
  documents: DocumentWithJurisdictions[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
  queryParams: DocumentQueryParams;
  isLoading: boolean;
  error: string | null;
  currentDocument: DocumentWithJurisdictions | null;
  isLoadingDetail: boolean;
  uploadProgress: number;
  isUploading: boolean;
  uploadError: string | null;
  fetchDocuments: (params?: DocumentQueryParams) => Promise<void>;
  fetchDocument: (id: string) => Promise<void>;
  uploadDocument: (file: File, metadata: { title: string; description?: string; tags?: string[]; jurisdictionIds: string[] }) => Promise<void>;
  updateDocument: (id: string, updates: DocumentUpdateRequest) => Promise<void>;
  deleteDocument: (id: string) => Promise<void>;
  downloadDocument: (id: string, filename: string) => Promise<void>;
  setQueryParams: (params: Partial<DocumentQueryParams>) => void;
  clearError: () => void;
  clearUploadError: () => void;
}

import { getAccessToken } from '../services/api';

const API_BASE = '/api';

function getAuthHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  documents: [],
  pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
  queryParams: { page: 1, pageSize: 20 },
  isLoading: false,
  error: null,
  currentDocument: null,
  isLoadingDetail: false,
  uploadProgress: 0,
  isUploading: false,
  uploadError: null,

  fetchDocuments: async (params?: DocumentQueryParams) => {
    const queryParams = params || get().queryParams;
    set({ isLoading: true, error: null, queryParams });
    try {
      const searchParams = new URLSearchParams();
      Object.entries(queryParams).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') searchParams.set(key, String(value));
      });
      const res = await fetch(`${API_BASE}/documents?${searchParams.toString()}`, { headers: getAuthHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({ detail: 'Failed to fetch documents' })); throw new Error(err.detail || 'Failed to fetch documents'); }
      const data: PaginatedResponse<DocumentWithJurisdictions> = await res.json();
      set({ documents: data.data, pagination: data.pagination, isLoading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to fetch documents', isLoading: false });
    }
  },

  fetchDocument: async (id: string) => {
    set({ isLoadingDetail: true, error: null });
    try {
      const res = await fetch(`${API_BASE}/documents/${id}`, { headers: getAuthHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({ detail: 'Document not found' })); throw new Error(err.detail || 'Document not found'); }
      const doc: DocumentWithJurisdictions = await res.json();
      set({ currentDocument: doc, isLoadingDetail: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to fetch document', isLoadingDetail: false });
    }
  },

  uploadDocument: async (file, metadata) => {
    set({ isUploading: true, uploadProgress: 0, uploadError: null });
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', metadata.title);
      if (metadata.description) formData.append('description', metadata.description);
      if (metadata.tags) formData.append('tags', JSON.stringify(metadata.tags));
      formData.append('jurisdictionIds', JSON.stringify(metadata.jurisdictionIds));
      const xhr = new XMLHttpRequest();
      await new Promise<void>((resolve, reject) => {
        xhr.upload.addEventListener('progress', (e) => { if (e.lengthComputable) set({ uploadProgress: Math.round((e.loaded / e.total) * 100) }); });
        xhr.addEventListener('load', () => { if (xhr.status >= 200 && xhr.status < 300) resolve(); else { try { reject(new Error(JSON.parse(xhr.responseText).detail || 'Upload failed')); } catch { reject(new Error('Upload failed')); } } });
        xhr.addEventListener('error', () => reject(new Error('Upload failed')));
        xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));
        xhr.open('POST', `${API_BASE}/documents/upload`);
        const token = getAccessToken();
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.send(formData);
      });
      set({ isUploading: false, uploadProgress: 100 });
    } catch (err) {
      set({ uploadError: err instanceof Error ? err.message : 'Upload failed', isUploading: false, uploadProgress: 0 });
      throw err;
    }
  },

  updateDocument: async (id: string, updates: DocumentUpdateRequest) => {
    set({ error: null });
    try {
      const res = await fetch(`${API_BASE}/documents/${id}`, { method: 'PATCH', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(updates) });
      if (!res.ok) { const err = await res.json().catch(() => ({ detail: 'Update failed' })); throw new Error(err.detail || 'Update failed'); }
      const doc: DocumentWithJurisdictions = await res.json();
      set({ currentDocument: doc });
      const { documents } = get();
      set({ documents: documents.map((d) => (d.id === id ? doc : d)) });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Update failed' });
      throw err;
    }
  },

  deleteDocument: async (id: string) => {
    set({ error: null });
    try {
      const res = await fetch(`${API_BASE}/documents/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
      if (!res.ok) { const err = await res.json().catch(() => ({ detail: 'Delete failed' })); throw new Error(err.detail || 'Delete failed'); }
      const { documents } = get();
      set({ documents: documents.filter((d) => d.id !== id), currentDocument: null });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Delete failed' });
      throw err;
    }
  },

  downloadDocument: async (id: string, filename: string) => {
    try {
      const res = await fetch(`${API_BASE}/documents/${id}/download`, { headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Download failed' });
    }
  },

  setQueryParams: (params: Partial<DocumentQueryParams>) => {
    const current = get().queryParams;
    const updated = { ...current, ...params };
    set({ queryParams: updated });
    get().fetchDocuments(updated);
  },

  clearError: () => set({ error: null }),
  clearUploadError: () => set({ uploadError: null }),
}));
