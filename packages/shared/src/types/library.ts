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
