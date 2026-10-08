import React, { useEffect, useId, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
} from 'lucide-react';
import {
  JURISDICTION_LEVEL_LABELS,
  LARGEST_ASSISTANTS_TOKENS,
  MOST_ASSISTANTS_TOKENS,
  SPLIT_PART_TOKENS,
  estimateDocumentTokens,
  estimatePackageTokens,
  formatTokens,
  packageFit,
  type PackageContentsDocument,
  type PackageContentsResponse,
  type PackageFit,
  type PackagePlanResponse,
} from '@lexterrae/shared';
import { api, getErrorMessage } from '../../services/api';
import { useDebounce } from '../../hooks/useDebounce';
import { LoadingSpinner } from '../common/LoadingSpinner';

const FIT_MESSAGES: Record<PackageFit, string> = {
  all: 'Small enough for Claude, ChatGPT or Gemini to read in full.',
  largest:
    'Too large for most assistants to read in full (they read roughly 100,000–200,000 tokens); Gemini can (about 1 million). Others will search the file and may miss passages: choose fewer documents or split it into smaller files below.',
  none: 'Too large for any assistant to read in full: it would search the file and may miss passages. Choose fewer documents or split it into smaller files below.',
};

type DownloadState =
  | { state: 'idle' }
  | { state: 'working' }
  | { state: 'done'; filename: string }
  | { state: 'error'; message: string };

/**
 * The AI reference package: one file with the documents that apply in a place, built from the
 * backend's current contents, to upload to Claude, ChatGPT or any other assistant. Shows its
 * estimated size before download and lets people choose which documents to include.
 */
