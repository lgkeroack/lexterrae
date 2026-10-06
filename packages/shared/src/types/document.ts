import type { JurisdictionLevel } from './jurisdiction.js';

/** Jurisdiction summary embedded in document responses. */
export interface DocumentJurisdictionSummary {
  id: string;
  name: string;
  code: string;
  level: JurisdictionLevel;
  parentId: string | null;
  /**
   * Implied by a smaller jurisdiction the document is tagged with (Toronto → Ontario, Canada),
   * rather than picked directly.
   */
  inherited?: boolean;
}

export type FileType =
  | 'pdf'
  | 'txt'
  | 'doc'
  | 'docx'
  | 'xls'
  | 'xlsx'
  | 'csv'
  | 'rtf'
  | 'png'
  | 'jpg';

export interface Document {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  fileType: FileType;
  fileSizeBytes: number;
  originalFilename: string;
  /** Extracted text; only present on single-document responses (GET/PATCH /documents/:id). */
  contentText?: string | null;
  tags: string[];
  /** Present on every document response from the API. */
  jurisdictions: DocumentJurisdictionSummary[];
  uploadedAt: string;
  updatedAt: string;
}

/** Kept for compatibility: every API document response includes jurisdictions. */
export type DocumentWithJurisdictions = Document;

export interface DocumentUploadRequest {
  title: string;
  description?: string;
  tags?: string[];
  /** Jurisdiction UUIDs or codes (e.g. "CA", "BC", "BC-VANCOUVER"). */
  jurisdictionIds: string[];
}

export interface DocumentUpdateRequest {
  title?: string;
  description?: string;
  tags?: string[];
}

export interface DocumentQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  jurisdictionLevel?: string;
  /** Matches documents tagged with this jurisdiction or any of its sub-jurisdictions. */
  jurisdictionId?: string;
  fileType?: FileType;
  /** The API accepts these snake_case keys as well as camelCase (uploadedAt, fileSizeBytes, updatedAt). */
  sortBy?: 'title' | 'uploaded_at' | 'file_size_bytes';
  sortOrder?: 'asc' | 'desc';
  dateFrom?: string;
  dateTo?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    /** @deprecated alias of totalItems */
    total?: number;
    totalPages: number;
  };
}

/** Envelope used by single-resource API responses, e.g. GET /documents/:id → { data: Document }. */
export interface DataResponse<T> {
  data: T;
}
