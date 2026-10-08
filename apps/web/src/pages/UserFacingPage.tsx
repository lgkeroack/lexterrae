import React, { useEffect, useId, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, LocateFixed, MapPin, Search, X } from 'lucide-react';
import {
  JURISDICTION_LEVEL_LABELS,
  type JurisdictionSearchResult,
  type LibraryDocument,
  type LibraryResponse,
} from '@lexterrae/shared';
import { api, getErrorMessage } from '../services/api';
import { codesAt } from '../data/locate';
import { useAccessStore } from '../stores/accessStore';
import { useAuthStore } from '../stores/authStore';
import { describePath } from '../stores/jurisdictionStore';
import { useDebounce } from '../hooks/useDebounce';
import { AiPackagePanel } from '../components/library/AiPackagePanel';
import { SiteHeader } from '../components/layout/SiteHeader';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { useDocumentTitle } from '../components/common/useDocumentTitle';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 50;

/**
 * User facing: choose where you are (search, or ask the browser) and see every document that
 * applies there, that is, the place's own documents and those of every jurisdiction containing it.
 * The chosen place is kept in the URL (?place=), so Back returns to the previous choice.
 */
export function UserFacingPage() {
  useDocumentTitle('User facing');
  const { role, status, load } = useAccessStore();
  const isSignedIn = useAuthStore((s) => s.status === 'authenticated');
  useEffect(() => {
    if (isSignedIn && status === 'idle') void load();
  }, [isSignedIn, status, load]);

  const [params, setParams] = useSearchParams();
  const placeParam = params.get('place');
  const placeId = placeParam && UUID.test(placeParam) ? placeParam : null;

  const choose = (place: JurisdictionSearchResult) => setParams({ place: place.id });
  const changeLocation = () => setParams({});

  return (
    <div className="min-h-screen bg-white">
      <SiteHeader />
      <main id="main-content" className="mx-auto max-w-4xl px-4 py-10 sm:py-12">
        {/* Home is only for users with backend access; everyone else starts here */}
        {isSignedIn && role && (
          <Link
            to="/"
            className="mb-6 inline-flex items-center gap-1.5 text-sm underline underline-offset-4 hover:no-underline"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Home
          </Link>
        )}
        {placeId ? (
          <Results placeId={placeId} onChangeLocation={changeLocation} />
        ) : (
          <LocationPicker onChoose={choose} />
        )}
      </main>
    </div>
  );
}

// ─── Choosing a location ──────────────────────────────────────────────────────

type LocateState =
  | { status: 'idle' }
  | { status: 'locating' }
  | { status: 'error'; message: string };