export function AiPackagePanel({ placeId, placeName }: { placeId: string; placeName: string }) {
  const [contents, setContents] = useState<PackageContentsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [download, setDownload] = useState<DownloadState>({ state: 'idle' });

  useEffect(() => {
    const controller = new AbortController();
    setContents(null);
    setLoadError(null);
    setDownload({ state: 'idle' });
    api
      .getPackageContents(placeId, controller.signal)
      .then((data) => {
        setContents(data);
        setSelected(new Set(data.documents.map((d) => d.id)));
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setLoadError(getErrorMessage(err, 'Could not size the AI package.'));
        }
      });
    return () => controller.abort();
  }, [placeId]);

  const documents = useMemo(() => contents?.documents ?? [], [contents]);
  const chosen = documents.filter((d) => selected.has(d.id));
  const tokens = estimatePackageTokens(chosen);
  const fit = packageFit(tokens);
  const isNarrowed = chosen.length < documents.length;

  const save = async () => {
    setDownload({ state: 'working' });
    try {
      const filename = await api.downloadLibraryPackage({
        jurisdictionId: placeId,
        ...(isNarrowed ? { documentIds: chosen.map((d) => d.id) } : {}),
      });
      setDownload({ state: 'done', filename });
    } catch (err) {
      setDownload({
        state: 'error',
        message: getErrorMessage(err, 'Could not build the package.'),
      });
    }
  };

  return (
    <div className="mt-5 border-2 border-accent p-4">
      <h2 className="flex items-center gap-2 text-lg">
        <Bot className="h-5 w-5" aria-hidden="true" />
        Ask an AI about {placeName}
      </h2>

      {loadError && (
        <p role="alert" className="mt-3 text-sm font-bold italic">
          {loadError}
        </p>
      )}
      {!contents && !loadError && (
        <div className="mt-3">
          <LoadingSpinner size="sm" label="Sizing the package" />
        </div>
      )}

      {contents && documents.length === 0 && (
        <p className="mt-3 text-sm italic">Nothing applies here yet.</p>
      )}

      {contents && documents.length > 0 && (
        <>
          <div className="mt-3 text-sm" aria-live="polite">
            <p>
              <strong>
                {isNarrowed
                  ? `${chosen.length} of ${documents.length} documents`
                  : `All ${documents.length} document${documents.length === 1 ? '' : 's'}`}
              </strong>{' '}
              · {formatTokens(tokens)}
            </p>
            <p className="mt-1 flex items-start gap-1.5">
              {fit === 'all' ? (
                <CheckCircle2
                  className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent"
                  aria-hidden="true"
                />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
              )}
              <span>{chosen.length ? FIT_MESSAGES[fit] : 'Choose at least one document.'}</span>
            </p>
          </div>

          <button
            type="button"
            onClick={() => setIsCustomizing((v) => !v)}
            aria-expanded={isCustomizing}
            className="mt-3 inline-flex items-center gap-1 text-sm underline underline-offset-4 hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {isCustomizing ? (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            )}
            Choose which documents to include
          </button>

          {isCustomizing && (
            <PackageChooser contents={contents} selected={selected} onChange={setSelected} />
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={download.state === 'working' || chosen.length === 0}
              className="inline-flex items-center gap-2 border border-accent bg-accent px-4 py-2 text-sm text-white hover:border-accent-dark hover:bg-accent-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:border-gray-300 disabled:bg-gray-300"
            >
              {download.state === 'working' ? (
                <LoadingSpinner size="sm" label="Building the package" />
              ) : (
                <Download className="h-4 w-4" aria-hidden="true" />
              )}
              {download.state === 'working' ? 'Building…' : 'Download AI reference package'}
            </button>
            <span className="text-sm text-gray-600" aria-live="polite">
              {download.state === 'done'
                ? `Saved ${download.filename}.`
                : download.state === 'error'
                  ? download.message
                  : null}
            </span>
          </div>

          {chosen.length > 0 && fit !== 'all' && (
            <SplitOffer
              placeId={placeId}
              documentIds={isNarrowed ? chosen.map((d) => d.id) : undefined}
              totalTokens={tokens}
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── Splitting a large package ────────────────────────────────────────────────

const SPLIT_MIN_TOKENS = 20_000;
const SPLIT_STEP = 10_000;

/**
 * For packages too large to read in full: split into smaller files, with a slider for the size of
 * each (smaller files, more of them), downloaded together as one .zip.
 */
function SplitOffer({
  placeId,
  documentIds,
  totalTokens,
}: {
  placeId: string;
  documentIds: string[] | undefined;
  totalTokens: number;
}) {
  const sliderId = useId();
  const max = Math.max(
    SPLIT_MIN_TOKENS,
    Math.min(LARGEST_ASSISTANTS_TOKENS, Math.ceil(totalTokens / SPLIT_STEP) * SPLIT_STEP),
  );
  const [size, setSize] = useState(Math.min(SPLIT_PART_TOKENS, max));
  const debouncedSize = useDebounce(size, 300);
  const [plan, setPlan] = useState<PackagePlanResponse | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [download, setDownload] = useState<DownloadState>({ state: 'idle' });
  const idsKey = documentIds?.join(',') ?? '';

  useEffect(() => {
    if (size > max) setSize(max);
  }, [size, max]);

  useEffect(() => {
    const controller = new AbortController();
    setPlanError(null);
    setDownload({ state: 'idle' });
    api
      .planLibraryPackage(
        {
          jurisdictionId: placeId,
          ...(idsKey ? { documentIds: idsKey.split(',') } : {}),
          maxTokens: debouncedSize,
        },
        controller.signal,
      )
      .then(setPlan)
      .catch((err: unknown) => {
        if (!controller.signal.aborted)
          setPlanError(getErrorMessage(err, 'Could not plan the files.'));
      });
    return () => controller.abort();
  }, [placeId, idsKey, debouncedSize]);

  const count = plan?.parts.length ?? 0;
  const isStale = debouncedSize !== size || !plan;

  const save = async () => {
    setDownload({ state: 'working' });
    try {
      const filename = await api.downloadLibraryPackage({
        jurisdictionId: placeId,
        ...(idsKey ? { documentIds: idsKey.split(',') } : {}),
        split: { maxTokens: debouncedSize },
      });
      setDownload({ state: 'done', filename });
    } catch (err) {
      setDownload({ state: 'error', message: getErrorMessage(err, 'Could not build the files.') });
    }
  };

  return (
    <div className="mt-4 border-t border-gray-300 pt-4 text-sm">
      <h3 className="text-base">Split it into smaller files</h3>
      <p className="mt-1 text-gray-600">
        Smaller files can each be read in full. Upload them together in a Claude Project or a
        ChatGPT project, or one per chat; each file says which part holds what.
      </p>

      <label htmlFor={sliderId} className="mt-3 block">
        Size of each file: <strong>{formatTokens(size)}</strong>
      </label>
      <input
        id={sliderId}
        type="range"
        min={SPLIT_MIN_TOKENS}
        max={max}
        step={SPLIT_STEP}
        value={size}
        onChange={(e) => setSize(Number(e.target.value))}
        aria-valuetext={formatTokens(size)}
        className="mt-1 w-full max-w-md accent-accent"
      />
      <div className="flex max-w-md justify-between text-xs text-gray-600">
        <span>Smaller files, more of them</span>
        <span>Larger files, fewer of them</span>
      </div>

      <p className="mt-2" aria-live="polite">
        {planError ??
          (isStale ? (
            'Working out the files…'
          ) : (
            <>
              <strong>
                {count} file{count === 1 ? '' : 's'}
              </strong>
              {count > 1 &&
                ` of up to ${formatTokens(Math.max(...plan!.parts.map((p) => p.tokens)))}`}
              {size > MOST_ASSISTANTS_TOKENS &&
                ' · larger than most assistants read in full (about 100,000 tokens)'}
            </>
          ))}
      </p>
      {!isStale && count > 1 && (
        <ol className="mt-1 list-inside list-decimal text-gray-600">
          {plan!.parts.map((part, i) => (
            <li key={i}>
              {part.holds.map((h) => h.label).join(', ')} · {formatTokens(part.tokens)}
            </li>
          ))}
        </ol>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={download.state === 'working' || isStale || count === 0}
          className="inline-flex items-center gap-2 border border-accent px-4 py-2 text-accent hover:bg-accent hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:border-gray-300 disabled:text-gray-400 disabled:hover:bg-white"
        >
          {download.state === 'working' ? (
            <LoadingSpinner size="sm" label="Building the files" />
          ) : (
            <Download className="h-4 w-4" aria-hidden="true" />
          )}
          {download.state === 'working'
            ? 'Building…'
            : count > 1
              ? `Download all ${count} files (.zip)`
              : 'Download as one file (.zip)'}
        </button>
        <span className="text-gray-600" aria-live="polite">
          {download.state === 'done'
            ? `Saved ${download.filename}. Unzip it, then upload the files.`
            : download.state === 'error'
              ? download.message
              : null}
        </span>
      </div>
    </div>
  );
}

// ─── Choosing documents ───────────────────────────────────────────────────────

interface ChooserProps {
  contents: PackageContentsResponse;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}

/** A checkbox per document, grouped under the jurisdiction it applies through. */
function PackageChooser({ contents, selected, onChange }: ChooserProps) {
  const bySource = useMemo(() => {
    const groups = new Map<string, PackageContentsDocument[]>();
    for (const doc of contents.documents) {
      groups.set(doc.sourceId, [...(groups.get(doc.sourceId) ?? []), doc]);
    }
    return contents.sources
      .map((source) => ({ source, docs: groups.get(source.id) ?? [] }))
      .filter((g) => g.docs.length > 0);
  }, [contents]);

  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onChange(next);
  };

  return (
    <fieldset className="mt-3 border-t border-gray-300 pt-3 text-sm">
      <legend className="sr-only">Documents to include</legend>
      <div className="flex gap-4">
        <button
          type="button"
          onClick={() => onChange(new Set(contents.documents.map((d) => d.id)))}
          className="underline underline-offset-4 hover:no-underline"
        >
          Include everything
        </button>
        <button
          type="button"
          onClick={() => onChange(new Set())}
          className="underline underline-offset-4 hover:no-underline"
        >
          Clear
        </button>
      </div>
      {bySource.map(({ source, docs }) => (
        <div key={source.id} className="mt-3">
          <p className="text-xs uppercase tracking-wider text-gray-600">
            {source.name} · {JURISDICTION_LEVEL_LABELS[source.level]}
          </p>
          <ul className="mt-1 space-y-1">
            {docs.map((doc) => (
              <li key={doc.id}>
                <Checkbox checked={selected.has(doc.id)} onChange={(on) => toggle(doc.id, on)}>
                  {doc.title}{' '}
                  <span className="text-gray-600">
                    (
                    {doc.textStatus === 'ready'
                      ? formatTokens(estimateDocumentTokens(doc.textChars))
                      : doc.textStatus === 'pending'
                        ? 'text still being read'
                        : 'no readable text'}
                    )
                  </span>
                </Checkbox>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </fieldset>
  );
}

function Checkbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 flex-shrink-0"
      />
      <span>{children}</span>
    </label>
  );
}
