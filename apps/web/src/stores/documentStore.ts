import { create } from 'zustand';
import type {
  DocumentWithJurisdictions,
  DocumentQueryParams,
  DocumentUpdateRequest,
} from '@lexterrae/shared';
import { getAccessToken } from '../services/api';

export interface DocumentPagination {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

interface DocumentState {
  documents: DocumentWithJurisdictions[];
  pagination: DocumentPagination;
  queryParams: DocumentQueryParams;
  isLoading: boolean;
  /** Set once the first list request has completed (success or failure). */
  hasLoaded: boolean;
  /** Error loading the document list. */
  error: string | null;
  /** Error from a user action (download, delete, update) — shown as a dismissible notice. */
  actionError: string | null;
  currentDocument: DocumentWithJurisdictions | null;
  isLoadingDetail: boolean;
  /** Error loading the current document. */
  detailError: string | null;
  uploadProgress: number;
  isUploading: boolean;
  uploadError: string | null;
  fetchDocuments: (params?: DocumentQueryParams) => Promise<void>;
  fetchDocument: (id: string) => Promise<void>;
  uploadDocument: (file: File, metadata: { title: string; description?: string; tags?: string[]; jurisdictionIds: string[] }) => Promise<void>;
  updateDocument: (id: string, updates: DocumentUpdateRequest) => Promise<DocumentWithJurisdictions>;
  deleteDocument: (id: string) => Promise<void>;
  downloadDocument: (id: string, filename: string) => Promise<void>;
  setQueryParams: (params: Partial<DocumentQueryParams>) => void;
  clearError: () => void;
  clearActionError: () => void;
  clearUploadError: () => void;
}

const API_BASE = '/api';

/** The shared type uses snake_case sort keys; the API validator expects camelCase. */
const SORT_FIELD_TO_API: Record<NonNullable<DocumentQueryParams['sortBy']>, string> = {
  title: 'title',
  uploaded_at: 'uploadedAt',
  file_size_bytes: 'fileSizeBytes',
};

function getAuthHeaders(): Record<string, string> {
  const token = getAccessToken() ?? localStorage.getItem('accessToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.detail === 'string' && body.detail) return body.detail;
    if (body && typeof body.title === 'string' && body.title) return body.title;
  } catch {
    // Non-JSON body
  }
  if (res.status === 404) return 'Document not found';
  if (res.status === 403) return 'You do not have access to this document';
  return fallback;
}

/** API wraps single resources as `{ data: T }`; tolerate an unwrapped body too. */
function unwrap<T>(body: unknown): T {
  if (body && typeof body === 'object' && 'data' in body && !Array.isArray(body)) {
    return (body as { data: T }).data;
  }
  return body as T;
}

function normalizeDocument(doc: DocumentWithJurisdictions): DocumentWithJurisdictions {
  return {
    ...doc,
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    jurisdictions: Array.isArray(doc.jurisdictions) ? doc.jurisdictions : [],
  };
}

function buildListQuery(params: DocumentQueryParams): string {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (key === 'sortBy') {
      searchParams.set(key, SORT_FIELD_TO_API[value as keyof typeof SORT_FIELD_TO_API] ?? String(value));
    } else {
      searchParams.set(key, String(value).trim());
    }
  });
  return searchParams.toString();
}

/** Fetch a document's file as a Blob (used for download and inline PDF preview). */
export async function fetchDocumentBlob(id: string, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(`${API_BASE}/documents/${encodeURIComponent(id)}/download`, {
    headers: getAuthHeaders(),
    signal,
  });
  if (!res.ok) throw new Error(await readErrorMessage(res, 'Download failed'));
  return res.blob();
}

// Monotonic counters so only the latest request may write to the store.
let listRequestSeq = 0;
let listAbort: AbortController | null = null;
let detailRequestSeq = 0;
let detailAbort: AbortController | null = null;

