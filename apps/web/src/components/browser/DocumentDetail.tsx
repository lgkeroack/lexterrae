import React, { useState, useEffect, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Download,
  Trash2,
  Edit3,
  Save,
  X,
  FileText,
  File,
  ChevronRight,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import type { DocumentWithJurisdictions } from '@lexterrae/shared';
import { MAX_DESCRIPTION_LENGTH } from '@lexterrae/shared';
import { useDocumentStore, fetchDocumentBlob } from '../../stores/documentStore';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { Badge } from '../common/Badge';
import { useUndoStore } from '../../stores/undoStore';
import { Modal } from '../common/Modal';
import { formatDate, formatDateTime, formatFileSize, toISODate } from '../../utils/format';

interface DocumentDetailProps {
  documentId: string;
}

const MAX_TITLE = 255;
const MAX_DESCRIPTION = MAX_DESCRIPTION_LENGTH;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 50;

function parseTags(input: string): string[] {
  const seen = new Set<string>();
  return input
    .split(',')
    .map((t) => t.trim())
    .filter((t) => {
      if (!t || seen.has(t.toLowerCase())) return false;
      seen.add(t.toLowerCase());
      return true;
    });
}

/** Where "Back" should go: the list URL (with filters) we came from, if any. */
function useBackTarget(): string {
  const location = useLocation();
  const from = (location.state as { from?: unknown } | null)?.from;
  return typeof from === 'string' && from.startsWith('/documents') ? from : '/documents';
}

/**
 * Loads a PDF through fetch (so the auth header is sent) and exposes it as a
 * blob URL. The download endpoint itself sends `Content-Disposition: attachment`
 * and `X-Frame-Options: DENY`, so it cannot be embedded directly.
 */
function usePdfPreview(documentId: string, enabled: boolean) {
  const [state, setState] = useState<{
    url: string | null;
    error: string | null;
    loading: boolean;
  }>({
    url: null,
    error: null,
    loading: false,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setState({ url: null, error: null, loading: false });
      return;
    }
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setState({ url: null, error: null, loading: true });
    fetchDocumentBlob(documentId, controller.signal)
      .then((blob) => {
        objectUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
        setState({ url: objectUrl, error: null, loading: false });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          url: null,
          error: err instanceof Error ? err.message : 'Preview failed',
          loading: false,
        });
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [documentId, enabled, attempt]);

  return { ...state, retry: () => setAttempt((a) => a + 1) };
}

export function DocumentDetail({ documentId }: DocumentDetailProps) {
  const navigate = useNavigate();
  const backTo = useBackTarget();

  const currentDocument = useDocumentStore((s) => s.currentDocument);
  const isLoadingDetail = useDocumentStore((s) => s.isLoadingDetail);
  const detailError = useDocumentStore((s) => s.detailError);
  const actionError = useDocumentStore((s) => s.actionError);
  const fetchDocument = useDocumentStore((s) => s.fetchDocument);
  const updateDocument = useDocumentStore((s) => s.updateDocument);
  const deleteDocument = useDocumentStore((s) => s.deleteDocument);
  const downloadDocument = useDocumentStore((s) => s.downloadDocument);
  const clearActionError = useDocumentStore((s) => s.clearActionError);

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editTags, setEditTags] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  // Only use the store's document if it is the one this route is showing.
  const doc = currentDocument && currentDocument.id === documentId ? currentDocument : null;
  const isPdf = doc?.fileType === 'pdf';
  const preview = usePdfPreview(documentId, Boolean(doc) && isPdf);

  // Fetch, and reset local UI state, whenever the route's document changes.
  useEffect(() => {
    setIsEditing(false);
    setShowDeleteModal(false);
    setIsDeleting(false);
    fetchDocument(documentId);
  }, [documentId, fetchDocument]);

  // Seed the edit form from the loaded document (not while the user is editing).
  useEffect(() => {
    if (doc && !isEditing) {
      setEditTitle(doc.title);
      setEditDescription(doc.description || '');
      setEditTags(doc.tags.join(', '));
    }
  }, [doc, isEditing]);

  useEffect(() => {
    const previous = document.title;
    document.title = doc
      ? `${doc.title} · Lex Terrae`
      : detailError
        ? 'Document unavailable · Lex Terrae'
        : 'Document · Lex Terrae';
    return () => {
      document.title = previous;
    };
  }, [doc, detailError]);

  const parsedTags = useMemo(() => parseTags(editTags), [editTags]);
  const titleError = !editTitle.trim()
    ? 'Title is required'
    : editTitle.trim().length > MAX_TITLE
      ? `Title must be ${MAX_TITLE} characters or fewer`
      : undefined;
  const tagsError =
    parsedTags.length > MAX_TAGS
      ? `Maximum ${MAX_TAGS} tags allowed`
      : parsedTags.some((t) => t.length > MAX_TAG_LENGTH)
        ? `Each tag must be ${MAX_TAG_LENGTH} characters or fewer`
        : undefined;
  const descriptionError =
    editDescription.trim().length > MAX_DESCRIPTION
      ? `Description must be ${MAX_DESCRIPTION} characters or fewer`
      : undefined;
  const canSave = !titleError && !tagsError && !descriptionError;

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!doc || !canSave || isSaving) return;
    setIsSaving(true);
    try {
      await updateDocument(doc.id, {
        title: editTitle.trim(),
        // Send '' (not undefined) so clearing the description is persisted.
        description: editDescription.trim(),
        tags: parsedTags,
      });
      setIsEditing(false);
    } catch {
      // Store rolled back the optimistic update and set actionError.
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!doc) return;
    setIsDeleting(true);
    try {
      await deleteDocument(doc.id);
      setShowDeleteModal(false);
      const { id, title } = doc;
      useUndoStore.getState().push({
        message: `Deleted “${title}”`,
        undo: async () => {
          await useDocumentStore.getState().restoreDocuments([id]);
          navigate(`/documents/${id}`);
        },
      });
      // Replace so Back doesn't return to a deleted document.
      navigate(backTo, { replace: true });
    } catch {
      setIsDeleting(false);
      setShowDeleteModal(false);
    }
  };

  const handleDownload = async () => {
    if (!doc) return;
    setIsDownloading(true);
    try {
      await downloadDocument(doc.id, doc.originalFilename);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleCancelEdit = () => {
    if (doc) {
      setEditTitle(doc.title);
      setEditDescription(doc.description || '');
      setEditTags(doc.tags.join(', '));
    }
    setIsEditing(false);
  };

  const backLink = (
    <Link
      to={backTo}
      className="inline-flex items-center gap-1 rounded text-sm text-gray-600 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Back to documents
    </Link>
  );

  if (!doc && detailError && !isLoadingDetail) {
    return (
      <div className="space-y-6">
        {backLink}
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-10 text-center"
        >
          <AlertCircle className="mx-auto mb-3 h-8 w-8 text-red-400" aria-hidden="true" />
          <p className="mb-4 text-red-700">{detailError}</p>
          <div className="flex justify-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => fetchDocument(documentId)}>
              <RefreshCw className="h-4 w-4" />
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!doc) {
    // Loading skeleton
    return (
      <div className="space-y-6" aria-busy="true">
        {backLink}
        <span className="sr-only" role="status">
          Loading document
        </span>
        <div className="animate-pulse space-y-6" aria-hidden="true">
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded bg-gray-200" />
            <div className="flex-1 space-y-2">
              <div className="h-6 w-2/3 rounded bg-gray-200" />
              <div className="h-4 w-1/2 rounded bg-gray-200" />
            </div>
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="h-48 rounded-lg bg-gray-200 lg:col-span-2" />
            <div className="h-48 rounded-lg bg-gray-200" />
          </div>
        </div>
      </div>
    );
  }

  const jurisdictionBreadcrumbs = buildBreadcrumbs(doc);

  return (
    <div className="space-y-6">
      {backLink}

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

      {/* Header */}
      <form
        id="document-edit-form"
        onSubmit={handleSave}
        className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {isPdf ? (
            <FileText className="h-8 w-8 flex-shrink-0 text-red-500" aria-hidden="true" />
          ) : (
            <File className="h-8 w-8 flex-shrink-0 text-blue-500" aria-hidden="true" />
          )}
          <div className="min-w-0 flex-1">
            {isEditing ? (
              <Input
                id="edit-title"
                aria-label="Title"
                value={editTitle}
                maxLength={MAX_TITLE}
                onChange={(e) => setEditTitle(e.target.value)}
                error={titleError}
                className="text-lg font-semibold"
                autoFocus
              />
            ) : (
              <h1 className="break-words text-xl font-bold text-gray-900">{doc.title}</h1>
            )}
            <p className="mt-1 break-all text-sm text-gray-500">
              <span title={doc.originalFilename}>{doc.originalFilename}</span> &middot;{' '}
              {formatFileSize(doc.fileSizeBytes)} &middot; Uploaded{' '}
              <time dateTime={toISODate(doc.uploadedAt)}>{formatDate(doc.uploadedAt)}</time>
            </p>
            {doc.textStatus === 'none' && (
              <p role="note" className="mt-2 border-l-4 border-accent pl-3 text-sm">
                <strong>No readable text.</strong> This file can&apos;t be searched or included in
                AI reference packages: only its title and description are.{' '}
                {doc.fileType === 'pdf' || doc.fileType === 'png' || doc.fileType === 'jpg'
                  ? 'It looks like a scan or image; upload a text-based PDF instead.'
                  : 'It may be damaged or password-protected; upload it as a text-based PDF, Word, Excel or RTF file instead.'}
              </p>
            )}
            {doc.textStatus === 'pending' && (
              <p className="mt-2 text-sm italic text-gray-600">
                Reading this file&apos;s text… it will be searchable shortly.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-shrink-0 flex-wrap gap-2">
          {isEditing ? (
            <>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                isLoading={isSaving}
                disabled={!canSave}
              >
                {!isSaving && <Save className="h-4 w-4" />}
                Save
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCancelEdit}
                disabled={isSaving}
              >
                <X className="h-4 w-4" />
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setIsEditing(true)}
              >
                <Edit3 className="h-4 w-4" />
                Edit
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleDownload}
                isLoading={isDownloading}
              >
                {!isDownloading && <Download className="h-4 w-4" />}
                Download
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => setShowDeleteModal(true)}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </>
          )}
        </div>
      </form>

      {/* Jurisdiction breadcrumbs */}
      {jurisdictionBreadcrumbs.length > 0 && (
        <ul
          className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm"
          aria-label="Jurisdiction paths"
        >
          {jurisdictionBreadcrumbs.map((crumbs) => (
            <li
              key={crumbs.join('/')}
              className="flex items-center gap-1 border-gray-300 [&:not(:first-child)]:border-l [&:not(:first-child)]:pl-4"
            >
              {crumbs.map((crumb, j) => (
                <React.Fragment key={`${j}-${crumb}`}>
                  {j > 0 && <ChevronRight className="h-3 w-3 text-gray-400" aria-hidden="true" />}
                  <span
                    className={
                      j === crumbs.length - 1 ? 'font-medium text-gray-900' : 'text-gray-500'
                    }
                  >
                    {crumb}
                  </span>
                </React.Fragment>
              ))}
            </li>
          ))}
        </ul>
      )}

      {/* Metadata */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          {/* Description */}
          <section
            className="rounded-lg border border-gray-200 bg-white p-4"
            aria-labelledby="doc-description"
          >
            <h2 id="doc-description" className="mb-2 text-sm font-semibold text-gray-900">
              Description
            </h2>
            {isEditing ? (
              <>
                <textarea
                  form="document-edit-form"
                  aria-label="Description"
                  value={editDescription}
                  maxLength={MAX_DESCRIPTION}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={4}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  placeholder="Add a description..."
                />
                {descriptionError && (
                  <p className="mt-1 text-sm text-red-600">{descriptionError}</p>
                )}
              </>
            ) : (
              <p className="whitespace-pre-wrap break-words text-sm text-gray-600">
                {doc.description || (
                  <span className="italic text-gray-400">No description provided.</span>
                )}
              </p>
            )}
          </section>

          {/* Tags */}
          <section
            className="rounded-lg border border-gray-200 bg-white p-4"
            aria-labelledby="doc-tags"
          >
            <h2 id="doc-tags" className="mb-2 text-sm font-semibold text-gray-900">
              Tags
            </h2>
            {isEditing ? (
              <Input
                id="edit-tags"
                form="document-edit-form"
                aria-label="Tags"
                value={editTags}
                onChange={(e) => setEditTags(e.target.value)}
                placeholder="Comma-separated tags"
                helperText={`Separate tags with commas (max ${MAX_TAGS})`}
                error={tagsError}
              />
            ) : doc.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {doc.tags.map((tag) => (
                  <Badge key={tag} label={tag} />
                ))}
              </div>
            ) : (
              <p className="text-sm italic text-gray-400">No tags.</p>
            )}
          </section>

          {/* Document preview */}
          <section
            className="rounded-lg border border-gray-200 bg-white p-4"
            aria-labelledby="doc-preview"
          >
            <h2 id="doc-preview" className="mb-2 text-sm font-semibold text-gray-900">
              Preview
            </h2>
            {isPdf ? (
              preview.url ? (
                <div className="overflow-hidden rounded border border-gray-200">
                  <iframe
                    src={preview.url}
                    className="h-[70vh] min-h-[400px] w-full"
                    title={`Preview of ${doc.title}`}
                  />
                </div>
              ) : preview.loading ? (
                <div
                  className="h-64 animate-pulse rounded bg-gray-100"
                  aria-label="Loading preview"
                />
              ) : (
                <div className="rounded border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                  <p className="mb-3">
                    Preview unavailable{preview.error ? `: ${preview.error}` : '.'}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" size="sm" onClick={preview.retry}>
                      <RefreshCw className="h-4 w-4" />
                      Retry
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={handleDownload}>
                      <Download className="h-4 w-4" />
                      Download instead
                    </Button>
                  </div>
                </div>
              )
            ) : (
              <div className="max-h-96 overflow-auto rounded border border-gray-200 bg-gray-50 p-4">
                <pre className="whitespace-pre-wrap break-words text-sm text-gray-800">
                  {doc.contentText || 'No text content available.'}
                </pre>
              </div>
            )}
          </section>
        </div>

        {/* Sidebar metadata */}
        <div className="space-y-4">
          <section
            className="rounded-lg border border-gray-200 bg-white p-4"
            aria-labelledby="doc-details"
          >
            <h2 id="doc-details" className="mb-3 text-sm font-semibold text-gray-900">
              Details
            </h2>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-gray-500">File type</dt>
                <dd className="font-medium uppercase text-gray-900">{doc.fileType}</dd>
              </div>
              <div>
                <dt className="text-gray-500">File size</dt>
                <dd className="font-medium text-gray-900">{formatFileSize(doc.fileSizeBytes)}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Original filename</dt>
                <dd className="break-all font-medium text-gray-900">{doc.originalFilename}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Uploaded</dt>
                <dd className="font-medium text-gray-900">
                  <time dateTime={toISODate(doc.uploadedAt)}>{formatDateTime(doc.uploadedAt)}</time>
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">Last updated</dt>
                <dd className="font-medium text-gray-900">
                  <time dateTime={toISODate(doc.updatedAt)}>{formatDateTime(doc.updatedAt)}</time>
                </dd>
              </div>
            </dl>
          </section>

          <section
            className="rounded-lg border border-gray-200 bg-white p-4"
            aria-labelledby="doc-jurisdictions"
          >
            <h2 id="doc-jurisdictions" className="mb-3 text-sm font-semibold text-gray-900">
              Jurisdictions
            </h2>
            {doc.jurisdictions.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {doc.jurisdictions.map((j) => (
                  <Badge key={j.id} label={j.name} level={j.level} />
                ))}
              </div>
            ) : (
              <p className="text-sm italic text-gray-400">No jurisdictions assigned.</p>
            )}
          </section>
        </div>
      </div>

      {/* Delete confirmation modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => !isDeleting && setShowDeleteModal(false)}
        title="Delete document"
      >
        <p className="mb-4 break-words text-sm text-gray-600">
          Are you sure you want to delete <strong>{doc.title}</strong>? This document will be moved
          to trash and permanently deleted after 30 days.
        </p>
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowDeleteModal(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={handleDelete} isLoading={isDeleting}>
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}

// Helper functions

function buildBreadcrumbs(doc: DocumentWithJurisdictions): string[][] {
  // One path per tagged jurisdiction, from Canada down (Canada › British Columbia › Squamish),
  // ordered from broadest to most local.
  const order: Record<string, number> = {
    federal: 0,
    provincial: 1,
    territorial: 1,
    regional: 2,
    municipal: 3,
    indigenous: 3,
  };
  return [...doc.jurisdictions]
    .sort((a, b) => (order[a.level] ?? 4) - (order[b.level] ?? 4) || a.name.localeCompare(b.name))
    .map((j) =>
      j.level === 'federal' ? ['Canada'] : ['Canada', ...(j.path ?? []).map((p) => p.name), j.name],
    );
}