function LocationPicker({ onChoose }: { onChoose: (place: JurisdictionSearchResult) => void }) {
  const inputId = useId();
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query.trim(), 250);
  const [results, setResults] = useState<JurisdictionSearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [locate, setLocate] = useState<LocateState>({ status: 'idle' });

  useEffect(() => {
    if (debounced.length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    api
      .searchJurisdictions(debounced, { limit: 8 }, controller.signal)
      .then((data) => {
        setResults(data);
        setSearchError(null);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setSearchError(getErrorMessage(err, 'Search failed.'));
      });
    return () => controller.abort();
  }, [debounced]);

  const useMyLocation = () => {
    if (!('geolocation' in navigator)) {
      setLocate({ status: 'error', message: 'This browser cannot share its location.' });
      return;
    }
    setLocate({ status: 'locating' });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { longitude, latitude } = position.coords;
        codesAt(longitude, latitude)
          .then((codes) => {
            if (!codes) throw new Error('That location is not in Canada.');
            return api.locateJurisdiction(codes);
          })
          .then((place) => {
            setLocate({ status: 'idle' });
            onChoose(place);
          })
          .catch((err: unknown) =>
            setLocate({
              status: 'error',
              message: getErrorMessage(err, 'Could not find where you are. Search instead.'),
            }),
          );
      },
      (error) =>
        setLocate({
          status: 'error',
          message:
            error.code === error.PERMISSION_DENIED
              ? 'Location access was declined. Search for your location instead.'
              : 'Your location is not available right now. Search for it instead.',
        }),
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 0 },
    );
  };

  return (
    <section aria-labelledby="where-heading">
      <h1 id="where-heading" className="border-b border-black pb-2 text-3xl font-bold">
        Where are you?
      </h1>
      <p className="mt-3 text-sm">
        Choose your location to see the laws and documents that apply there, including those of your
        region, province or territory, and Canada.
      </p>

      <div className="mt-6 space-y-3">
        <button
          type="button"
          onClick={useMyLocation}
          disabled={locate.status === 'locating'}
          className="inline-flex items-center gap-2 border border-accent bg-accent px-4 py-2 text-sm text-white hover:border-accent-dark hover:bg-accent-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-70"
        >
          {locate.status === 'locating' ? (
            <LoadingSpinner size="sm" label="Finding your location" />
          ) : (
            <LocateFixed className="h-4 w-4" aria-hidden="true" />
          )}
          {locate.status === 'locating' ? 'Finding your location…' : 'Use my location'}
        </button>
        {locate.status === 'error' && (
          <p role="alert" className="text-sm font-bold italic">
            {locate.message}
          </p>
        )}

        <p className="text-sm italic">or</p>

        <label htmlFor={inputId} className="block text-sm font-medium">
          Search for a city, town, region, province or First Nation
        </label>
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
            aria-hidden="true"
          />
          <input
            id={inputId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. Squamish"
            autoComplete="off"
            className="w-full border border-gray-500 py-2.5 pl-9 pr-3 placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        {searchError && <p className="text-sm font-bold italic">{searchError}</p>}
        {results.length > 0 && (
          <ul className="divide-y divide-gray-200 border border-gray-300">
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onChoose(r)}
                  className="flex w-full items-baseline justify-between gap-3 px-3 py-2.5 text-left hover:bg-accent-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                >
                  <span>
                    {r.name}
                    <span className="ml-2 text-xs text-gray-500">
                      {[r.subtype, describePath(r)].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="flex-shrink-0 text-xs uppercase tracking-wider text-gray-500">
                    {JURISDICTION_LEVEL_LABELS[r.level]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {debounced.length >= 2 && results.length === 0 && !searchError && (
          <p className="text-sm text-gray-600">No places match “{debounced}”.</p>
        )}
      </div>
    </section>
  );
}

// ─── What applies there ───────────────────────────────────────────────────────

interface Group {
  key: string;
  name: string;
  detail: string;
  docs: LibraryDocument[];
}

/**
 * Groups documents by the jurisdiction that makes them apply, most local first (the place,
 * then each jurisdiction containing it, then Canada). A document tagged with several of these
 * is listed once, under the most local one.
 */
function groupByJurisdiction(place: JurisdictionSearchResult, docs: LibraryDocument[]): Group[] {
  const chain = [
    {
      key: place.id,
      name: place.name,
      detail: place.subtype ?? JURISDICTION_LEVEL_LABELS[place.level],
    },
    ...[...place.path]
      .reverse()
      .map((p) => ({ key: p.id, name: p.name, detail: JURISDICTION_LEVEL_LABELS[p.level] })),
  ];
  const groups = new Map<string, Group>(chain.map((c) => [c.key, { ...c, docs: [] }]));
  const federal: Group = { key: 'federal', name: 'Canada', detail: 'Federal', docs: [] };

  for (const doc of docs) {
    const applying = doc.jurisdictions.filter((j) => j.applies);
    const local = chain.find((c) => applying.some((j) => j.id === c.key));
    if (local) groups.get(local.key)!.docs.push(doc);
    else federal.docs.push(doc);
  }
  return [...groups.values(), federal].filter((g) => g.docs.length > 0);
}

function Results({ placeId, onChangeLocation }: { placeId: string; onChangeLocation: () => void }) {
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const [searchInput, setSearchInput] = useState(search);
  const debouncedSearch = useDebounce(searchInput.trim(), 350);
  const [page, setPage] = useState(1);
  const [state, setState] = useState<{
    data: LibraryResponse | null;
    docs: LibraryDocument[];
    error: string | null;
    loading: boolean;
  }>({ data: null, docs: [], error: null, loading: true });
  const [attempt, setAttempt] = useState(0);

  // Keep the search box's text in the URL so Back/links restore it
  useEffect(() => {
    if (debouncedSearch === search) return;
    const next = new URLSearchParams(params);
    if (debouncedSearch) next.set('q', debouncedSearch);
    else next.delete('q');
    setParams(next, { replace: true });
  }, [debouncedSearch, search, params, setParams]);

  useEffect(() => setPage(1), [placeId, search]);

  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    api
      .getLibrary({ jurisdictionId: placeId, search, page, pageSize: PAGE_SIZE }, controller.signal)
      .then((data) =>
        setState((s) => ({
          data,
          docs: page === 1 ? data.data : [...s.docs, ...data.data],
          error: null,
          loading: false,
        })),
      )
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState((s) => ({
          ...s,
          loading: false,
          error: getErrorMessage(err, 'Could not load the documents for this location.'),
        }));
      });
    return () => controller.abort();
  }, [placeId, search, page, attempt]);

  const place = state.data?.place ?? null;
  useDocumentTitle(place ? `What applies in ${place.name}` : 'User facing');
  const groups = useMemo(
    () => (place ? groupByJurisdiction(place, state.docs) : []),
    [place, state.docs],
  );
  const total = state.data?.pagination.totalItems ?? 0;

  if (!place && state.loading) return <LoadingSpinner label="Loading documents" />;
  if (!place) {
    return (
      <div role="alert" className="space-y-4">
        <p className="font-bold italic">{state.error ?? 'That location could not be found.'}</p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="border border-black px-4 py-2 text-sm hover:bg-accent hover:text-white"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={onChangeLocation}
            className="text-sm underline underline-offset-4 hover:no-underline"
          >
            Choose another location
          </button>
        </div>
      </div>
    );
  }

  const where = [place.name, ...[...place.path].reverse().map((p) => p.name), 'Canada']
    .filter((n, i, all) => all.indexOf(n) === i)
    .join(', ');

  return (
    <section aria-labelledby="results-heading">
      <div className="flex flex-col gap-3 border-b border-black pb-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="flex items-center gap-1.5 text-sm text-gray-600">
            <MapPin className="h-4 w-4" aria-hidden="true" />
            {where}
          </p>
          <h1 id="results-heading" className="mt-1 text-3xl font-bold">
            What applies in {place.name}
          </h1>
        </div>
        <button
          type="button"
          onClick={onChangeLocation}
          className="inline-flex flex-shrink-0 items-center gap-1.5 self-start border border-black px-3 py-1.5 text-sm hover:bg-accent hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:self-auto"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          Change location
        </button>
      </div>

      <AiPackagePanel placeId={place.id} placeName={place.name} />

      <div className="relative mt-5">
        <label htmlFor="library-search" className="sr-only">
          Search these documents
        </label>
        <Search
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
          aria-hidden="true"
        />
        <input
          id="library-search"
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search these documents"
          className="w-full border border-gray-500 py-2 pl-9 pr-3 text-sm placeholder:text-gray-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      <p className="mt-3 text-sm text-gray-600" aria-live="polite">
        {state.loading && page === 1
          ? 'Loading…'
          : `${total} ${total === 1 ? 'document applies' : 'documents apply'}${search ? ` matching “${search}”` : ''}.`}
      </p>
      {state.error && (
        <p role="alert" className="mt-2 text-sm font-bold italic">
          {state.error}
        </p>
      )}

      {!state.loading && total === 0 && !state.error && (
        <p className="mt-8 italic">
          {search
            ? 'No documents match that search here.'
            : `No documents have been added for ${place.name} or the jurisdictions containing it yet.`}
        </p>
      )}

      {groups.map((group) => (
        <section key={group.key} aria-labelledby={`group-${group.key}`} className="mt-8">
          <h2
            id={`group-${group.key}`}
            className="flex items-baseline justify-between gap-3 border-b-4 border-double border-black pb-1 text-xl"
          >
            <span>{group.name}</span>
            <span className="text-xs font-normal uppercase tracking-wider text-gray-600">
              {group.detail} · {group.docs.length}
            </span>
          </h2>
          <ul className="divide-y divide-gray-300">
            {group.docs.map((doc) => (
              <li key={doc.id} className="py-4">
                <div className="min-w-0">
                  <h3 className="text-lg font-bold [font-variant-caps:normal]">{doc.title}</h3>
                  {doc.description && (
                    <p className="mt-1 line-clamp-3 text-sm">{doc.description}</p>
                  )}
                  {doc.tags.length > 0 && (
                    <p className="mt-1 text-xs text-gray-600">{doc.tags.join(', ')}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {state.docs.length < total && (
        <div className="mt-8 text-center">
          <button
            type="button"
            disabled={state.loading}
            onClick={() => setPage((p) => p + 1)}
            className="border border-black px-4 py-2 text-sm hover:bg-accent hover:text-white disabled:opacity-60"
          >
            {state.loading ? 'Loading…' : `Show more (${total - state.docs.length} more)`}
          </button>
        </div>
      )}
    </section>
  );
}
