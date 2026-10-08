import type { DocumentJurisdictionSummary, FileType } from './document.js';
import type { JurisdictionSearchResult } from './jurisdiction.js';

/** A document as the user-facing library shows it (no uploader details). */
export interface LibraryDocument {
  id: string;
  title: string;
  description: string;
  fileType: FileType;
  fileSizeBytes: number;
  originalFilename: string;
  tags: string[];
  /** Official jurisdictions only; `applies` marks those that make it apply in the chosen place. */
  jurisdictions: (DocumentJurisdictionSummary & { applies?: boolean })[];
  uploadedAt: string;
  updatedAt: string;
}

/** GET /api/library/documents?jurisdictionId= */
export interface LibraryResponse {
  /** The chosen place, with its path. */
  place: JurisdictionSearchResult;
  data: LibraryDocument[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
}

/** One document that applies in a place, as the AI package builder lists it. */
export interface PackageContentsDocument {
  id: string;
  title: string;
  fileType: string;
  /** Characters of readable text (0 when the text isn't available). */
  textChars: number;
  textStatus: 'ready' | 'pending' | 'none';
  /** The most local jurisdiction that makes it apply (the place, a containing one, or Canada). */
  sourceId: string;
}

/** GET /api/library/package/contents?jurisdictionId= */
export interface PackageContentsResponse {
  place: JurisdictionSearchResult;
  /** The place and every jurisdiction containing it, most local first (Canada last). */
  sources: { id: string; name: string; level: JurisdictionSearchResult['level'] }[];
  /** All applying documents, most local first. */
  documents: PackageContentsDocument[];
}

/** POST /api/library/package */
export interface PackageRequest {
  jurisdictionId: string;
  /** Only these documents (all applying documents when omitted). */
  documentIds?: string[];
}
