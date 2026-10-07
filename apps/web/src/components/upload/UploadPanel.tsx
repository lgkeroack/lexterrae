import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Upload,
  FileText,
  FileSpreadsheet,
  FileImage,
  File as FileIcon,
  X,
  AlertCircle,
  CheckCircle2,
  RotateCcw,
} from 'lucide-react';
import { useJurisdictionStore, MAX_JURISDICTION_SELECTIONS } from '../../stores/jurisdictionStore';
import { useUndoStore } from '../../stores/undoStore';
import { getAccessToken, refreshAccessToken } from '../../services/api';
import { formatFileSize } from '../../utils/format';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { JurisdictionMap } from '../map/JurisdictionMap';
import { JurisdictionSearch } from '../map/JurisdictionSearch';
import { LawSources } from './LawSources';
import { ProvinceDetail } from '../map/ProvinceDetail';
import { JurisdictionSummary } from '../map/JurisdictionSummary';
import {
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_MB,
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_TAGS_PER_DOCUMENT,
  MAX_TAG_LENGTH,
} from '@lexterrae/shared';

/**
 * File types accepted by the API (apps/api/src/services/file.service.ts ALLOWED_MIME_TYPES).
 * The server verifies the real type from the file's contents; the extension check here is
 * just for fast feedback, since browsers report inconsistent MIME types for csv/rtf/office files.
 */
const ACCEPTED_EXTENSIONS = [
  'pdf',
  'txt',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'csv',
  'rtf',
  'png',
  'jpg',
  'jpeg',
] as const;
const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(',');
const ACCEPTED_LABEL = 'PDF, Word, Excel, CSV, RTF, TXT, PNG or JPG';

type UploadStatus = 'idle' | 'uploading' | 'processing' | 'error' | 'success';

interface UploadedDocument {
  id: string;
  title: string;
}

function getExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : '';
}

function getFileIcon(name: string) {
  const ext = getExtension(name);
  if (ext === 'pdf')
    return <FileText className="h-8 w-8 flex-shrink-0 text-red-500" aria-hidden="true" />;
  if (['xls', 'xlsx', 'csv'].includes(ext))
    return <FileSpreadsheet className="h-8 w-8 flex-shrink-0 text-green-600" aria-hidden="true" />;
  if (['png', 'jpg', 'jpeg'].includes(ext))
    return <FileImage className="h-8 w-8 flex-shrink-0 text-purple-500" aria-hidden="true" />;
  if (['doc', 'docx', 'rtf'].includes(ext))
    return <FileText className="h-8 w-8 flex-shrink-0 text-blue-600" aria-hidden="true" />;
  return <FileIcon className="h-8 w-8 flex-shrink-0 text-gray-500" aria-hidden="true" />;
}

function validateFile(f: File): string | null {
  const ext = getExtension(f.name);
  if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(ext)) {
    return `"${f.name}" isn't a supported file type. Upload a ${ACCEPTED_LABEL} file.`;
  }
  if (f.size === 0) {
    return `"${f.name}" is empty. Choose a file with content.`;
  }
  if (f.size > MAX_FILE_SIZE_BYTES) {
    return `"${f.name}" is ${formatFileSize(f.size)}. The maximum size is ${MAX_FILE_SIZE_MB} MB.`;
  }
  return null;
}

function parseTags(input: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of input.split(',')) {
    const t = raw.trim();
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      tags.push(t);
    }
  }
  return tags;
}

/** Extracts a readable message from an RFC 7807 problem response body. */
function readProblem(xhr: XMLHttpRequest): string {
  try {
    const body = JSON.parse(xhr.responseText) as { detail?: string; title?: string };
    if (body.detail) return body.detail;
    if (body.title) return body.title;
  } catch {
    // not JSON
  }
  if (xhr.status === 413)
    return `The file is too large. The maximum size is ${MAX_FILE_SIZE_MB} MB.`;
  if (xhr.status === 401) return 'Your session has expired. Please sign in again.';
  if (xhr.status >= 500) return 'The server could not process the upload. Please try again.';
  return `Upload failed (HTTP ${xhr.status}).`;
}

class UploadAbortedError extends Error {}