export const useDocumentStore = create<DocumentState>((set, get) => ({
  documents: [],
  pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
  queryParams: { page: 1, pageSize: 20 },
  isLoading: false,
  hasLoaded: false,
  error: null,
  actionError: null,
  currentDocument: null,
  isLoadingDetail: false,
  detailError: null,
  uploadProgress: 0,
  isUploading: false,
  uploadError: null,

  fetchDocuments: async (params?: DocumentQueryParams) => {
    const queryParams = params || get().queryParams;
    const seq = ++listRequestSeq;
    listAbort?.abort();
    const controller = new AbortController();
    listAbort = controller;
    set({ isLoading: true, error: null, queryParams });
    try {
      const qs = buildListQuery(queryParams);
      const res = await fetch(`${API_BASE}/documents${qs ? `?${qs}` : ''}`, {
        headers: getAuthHeaders(),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to fetch documents'));
      const body = await res.json();
      if (seq !== listRequestSeq) return;
      const raw = (body?.pagination ?? {}) as Partial<DocumentPagination> & { total?: number };
      const pageSize = Number(raw.pageSize) || queryParams.pageSize || 20;
      // API returns `total`; shared type calls it `totalItems`.
      const totalItems = Number(raw.totalItems ?? raw.total) || 0;
      const docs: DocumentWithJurisdictions[] = Array.isArray(body?.data) ? body.data : [];
      set({
        documents: docs.map(normalizeDocument),
        pagination: {
          page: Number(raw.page) || queryParams.page || 1,
          pageSize,
          totalItems,
          totalPages: Number(raw.totalPages) || Math.ceil(totalItems / pageSize),
        },
        isLoading: false,
        hasLoaded: true,
      });
    } catch (err) {
      if (seq !== listRequestSeq) return; // superseded (includes AbortError)
      set({
        error: err instanceof Error ? err.message : 'Failed to fetch documents',
        isLoading: false,
        hasLoaded: true,
      });
    } finally {
      if (listAbort === controller) listAbort = null;
    }
  },

  fetchDocument: async (id: string) => {
    const seq = ++detailRequestSeq;
    detailAbort?.abort();
    const controller = new AbortController();
    detailAbort = controller;
    const existing = get().currentDocument;
    // Clear a previously viewed document so it never flashes under a new URL.
    set({
      isLoadingDetail: true,
      detailError: null,
      actionError: null,
      currentDocument: existing && existing.id === id ? existing : null,
    });
    try {
      const res = await fetch(`${API_BASE}/documents/${encodeURIComponent(id)}`, {
        headers: getAuthHeaders(),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to load document'));
      const doc = normalizeDocument(unwrap<DocumentWithJurisdictions>(await res.json()));
      if (seq !== detailRequestSeq) return;
      set({ currentDocument: doc, isLoadingDetail: false });
    } catch (err) {
      if (seq !== detailRequestSeq) return;
      set({
        detailError: err instanceof Error ? err.message : 'Failed to load document',
        currentDocument: null,
        isLoadingDetail: false,
      });
    } finally {
      if (detailAbort === controller) detailAbort = null;
    }
  },

  uploadDocument: async (file, metadata) => {
    set({ isUploading: true, uploadProgress: 0, uploadError: null });
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', metadata.title);
      if (metadata.description) formData.append('description', metadata.description);
      // multer parses `field[]` into arrays, which is what the API's zod schema expects
      // (a JSON-encoded string would fail `z.array(...)` validation).
      (metadata.tags ?? []).forEach((tag) => formData.append('tags[]', tag));
      metadata.jurisdictionIds.forEach((jid) => formData.append('jurisdictionIds[]', jid));
      const xhr = new XMLHttpRequest();
      await new Promise<void>((resolve, reject) => {
        xhr.upload.addEventListener('progress', (e) => { if (e.lengthComputable) set({ uploadProgress: Math.round((e.loaded / e.total) * 100) }); });
        xhr.addEventListener('load', () => { if (xhr.status >= 200 && xhr.status < 300) resolve(); else { try { reject(new Error(JSON.parse(xhr.responseText).detail || 'Upload failed')); } catch { reject(new Error('Upload failed')); } } });
        xhr.addEventListener('error', () => reject(new Error('Upload failed')));
        xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));
        // API route is POST /api/documents (there is no /upload sub-route).
        xhr.open('POST', `${API_BASE}/documents`);
        const { Authorization } = getAuthHeaders();
        if (Authorization) xhr.setRequestHeader('Authorization', Authorization);
        xhr.send(formData);
      });
      set({ isUploading: false, uploadProgress: 100 });
    } catch (err) {
      set({ uploadError: err instanceof Error ? err.message : 'Upload failed', isUploading: false, uploadProgress: 0 });
      throw err;
    }
  },

  updateDocument: async (id: string, updates: DocumentUpdateRequest) => {
    const prevCurrent = get().currentDocument;
    const prevDocuments = get().documents;
    // Optimistic update
    const applyUpdates = (d: DocumentWithJurisdictions) => (d.id === id ? { ...d, ...updates } : d);
    set({
      actionError: null,
      currentDocument: prevCurrent ? applyUpdates(prevCurrent) : prevCurrent,
      documents: prevDocuments.map(applyUpdates),
    });
    try {
      const res = await fetch(`${API_BASE}/documents/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Update failed'));
      const serverDoc = unwrap<DocumentWithJurisdictions>(await res.json());
      // Merge so fields the PATCH response omits (e.g. contentText) are kept.
      const merge = (d: DocumentWithJurisdictions) =>
        d.id === id ? normalizeDocument({ ...d, ...serverDoc }) : d;
      const { currentDocument, documents } = get();
      const merged = currentDocument && currentDocument.id === id ? merge(currentDocument) : null;
      set({
        currentDocument: merged ?? currentDocument,
        documents: documents.map(merge),
      });
      return merged ?? normalizeDocument({ ...(prevCurrent as DocumentWithJurisdictions), ...serverDoc });
    } catch (err) {
      // Roll back
      set({
        currentDocument: prevCurrent,
        documents: prevDocuments,
        actionError: err instanceof Error ? err.message : 'Update failed',
      });
      throw err;
    }
  },

  deleteDocument: async (id: string) => {
    const { documents: prevDocuments, pagination: prevPagination } = get();
    const wasListed = prevDocuments.some((d) => d.id === id);
    // Optimistic removal from the list
    set({
      actionError: null,
      documents: prevDocuments.filter((d) => d.id !== id),
      pagination: wasListed
        ? { ...prevPagination, totalItems: Math.max(0, prevPagination.totalItems - 1) }
        : prevPagination,
    });
    try {
      const res = await fetch(`${API_BASE}/documents/${encodeURIComponent(id)}`, { method: 'DELETE', headers: getAuthHeaders() });
      if (!res.ok) throw new Error(await readErrorMessage(res, 'Delete failed'));
      if (get().currentDocument?.id === id) set({ currentDocument: null });
    } catch (err) {
      // Roll back: restore the removed row (other concurrent removals are kept).
      const removed = prevDocuments.find((d) => d.id === id);
      if (removed) {
        const current = get().documents;
        const order = new Map(prevDocuments.map((d, i) => [d.id, i]));
        const restored = [...current, removed].sort(
          (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
        );
        set((s) => ({
          documents: restored,
          pagination: { ...s.pagination, totalItems: s.pagination.totalItems + 1 },
        }));
      }
      set({ actionError: err instanceof Error ? err.message : 'Delete failed' });
      throw err;
    }
  },

  downloadDocument: async (id: string, filename: string) => {
    set({ actionError: null });
    try {
      const blob = await fetchDocumentBlob(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'document';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoking synchronously can cancel the download in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      set({ actionError: err instanceof Error ? err.message : 'Download failed' });
    }
  },

  setQueryParams: (params: Partial<DocumentQueryParams>) => {
    const current = get().queryParams;
    const updated = { ...current, ...params };
    set({ queryParams: updated });
    get().fetchDocuments(updated);
  },

  clearError: () => set({ error: null }),
  clearActionError: () => set({ actionError: null }),
  clearUploadError: () => set({ uploadError: null }),
}));
