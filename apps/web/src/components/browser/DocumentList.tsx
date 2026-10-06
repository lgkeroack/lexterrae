import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import {
  Search,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  File,
  Trash2,
  Download,
  X,
  AlertCircle,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { useDocumentStore } from '../../stores/documentStore';
import { useUndoStore } from '../../stores/undoStore';
import type {
  DocumentQueryParams,
  DocumentWithJurisdictions,
  FileType,
  JurisdictionLevel,
} from '@lexterrae/shared';
import { JURISDICTION_LEVELS, JURISDICTION_LEVEL_LABELS } from '@lexterrae/shared';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { useDebounce } from '../../hooks/useDebounce';
import { formatDate, formatFileSize, toISODate } from '../../utils/format';

type SortField = NonNullable<DocumentQueryParams['sortBy']>;
type SortOrder = NonNullable<DocumentQueryParams['sortOrder']>;

const SORT_FIELDS: SortField[] = ['title', 'uploaded_at', 'file_size_bytes'];
const LEVELS: readonly JurisdictionLevel[] = JURISDICTION_LEVELS;
const FILE_TYPE_LABELS: Record<FileType, string> = {
  pdf: 'PDF',
  doc: 'Word (.doc)',
  docx: 'Word (.docx)',
  xls: 'Excel (.xls)',
  xlsx: 'Excel (.xlsx)',
  csv: 'CSV',
  rtf: 'Rich text (.rtf)',
  txt: 'Text',
  png: 'PNG image',
  jpg: 'JPEG image',
};
const FILE_TYPES = Object.keys(FILE_TYPE_LABELS) as FileType[];
const PAGE_SIZES = [10, 20, 50, 100];
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_SORT: SortField = 'uploaded_at';
const DEFAULT_ORDER: SortOrder = 'desc';
const SEARCH_DEBOUNCE_MS = 300;
const MAX_SEARCH_LENGTH = 200;

/** Parse and sanitise list params from the URL so shared/back-forward links work. */
function parseParams(
  sp: URLSearchParams,
): Required<Pick<DocumentQueryParams, 'page' | 'pageSize' | 'sortBy' | 'sortOrder'>> &
  Pick<DocumentQueryParams, 'search' | 'jurisdictionLevel' | 'fileType'> {
  const page = Number.parseInt(sp.get('page') ?? '', 10);
  const pageSize = Number.parseInt(sp.get('pageSize') ?? '', 10);
  const sortBy = sp.get('sortBy') as SortField | null;
  const sortOrder = sp.get('sortOrder');
  const level = sp.get('jurisdictionLevel') as JurisdictionLevel | null;
  const fileType = sp.get('fileType') as FileType | null;
  const search = (sp.get('search') ?? '').trim().slice(0, MAX_SEARCH_LENGTH);
  return {
    page: Number.isFinite(page) && page >= 1 ? page : 1,
    pageSize: PAGE_SIZES.includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE,
    sortBy: sortBy && SORT_FIELDS.includes(sortBy) ? sortBy : DEFAULT_SORT,
    sortOrder: sortOrder === 'asc' || sortOrder === 'desc' ? sortOrder : DEFAULT_ORDER,
    search: search || undefined,
    jurisdictionLevel: level && LEVELS.includes(level) ? level : undefined,
    fileType: fileType && FILE_TYPES.includes(fileType) ? fileType : undefined,
  };
}

function FileIcon({ type }: { type: string }) {
  if (type === 'pdf')
    return <FileText className="h-5 w-5 flex-shrink-0 text-red-500" aria-hidden="true" />;
  return <File className="h-5 w-5 flex-shrink-0 text-blue-500" aria-hidden="true" />;
}

function JurisdictionBadges({ doc, max = 3 }: { doc: DocumentWithJurisdictions; max?: number }) {
  if (doc.jurisdictions.length === 0) {
    return <span className="text-xs text-gray-400">None</span>;
  }
  const hidden = doc.jurisdictions.slice(max);
  return (
    <div className="flex flex-wrap gap-1">
      {doc.jurisdictions.slice(0, max).map((j) => (
        <span key={j.id} title={j.name}>
          {/* Short codes for Canada and the provinces ("ON"); names below that */}
          <Badge
            label={
              j.level === 'federal' || j.level === 'provincial' || j.level === 'territorial'
                ? j.code || j.name
                : j.name
            }
            level={j.level}
          />
        </span>
      ))}
      {hidden.length > 0 && (
        <span className="text-xs text-gray-500" title={hidden.map((j) => j.name).join(', ')}>
          +{hidden.length} more
        </span>
      )}
    </div>
  );
}

const selectClass =
  'rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';

export function DocumentList() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const params = useMemo(() => parseParams(searchParams), [searchParams]);

  const documents = useDocumentStore((s) => s.documents);
  const pagination = useDocumentStore((s) => s.pagination);
  const isLoading = useDocumentStore((s) => s.isLoading);
  const hasLoaded = useDocumentStore((s) => s.hasLoaded);
  const error = useDocumentStore((s) => s.error);
  const actionError = useDocumentStore((s) => s.actionError);
  const fetchDocuments = useDocumentStore((s) => s.fetchDocuments);
  const deleteDocument = useDocumentStore((s) => s.deleteDocument);
  const downloadDocument = useDocumentStore((s) => s.downloadDocument);
  const clearActionError = useDocumentStore((s) => s.clearActionError);

  const [searchInput, setSearchInput] = useState(params.search ?? '');
  const debouncedSearch = useDebounce(searchInput, SEARCH_DEBOUNCE_MS);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  /** Merge updates into the URL; null/'' removes a key. */
  const updateParams = useCallback(
    (updates: Record<string, string | number | null | undefined>, opts?: { replace?: boolean }) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(updates)) {
            if (value === null || value === undefined || value === '') next.delete(key);
            else next.set(key, String(value));
          }
          return next;
        },
        { replace: opts?.replace },
      );
    },
    [setSearchParams],
  );

  // Fetch whenever the URL-derived params change (stale responses are ignored by the store).
  const paramsKey = JSON.stringify(params);
  useEffect(() => {
    fetchDocuments(JSON.parse(paramsKey) as DocumentQueryParams);
  }, [paramsKey, fetchDocuments]);

  // Push debounced search text into the URL.
  const urlSearch = params.search ?? '';
  const lastUrlSearch = useRef(urlSearch);
  useEffect(() => {
    const value = debouncedSearch.trim().slice(0, MAX_SEARCH_LENGTH);
    if (value === lastUrlSearch.current) return;
    lastUrlSearch.current = value;
    updateParams({ search: value || null, page: null }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  // Sync URL -> input on back/forward or external links.
  useEffect(() => {
    if (urlSearch !== lastUrlSearch.current) {
      lastUrlSearch.current = urlSearch;
      setSearchInput(urlSearch);
    }
  }, [urlSearch]);

  // Selection only applies to the visible page.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(documents.map((d) => d.id));
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [documents]);

  // If deletions/filters leave us past the last page, step back.
  useEffect(() => {
    if (!isLoading && !error && pagination.totalPages > 0 && params.page > pagination.totalPages) {
      updateParams(
        { page: pagination.totalPages === 1 ? null : pagination.totalPages },
        { replace: true },
      );
    }
  }, [isLoading, error, pagination.totalPages, params.page, updateParams]);

  const refetch = useCallback(() => fetchDocuments(params), [fetchDocuments, params]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = searchInput.trim().slice(0, MAX_SEARCH_LENGTH);
    if (value === lastUrlSearch.current) {
      refetch();
      return;
    }
    lastUrlSearch.current = value;
    updateParams({ search: value || null, page: null });
  };

  const clearSearch = () => {
    setSearchInput('');
    lastUrlSearch.current = '';
    updateParams({ search: null, page: null });
  };

  const hasFilters = Boolean(params.search || params.jurisdictionLevel || params.fileType);

  const clearFilters = () => {
    setSearchInput('');
    lastUrlSearch.current = '';
    updateParams({ search: null, jurisdictionLevel: null, fileType: null, page: null });
  };

  const handleSort = (field: SortField) => {
    const isSameField = params.sortBy === field;
    // New field: text sorts A→Z first, dates/sizes newest/largest first.
    const newOrder: SortOrder = isSameField
      ? params.sortOrder === 'asc'
        ? 'desc'
        : 'asc'
      : field === 'title'
        ? 'asc'
        : 'desc';
    updateParams({ sortBy: field, sortOrder: newOrder, page: null });
  };

  const handlePageChange = (page: number) => {
    if (page < 1 || (pagination.totalPages > 0 && page > pagination.totalPages)) return;
    updateParams({ page: page === 1 ? null : page });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allSelected = documents.length > 0 && documents.every((d) => selectedIds.has(d.id));
  const someSelected = selectedIds.size > 0 && !allSelected;
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(documents.map((d) => d.id)));
  };

  const handleBulkDelete = async () => {
    setIsBulkDeleting(true);
    const ids = [...selectedIds];
    const results = await Promise.allSettled(ids.map((id) => deleteDocument(id)));
    const failed = ids.filter((_, i) => results[i]?.status === 'rejected');
    setIsBulkDeleting(false);
    setShowBulkDelete(false);
    setSelectedIds(new Set(failed));
    if (failed.length > 0) {
      useDocumentStore.setState({
        actionError: `${failed.length} of ${ids.length} document(s) could not be deleted.`,
      });
    }
    // Refill the page from the server.
    refetch();
    const deleted = ids.filter((id) => !failed.includes(id));
    if (deleted.length > 0) {
      useUndoStore.getState().push({
        message: `Deleted ${deleted.length} document${deleted.length === 1 ? '' : 's'}`,
        undo: () => useDocumentStore.getState().restoreDocuments(deleted),
      });
    }
  };

  const linkState = { from: `${location.pathname}${location.search}` };

  const SortHeader = ({ field, label }: { field: SortField; label: string }) => {
    const active = params.sortBy === field;
    const Icon = !active ? ChevronsUpDown : params.sortOrder === 'asc' ? ChevronUp : ChevronDown;
    return (
      <th
        scope="col"
        aria-sort={active ? (params.sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
        className="px-4 py-3 text-left font-medium text-gray-700"
      >
        <button
          type="button"
          onClick={() => handleSort(field)}
          className="inline-flex items-center gap-1 rounded hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {label}
          <Icon
            className={`h-3.5 w-3.5 ${active ? 'text-gray-900' : 'text-gray-400'}`}
            aria-hidden="true"
          />
          {active && (
            <span className="sr-only">
              {params.sortOrder === 'asc' ? '(sorted ascending)' : '(sorted descending)'}
            </span>
          )}
        </button>
      </th>
    );
  };

  const rangeStart =
    pagination.totalItems === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const rangeEnd = Math.min(rangeStart + documents.length - 1, pagination.totalItems);
  const showSkeleton = isLoading && (!hasLoaded || documents.length === 0) && !error;
  const showError = Boolean(error) && !isLoading;
  const showEmpty = !isLoading && !error && hasLoaded && documents.length === 0;
  const showResults = documents.length > 0 && !showError;

  return (
    <div className="space-y-4">
      {/* Search and filters bar */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <form onSubmit={handleSearchSubmit} role="search" className="w-full md:w-auto">
          <label htmlFor="document-search" className="sr-only">
            Search documents
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              aria-hidden="true"
            />
            <input
              id="document-search"
              type="search"
              value={searchInput}
              maxLength={MAX_SEARCH_LENGTH}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search title, description, tags..."
              className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-9 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 md:w-72 [&::-webkit-search-cancel-button]:hidden"
            />
            {searchInput && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="filter-level" className="sr-only">
            Jurisdiction level
          </label>
          <select
            id="filter-level"
            value={params.jurisdictionLevel ?? ''}
            onChange={(e) =>
              updateParams({ jurisdictionLevel: e.target.value || null, page: null })
            }
            className={selectClass}
          >
            <option value="">All jurisdictions</option>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {JURISDICTION_LEVEL_LABELS[l]}
              </option>
            ))}
          </select>
          <label htmlFor="filter-type" className="sr-only">
            File type
          </label>
          <select
            id="filter-type"
            value={params.fileType ?? ''}
            onChange={(e) => updateParams({ fileType: e.target.value || null, page: null })}
            className={selectClass}
          >
            <option value="">All file types</option>
            {FILE_TYPES.map((type) => (
              <option key={type} value={type}>
                {FILE_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          {/* Sort control for the card layout, where there are no column headers */}
          <label htmlFor="sort-mobile" className="sr-only">
            Sort by
          </label>
          <select
            id="sort-mobile"
            value={`${params.sortBy}:${params.sortOrder}`}
            onChange={(e) => {
              const [sortBy, sortOrder] = e.target.value.split(':');
              updateParams({ sortBy, sortOrder, page: null });
            }}
            className={`${selectClass} md:hidden`}
          >
            <option value="uploaded_at:desc">Newest first</option>
            <option value="uploaded_at:asc">Oldest first</option>
            <option value="title:asc">Title A–Z</option>
            <option value="title:desc">Title Z–A</option>
            <option value="file_size_bytes:desc">Largest first</option>
            <option value="file_size_bytes:asc">Smallest first</option>
          </select>
          {hasFilters && (
            <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
              <X className="h-3.5 w-3.5" />
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {/* Bulk actions */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md bg-blue-50 px-4 py-2">
          <span className="text-sm font-medium text-blue-800">{selectedIds.size} selected</span>
          <Button variant="danger" size="sm" onClick={() => setShowBulkDelete(true)}>
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
            Clear selection
          </Button>
        </div>
      )}

      {/* Action error (download/delete) */}
      {actionError && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <span>{actionError}</span>
          <button
            type="button"
            onClick={clearActionError}
            className="rounded p-0.5 text-red-500 hover:bg-red-100"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Live region announcing result counts */}
      <p className="sr-only" aria-live="polite">
        {isLoading
          ? 'Loading documents'
          : hasLoaded && !error
            ? `${pagination.totalItems} ${pagination.totalItems === 1 ? 'document' : 'documents'} found`
            : ''}
      </p>

      {showError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-8 text-center"
        >
          <AlertCircle className="mx-auto mb-3 h-8 w-8 text-red-400" aria-hidden="true" />
          <p className="mb-4 text-sm text-red-700">{error}</p>
          <Button variant="secondary" size="sm" onClick={refetch}>
            <RefreshCw className="h-4 w-4" />
            Try again
          </Button>
        </div>
      )}

      {showSkeleton && (
        <div
          className="space-y-2 rounded-lg border border-gray-200 bg-white p-4"
          aria-hidden="true"
        >
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex animate-pulse items-center gap-4 py-2">
              <div className="h-4 w-4 rounded bg-gray-200" />
              <div className="h-4 flex-1 rounded bg-gray-200" />
              <div className="hidden h-4 w-24 rounded bg-gray-200 sm:block" />
              <div className="hidden h-4 w-16 rounded bg-gray-200 sm:block" />
            </div>
          ))}
        </div>
      )}

      {showEmpty && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white py-12 text-center">
          <FileText className="mx-auto mb-4 h-12 w-12 text-gray-300" aria-hidden="true" />
          {hasFilters ? (
            <>
              <h2 className="mb-1 text-lg font-medium text-gray-900">No matching documents</h2>
              <p className="mb-4 text-sm text-gray-500">
                {params.search ? (
                  <>
                    Nothing matches{' '}
                    <span className="font-medium text-gray-700">&ldquo;{params.search}&rdquo;</span>
                    {params.jurisdictionLevel || params.fileType
                      ? ' with the current filters.'
                      : '.'}
                  </>
                ) : (
                  'No documents match the current filters.'
                )}
              </p>
              <Button variant="secondary" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            </>
          ) : (
            <>
              <h2 className="mb-1 text-lg font-medium text-gray-900">No documents yet</h2>
              <p className="mb-4 text-sm text-gray-500">
                Upload your first document to get started.
              </p>
              <Link
                to="/upload"
                className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                <Upload className="h-4 w-4" aria-hidden="true" />
                Upload document
              </Link>
            </>
          )}
        </div>
      )}

      {showResults && (
        <div className="relative" aria-busy={isLoading}>
          {isLoading && (
            <div className="absolute inset-0 z-10 flex items-start justify-center bg-white/60 pt-12">
              <LoadingSpinner size="md" />
            </div>
          )}

          {/* Card layout for small screens */}
          <ul className="space-y-2 md:hidden" aria-label="Documents">
            {documents.map((doc) => (
              <li
                key={doc.id}
                className={`rounded-lg border bg-white p-3 ${
                  selectedIds.has(doc.id) ? 'border-blue-300 bg-blue-50' : 'border-gray-200'
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(doc.id)}
                    onChange={() => toggleSelect(doc.id)}
                    aria-label={`Select ${doc.title}`}
                    className="mt-1 h-4 w-4 flex-shrink-0 rounded border-gray-300 text-blue-600"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <FileIcon type={doc.fileType} />
                      <Link
                        to={`/documents/${doc.id}`}
                        state={linkState}
                        title={doc.title}
                        className="line-clamp-2 break-words font-medium text-blue-600 hover:text-blue-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      >
                        {doc.title}
                      </Link>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      <span className="uppercase">{doc.fileType}</span> &middot;{' '}
                      {formatFileSize(doc.fileSizeBytes)} &middot;{' '}
                      <time dateTime={toISODate(doc.uploadedAt)}>{formatDate(doc.uploadedAt)}</time>
                    </p>
                    <div className="mt-2">
                      <JurisdictionBadges doc={doc} />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => downloadDocument(doc.id, doc.originalFilename)}
                    className="flex-shrink-0 rounded p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    aria-label={`Download ${doc.title}`}
                    title="Download"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {/* Table layout for medium+ screens */}
          <div className="hidden overflow-x-auto rounded-lg border border-gray-200 bg-white md:block">
            <table className="w-full table-fixed text-sm">
              <caption className="sr-only">
                Documents, sorted by {params.sortBy.replace(/_/g, ' ')}{' '}
                {params.sortOrder === 'asc' ? 'ascending' : 'descending'}
              </caption>
              <colgroup>
                <col className="w-12" />
                <col />
                <col className="w-24" />
                <col className="w-48" />
                <col className="w-32" />
                <col className="w-24" />
                <col className="w-16" />
              </colgroup>
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th scope="col" className="px-4 py-3">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      aria-label="Select all documents on this page"
                      className="h-4 w-4 rounded border-gray-300 text-blue-600"
                    />
                  </th>
                  <SortHeader field="title" label="Title" />
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-700">
                    Type
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-medium text-gray-700">
                    Jurisdictions
                  </th>
                  <SortHeader field="uploaded_at" label="Uploaded" />
                  <SortHeader field="file_size_bytes" label="Size" />
                  <th scope="col" className="px-4 py-3 text-right font-medium text-gray-700">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr
                    key={doc.id}
                    className={`border-b border-gray-100 transition-colors last:border-b-0 hover:bg-gray-50 ${
                      selectedIds.has(doc.id) ? 'bg-blue-50' : ''
                    }`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(doc.id)}
                        onChange={() => toggleSelect(doc.id)}
                        aria-label={`Select ${doc.title}`}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600"
                      />
                    </td>
                    <th scope="row" className="px-4 py-3 text-left font-normal">
                      <Link
                        to={`/documents/${doc.id}`}
                        state={linkState}
                        title={doc.title}
                        className="block truncate font-medium text-blue-600 hover:text-blue-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      >
                        {doc.title}
                      </Link>
                      {doc.description && (
                        <p className="truncate text-xs text-gray-500" title={doc.description}>
                          {doc.description}
                        </p>
                      )}
                    </th>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <FileIcon type={doc.fileType} />
                        <span className="uppercase text-gray-600">{doc.fileType}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <JurisdictionBadges doc={doc} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                      <time dateTime={toISODate(doc.uploadedAt)}>{formatDate(doc.uploadedAt)}</time>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                      {formatFileSize(doc.fileSizeBytes)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => downloadDocument(doc.id, doc.originalFilename)}
                        className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                        aria-label={`Download ${doc.title}`}
                        title="Download"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {showResults && (
        <nav
          aria-label="Pagination"
          className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between"
        >
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <p>
              Showing <span className="font-medium">{rangeStart}</span>&ndash;
              <span className="font-medium">{rangeEnd}</span> of{' '}
              <span className="font-medium">{pagination.totalItems}</span>
            </p>
            <label htmlFor="page-size" className="sr-only">
              Documents per page
            </label>
            <select
              id="page-size"
              value={params.pageSize}
              onChange={(e) =>
                updateParams({
                  pageSize: Number(e.target.value) === DEFAULT_PAGE_SIZE ? null : e.target.value,
                  page: null,
                })
              }
              className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size} / page
                </option>
              ))}
            </select>
          </div>
          {pagination.totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => handlePageChange(pagination.page - 1)}
                disabled={pagination.page <= 1}
                aria-label="Previous page"
                className="rounded-md p-2 text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {Array.from({ length: pagination.totalPages }, (_, i) => i + 1)
                .filter(
                  (page) =>
                    page === 1 ||
                    page === pagination.totalPages ||
                    Math.abs(page - pagination.page) <= 1,
                )
                .map((page, idx, arr) => (
                  <React.Fragment key={page}>
                    {idx > 0 && arr[idx - 1] !== page - 1 && (
                      <span className="px-1 text-gray-400" aria-hidden="true">
                        &hellip;
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handlePageChange(page)}
                      aria-label={`Page ${page}`}
                      aria-current={page === pagination.page ? 'page' : undefined}
                      className={`h-8 min-w-[32px] rounded-md px-2 text-sm ${
                        page === pagination.page
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {page}
                    </button>
                  </React.Fragment>
                ))}
              <button
                type="button"
                onClick={() => handlePageChange(pagination.page + 1)}
                disabled={pagination.page >= pagination.totalPages}
                aria-label="Next page"
                className="rounded-md p-2 text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </nav>
      )}

      <Modal
        isOpen={showBulkDelete}
        onClose={() => !isBulkDeleting && setShowBulkDelete(false)}
        title="Delete documents"
      >
        <p className="mb-4 text-sm text-gray-600">
          Delete {selectedIds.size} selected document{selectedIds.size === 1 ? '' : 's'}? They will
          be moved to trash and permanently deleted after 30 days.
        </p>
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowBulkDelete(false)}
            disabled={isBulkDeleting}
          >
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={handleBulkDelete} isLoading={isBulkDeleting}>
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}