export function UploadPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const submittingRef = useRef(false);
  const dragDepth = useRef(0);
  const successHeadingRef = useRef<HTMLHeadingElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [autoTitle, setAutoTitle] = useState<string | null>(null);
  const [titleTouched, setTitleTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<UploadedDocument | null>(null);

  const {
    selections,
    activeProvince,
    isLoadingProvinces,
    provincesError,
    hasLoadedProvinces,
    fetchProvinces,
    getSelectionIds,
    setActiveProvince,
    reset: resetJurisdictions,
  } = useJurisdictionStore();

  // The province being browsed lives in the URL (?province=QC), so the browser's Back button
  // (or a phone's back gesture) returns to the map of Canada instead of leaving the page.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlProvince = searchParams.get('province');
  useEffect(() => {
    if (urlProvince !== activeProvince) setActiveProvince(urlProvince);
    // Only follow URL changes here; the effect below mirrors store changes into the URL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlProvince]);
  const syncedOnce = useRef(false);
  useEffect(() => {
    // The first render reflects the URL, not a user action: nothing to write back
    if (!syncedOnce.current) {
      syncedOnce.current = true;
      return;
    }
    if (activeProvince === urlProvince) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (activeProvince) next.set('province', activeProvince);
        else next.delete('province');
        return next;
      },
      // Opening a province adds a history entry; closing one goes back over it
      { replace: !activeProvince },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProvince]);

  const isBusy = status === 'uploading' || status === 'processing';

  // Load the authoritative jurisdiction list (codes -> UUIDs) from the API.
  useEffect(() => {
    void fetchProvinces();
  }, [fetchProvinces]);

  // Start each visit with a clean jurisdiction picker, and abort any in-flight upload on unmount.
  useEffect(() => {
    resetJurisdictions();
    // …but keep a province opened from the URL (reload, or browser Forward)
    const province = new URLSearchParams(window.location.search).get('province');
    if (province) setActiveProvince(province);
    return () => {
      xhrRef.current?.abort();
      resetJurisdictions();
    };
  }, [resetJurisdictions, setActiveProvince]);

  // A file dropped just outside the drop zone would otherwise make the browser navigate
  // away to the file and lose the form.
  useEffect(() => {
    const prevent = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  useEffect(() => {
    if (status === 'success') successHeadingRef.current?.focus();
  }, [status]);

  // ── Validation ────────────────────────────────────────────────────

  const tags = useMemo(() => parseTags(tagsInput), [tagsInput]);

  const titleError = !title.trim()
    ? 'Title is required.'
    : title.trim().length > MAX_TITLE_LENGTH
      ? `Title must be ${MAX_TITLE_LENGTH} characters or fewer.`
      : null;

  const tagsError =
    tags.length > MAX_TAGS_PER_DOCUMENT
      ? `Use at most ${MAX_TAGS_PER_DOCUMENT} tags (you have ${tags.length}).`
      : tags.some((t) => t.length > MAX_TAG_LENGTH)
        ? `Each tag must be ${MAX_TAG_LENGTH} characters or fewer.`
        : null;

  const descriptionError =
    description.length > MAX_DESCRIPTION_LENGTH
      ? `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`
      : null;

  const missing: string[] = [];
  if (!file) missing.push('choose a file');
  if (titleError) missing.push(title.trim() ? 'shorten the title' : 'enter a title');
  if (descriptionError) missing.push('shorten the description');
  if (tagsError) missing.push('fix the tags');
  if (selections.length === 0) missing.push('select at least one jurisdiction');
  else if (selections.length > MAX_JURISDICTION_SELECTIONS)
    missing.push(`select at most ${MAX_JURISDICTION_SELECTIONS} jurisdictions`);
  else if (!hasLoadedProvinces) missing.push('wait for jurisdictions to load');

  const canSubmit = missing.length === 0 && !isBusy;

  // ── File selection ────────────────────────────────────────────────

  const handleFileSelect = useCallback(
    (f: File) => {
      setUploadError(null);
      if (status === 'error') setStatus('idle');
      const error = validateFile(f);
      if (error) {
        setFileError(error);
        return;
      }
      setFileError(null);
      setFile(f);
      // Auto-fill the title from the filename unless the user has typed their own.
      const nameWithoutExt = f.name.replace(/\.[^/.]+$/, '').slice(0, MAX_TITLE_LENGTH);
      if (!title.trim() || title === autoTitle) {
        setTitle(nameWithoutExt);
        setAutoTitle(nameWithoutExt);
      }
    },
    [title, autoTitle, status],
  );

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      if (files.length > 1) {
        setFileError(`You dropped ${files.length} files. Upload one file at a time.`);
        return;
      }
      handleFileSelect(files[0]!);
    },
    [handleFileSelect],
  );

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (isBusy || !e.dataTransfer.types.includes('Files')) return;
      dragDepth.current += 1;
      setIsDragOver(true);
    },
    [isBusy],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = isBusy ? 'none' : 'copy';
    },
    [isBusy],
  );

  // Counting enter/leave avoids flicker when the pointer moves over child elements.
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setIsDragOver(false);
      if (isBusy) return;
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles, isBusy],
  );

  const openFilePicker = useCallback(() => {
    if (!isBusy) fileInputRef.current?.click();
  }, [isBusy]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(e.target.files);
      // Reset so choosing the same file again still fires onChange
      e.target.value = '';
    },
    [handleFiles],
  );

  const removeFile = useCallback(() => {
    setFile(null);
    setFileError(null);
    if (title === autoTitle) {
      setTitle('');
      setAutoTitle(null);
    }
  }, [title, autoTitle]);

  // ── Upload ────────────────────────────────────────────────────────

  const sendUpload = (formData: FormData, token: string | null): Promise<XMLHttpRequest> =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) setProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
      });
      // Bytes are sent; the server still has to scan, store and index the file.
      xhr.upload.addEventListener('load', () => {
        setProgress(100);
        setStatus('processing');
      });
      xhr.addEventListener('load', () => resolve(xhr));
      xhr.addEventListener('error', () =>
        reject(
          new Error(
            'Network error: the upload could not reach the server. Check your connection and try again.',
          ),
        ),
      );
      xhr.addEventListener('abort', () => reject(new UploadAbortedError('Upload cancelled.')));
      xhr.open('POST', '/api/documents');
      xhr.withCredentials = true;
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.send(formData);
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current || !canSubmit || !file) return;

    const { ids, missing: unresolved } = getSelectionIds();
    if (unresolved.length > 0 || ids.length === 0) {
      setUploadError(
        `These jurisdictions aren't recognised by the server: ${unresolved.map((s) => s.name).join(', ')}. Remove them and try again.`,
      );
      setStatus('error');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', title.trim());
    if (description.trim()) formData.append('description', description.trim());
    // The API collects repeated `name[]` fields into arrays, matching its zod schema.
    tags.forEach((t) => formData.append('tags[]', t));
    ids.forEach((id) => formData.append('jurisdictionIds[]', id));

    submittingRef.current = true;
    setStatus('uploading');
    setProgress(0);
    setUploadError(null);

    try {
      let xhr = await sendUpload(formData, getAccessToken() ?? localStorage.getItem('accessToken'));
      if (xhr.status === 401) {
        // Access token expired mid-session: refresh once and retry.
        const fresh = await refreshAccessToken().catch(() => null);
        if (fresh) {
          setStatus('uploading');
          setProgress(0);
          xhr = await sendUpload(formData, fresh);
        }
      }
      if (xhr.status < 200 || xhr.status >= 300) throw new Error(readProblem(xhr));

      let doc: UploadedDocument = { id: '', title: title.trim() };
      try {
        const body = JSON.parse(xhr.responseText) as {
          data?: UploadedDocument;
        } & Partial<UploadedDocument>;
        const d = body.data ?? body;
        if (d.id) doc = { id: d.id, title: d.title || doc.title };
      } catch {
        // Response without a body; still a success
      }

      setUploaded(doc);
      // The picks were submitted with the document; undoing one now would only confuse
      useUndoStore.getState().dismiss();
      setStatus('success');
      setFile(null);
      setTitle('');
      setAutoTitle(null);
      setTitleTouched(false);
      setDescription('');
      setTagsInput('');
      resetJurisdictions();
    } catch (err) {
      if (err instanceof UploadAbortedError) {
        setStatus('idle');
        setProgress(0);
        setUploadError('Upload cancelled. Your file and details are still here.');
      } else {
        setStatus('error');
        setUploadError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
      }
    } finally {
      submittingRef.current = false;
      xhrRef.current = null;
    }
  };

  const cancelUpload = () => xhrRef.current?.abort();

  const startOver = () => {
    setUploaded(null);
    setStatus('idle');
    setProgress(0);
    setUploadError(null);
  };

  // ── Render ────────────────────────────────────────────────────────

  if (status === 'success' && uploaded) {
    return (
      <div className="mx-auto max-w-2xl text-center">
        <div className="rounded-lg border border-green-200 bg-green-50 p-6 sm:p-8" role="status">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
            <CheckCircle2 className="h-6 w-6 text-green-600" aria-hidden="true" />
          </div>
          <h2
            ref={successHeadingRef}
            tabIndex={-1}
            className="mb-2 text-lg font-semibold text-green-900 focus:outline-none"
          >
            Upload successful
          </h2>
          <p className="mb-6 break-words text-sm text-green-800">
            <span className="font-medium">{uploaded.title}</span> has been uploaded and tagged.
          </p>
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            {uploaded.id && (
              <Link
                to={`/documents/${uploaded.id}`}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dark focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
              >
                View document
              </Link>
            )}
            <Button type="button" variant="secondary" onClick={startOver}>
              Upload another document
            </Button>
            <Link
              to="/documents"
              className="inline-flex items-center justify-center px-4 py-2 text-sm underline underline-offset-4 hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Back to documents
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const showTitleError = titleTouched && !!titleError;

  return (
    <form onSubmit={handleSubmit} noValidate className="mx-auto max-w-3xl space-y-6">
      <LawSources />

      {/* 1. File */}
      <section className="space-y-3" aria-labelledby="upload-file-heading">
        <h2 id="upload-file-heading" className="text-sm font-semibold text-gray-900">
          1. Choose a file
        </h2>

        <input
          ref={fileInputRef}
          id="upload-file-input"
          type="file"
          accept={ACCEPT_ATTR}
          onChange={handleInputChange}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
        />

        {file ? (
          <div className="flex items-center gap-3 rounded-lg border border-green-300 bg-green-50 p-4">
            {getFileIcon(file.name)}
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-gray-900" title={file.name}>
                {file.name}
              </p>
              <p className="text-sm text-gray-500">
                {formatFileSize(file.size)} &middot; {getExtension(file.name).toUpperCase()}
              </p>
            </div>
            <button
              type="button"
              onClick={openFilePicker}
              disabled={isBusy}
              className="rounded-md px-2 py-1 text-sm font-medium text-blue-700 hover:bg-accent-100 focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              Change
            </button>
            <button
              type="button"
              onClick={removeFile}
              disabled={isBusy}
              aria-label={`Remove ${file.name}`}
              className="rounded-md p-1 text-gray-500 hover:bg-gray-200 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <div
            role="button"
            tabIndex={0}
            aria-describedby="upload-dropzone-hint"
            onClick={openFilePicker}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openFilePicker();
              }
            }}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 sm:p-8 ${
              isDragOver
                ? 'border-accent bg-accent-50'
                : fileError
                  ? 'border-red-300 bg-red-50/40 hover:bg-red-50'
                  : 'border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100'
            }`}
          >
            <Upload
              className={`mx-auto mb-3 h-10 w-10 ${isDragOver ? 'text-blue-500' : 'text-gray-400'}`}
              aria-hidden="true"
            />
            <p className="mb-1 text-sm font-medium text-gray-700">
              {isDragOver ? (
                'Drop to add this file'
              ) : (
                <>
                  Drag and drop a file here, or{' '}
                  <span className="text-blue-600 underline">browse</span>
                </>
              )}
            </p>
            <p id="upload-dropzone-hint" className="text-xs text-gray-500">
              {ACCEPTED_LABEL} &middot; one file, up to {MAX_FILE_SIZE_MB} MB
            </p>
          </div>
        )}

        {fileError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" aria-hidden="true" />
            <p className="text-sm text-red-700">{fileError}</p>
          </div>
        )}
      </section>

      {/* 2. Metadata */}
      <section
        className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 sm:p-6"
        aria-labelledby="upload-details-heading"
      >
        <h2 id="upload-details-heading" className="text-sm font-semibold text-gray-900">
          2. Document details
        </h2>

        <Input
          id="upload-title"
          label="Title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setAutoTitle(null);
          }}
          onBlur={() => setTitleTouched(true)}
          placeholder="e.g. Residential Tenancy Act summary"
          maxLength={MAX_TITLE_LENGTH}
          required
          aria-required="true"
          disabled={isBusy}
          error={showTitleError ? (titleError ?? undefined) : undefined}
          helperText={
            file && autoTitle === title
              ? 'Filled in from the file name. Edit as needed.'
              : undefined
          }
        />

        <div>
          <label
            htmlFor="upload-description"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            Description <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <textarea
            id="upload-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this document and who is it for?"
            maxLength={MAX_DESCRIPTION_LENGTH}
            rows={3}
            disabled={isBusy}
            aria-describedby="upload-description-count"
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:bg-gray-50"
          />
          <p id="upload-description-count" className="mt-1 text-right text-xs text-gray-400">
            {description.length}/{MAX_DESCRIPTION_LENGTH}
          </p>
        </div>

        <Input
          id="upload-tags"
          label="Tags (optional)"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          placeholder="e.g. contract, lease, employment"
          disabled={isBusy}
          error={tagsError ?? undefined}
          helperText={
            tags.length > 0
              ? `${tags.length} tag${tags.length === 1 ? '' : 's'}: ${tags.join(' · ')}`
              : 'Separate tags with commas.'
          }
        />
      </section>

      {/* 3. Jurisdictions */}
      <section
        className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 sm:p-6"
        aria-labelledby="upload-jurisdictions-heading"
        aria-busy={isLoadingProvinces}
      >
        <div>
          <h2 id="upload-jurisdictions-heading" className="text-sm font-semibold text-gray-900">
            3. Jurisdictions *
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            Tag where this document applies (up to {MAX_JURISDICTION_SELECTIONS}): federal,
            provinces and territories, regions, municipalities or Indigenous lands. Search by name,
            browse a province, or add one that isn&apos;t listed. Tag the jurisdiction the document
            belongs to: it then applies to cases there and everywhere inside it (a British Columbia
            statute applies in Squamish; a Squamish by-law does not apply elsewhere in British
            Columbia).
          </p>
        </div>

        {provincesError && (
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <p className="text-sm text-amber-800">
              Couldn&apos;t load jurisdictions from the server ({provincesError}). You can browse
              the map, but uploading needs this list.
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void fetchProvinces(true)}
              isLoading={isLoadingProvinces}
            >
              Retry
            </Button>
          </div>
        )}

        <fieldset disabled={isBusy} className="min-w-0 space-y-4">
          <legend className="sr-only">Jurisdiction selection</legend>
          <JurisdictionSearch />
          {activeProvince ? <ProvinceDetail /> : <JurisdictionMap />}
          <JurisdictionSummary />
        </fieldset>
      </section>

      {/* Upload error */}
      {uploadError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" aria-hidden="true" />
          <p className="text-sm text-red-700">{uploadError}</p>
        </div>
      )}

      {/* Upload progress */}
      {isBusy && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-700" id="upload-progress-label">
              {status === 'processing' ? 'Processing on server…' : `Uploading ${file?.name ?? ''}…`}
            </span>
            <span className="font-medium text-blue-600">{progress}%</span>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-gray-200"
            role="progressbar"
            aria-labelledby="upload-progress-label"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <div
              className={`h-full rounded-full bg-accent transition-all duration-300 ${status === 'processing' ? 'animate-pulse' : ''}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Submit */}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
        {!isBusy && missing.length > 0 && (
          <p
            className="text-sm text-gray-500 sm:mr-auto"
            aria-live="polite"
            id="upload-requirements"
          >
            To upload, {missing.join(', ')}.
          </p>
        )}
        {isBusy && (
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={cancelUpload}
            disabled={status === 'processing'}
          >
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          size="lg"
          isLoading={isBusy}
          disabled={!canSubmit}
          aria-describedby={missing.length > 0 ? 'upload-requirements' : undefined}
        >
          {!isBusy &&
            (status === 'error' ? (
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Upload className="h-4 w-4" aria-hidden="true" />
            ))}
          {isBusy ? 'Uploading…' : status === 'error' ? 'Retry upload' : 'Upload document'}
        </Button>
      </div>
    </form>
  );
}
