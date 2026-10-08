import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
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
  estimateDocumentTokens,
  estimatePackageTokens,
  formatTokens,
  packageFit,
  type PackageContentsDocument,
  type PackageContentsResponse,
  type PackageFit,
} from '@lexterrae/shared';
import { api, getErrorMessage } from '../../services/api';
import { LoadingSpinner } from '../common/LoadingSpinner';

const FIT_MESSAGES: Record<PackageFit, string> = {
  all: 'Small enough for Claude, ChatGPT or Gemini to read in full.',
  largest:
    'Too large for most assistants to read in full (they read roughly 100,000–200,000 tokens); Gemini can (about 1 million). Others will search the file and may miss passages, so narrow it down for dependable answers.',
  none: 'Too large for any assistant to read in full: it would search the file and may miss passages. Narrow it down below for dependable answers.',
};

type DownloadState =
  | { state: 'idle' }
  | { state: 'working' }
  | { state: 'done'; filename: string }
  | { state: 'error'; message: string };

/**
 * The AI reference package: one file with the documents that apply in a place, built from the
 * backend's current contents, to upload to Claude, ChatGPT or any other assistant. Shows its
 * estimated size before download and lets people narrow it by jurisdiction, topic or document.
 */
export function AiPackagePanel({ placeId, placeName }: { placeId: string; placeName: string }) {
  const [contents, setContents] = useState<PackageContentsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [download, setDownload] = useState<DownloadState>({ state: 'idle' });
  /** The topic the selection was narrowed to (described to the assistant). */
  const [topic, setTopic] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setContents(null);
    setLoadError(null);
    setDownload({ state: 'idle' });
    setTopic(null);
    api
      .getPackageContents(placeId, undefined, controller.signal)
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
        ...(isNarrowed && topic ? { topic } : {}),
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
      <p className="mt-1 text-sm">
        Download one file holding the documents that apply here, then upload it to Claude, ChatGPT
        or another AI assistant. It tells the assistant to answer only from these documents and to
        cite them, and it will begin by asking how it can help regarding {placeName}.
      </p>

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
            Choose what to include
          </button>

          {isCustomizing && (
            <PackageChooser
              contents={contents}
              selected={selected}
              onChange={setSelected}
              topic={topic}
              onTopicChange={setTopic}
            />
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
                  : 'Markdown file (.md), made from the current documents.'}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Narrowing the package ────────────────────────────────────────────────────

interface ChooserProps {
  contents: PackageContentsResponse;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  topic: string | null;
  onTopicChange: (topic: string | null) => void;
}

function PackageChooser({ contents, selected, onChange, topic, onTopicChange }: ChooserProps) {
  const topicId = useId();
  const [topicInput, setTopicInput] = useState(topic ?? '');
  const [topicStatus, setTopicStatus] = useState<string | null>(null);
  const [isFiltering, setIsFiltering] = useState(false);

  const bySource = useMemo(() => {
    const groups = new Map<string, PackageContentsDocument[]>();
    for (const doc of contents.documents) {
      groups.set(doc.sourceId, [...(groups.get(doc.sourceId) ?? []), doc]);
    }
    return contents.sources
      .map((source) => ({ source, docs: groups.get(source.id) ?? [] }))
      .filter((g) => g.docs.length > 0);
  }, [contents]);

  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(selected);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onChange(next);
  };

  const applyTopic = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = topicInput.trim();
    if (q.length < 2) return;
    setIsFiltering(true);
    setTopicStatus(null);
    try {
      const matches = await api.getPackageContents(contents.place.id, q);
      const ids = new Set(matches.documents.map((d) => d.id));
      onChange(new Set([...selected].filter((id) => ids.has(id))));
      onTopicChange(q);
      setTopicStatus(
        ids.size === 0
          ? `No documents mention “${q}”.`
          : `${ids.size} document${ids.size === 1 ? '' : 's'} mention “${q}”; the others are now left out.`,
      );
    } catch (err) {
      setTopicStatus(getErrorMessage(err, 'Could not filter by topic.'));
    } finally {
      setIsFiltering(false);
    }
  };

  const reset = () => {
    onChange(new Set(contents.documents.map((d) => d.id)));
    onTopicChange(null);
    setTopicInput('');
    setTopicStatus(null);
  };

  return (
    <div className="mt-3 space-y-5 border-t border-gray-300 pt-4 text-sm">
      <fieldset>
        <legend className="font-bold">Jurisdictions</legend>
        <ul className="mt-2 space-y-1">
          {bySource.map(({ source, docs }) => {
            const ids = docs.map((d) => d.id);
            const count = ids.filter((id) => selected.has(id)).length;
            return (
              <li key={source.id}>
                <Checkbox
                  checked={count === ids.length}
                  indeterminate={count > 0 && count < ids.length}
                  onChange={(on) => toggle(ids, on)}
                >
                  {source.name}{' '}
                  <span className="text-gray-600">
                    ({JURISDICTION_LEVEL_LABELS[source.level]} · {docs.length} document
                    {docs.length === 1 ? '' : 's'} ·{' '}
                    {formatTokens(
                      docs.reduce((n, d) => n + estimateDocumentTokens(d.textChars), 0),
                    )}
                    )
                  </span>
                </Checkbox>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <form onSubmit={(e) => void applyTopic(e)}>
        <label htmlFor={topicId} className="font-bold">
          Topic
        </label>
        <p className="text-gray-600">Keep only the documents that mention a word or phrase.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            id={topicId}
            type="search"
            value={topicInput}
            onChange={(e) => setTopicInput(e.target.value)}
            placeholder="e.g. noise, zoning, parking"
            className="min-w-0 flex-1 border border-gray-500 px-3 py-1.5 placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <button
            type="submit"
            disabled={isFiltering || topicInput.trim().length < 2}
            className="border border-black px-3 py-1.5 hover:bg-accent hover:text-white disabled:border-gray-300 disabled:text-gray-400 disabled:hover:bg-white"
          >
            {isFiltering ? 'Filtering…' : 'Keep matching'}
          </button>
        </div>
        {topicStatus && (
          <p className="mt-1 text-gray-600" aria-live="polite">
            {topicStatus}
          </p>
        )}
      </form>

      <fieldset>
        <legend className="font-bold">Documents</legend>
        <div className="mt-1 flex gap-4">
          <button
            type="button"
            onClick={reset}
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
            <p className="text-xs uppercase tracking-wider text-gray-600">{source.name}</p>
            <ul className="mt-1 space-y-1">
              {docs.map((doc) => (
                <li key={doc.id}>
                  <Checkbox checked={selected.has(doc.id)} onChange={(on) => toggle([doc.id], on)}>
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
    </div>
  );
}

function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  children,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 flex-shrink-0"
      />
      <span>{children}</span>
    </label>
  );
}
