import React, { useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import {
  federalLawSources,
  GENERAL_LAW_SOURCES,
  PROVINCIAL_LAW_SOURCES,
  type JurisdictionLawSources,
  type LawSource,
} from '../../data/lawSources';
import { useJurisdictionStore } from '../../stores/jurisdictionStore';

function SourceLink({ source }: { source: LawSource }) {
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-baseline gap-1 underline underline-offset-4 hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {source.label}
      <ExternalLink className="h-3 w-3 flex-shrink-0 self-center" aria-hidden="true" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

function SourceGroup({ group }: { group: JurisdictionLawSources }) {
  return (
    <li>
      <span className="font-semibold">{group.name}: </span>
      {group.sources.map((s, i) => (
        <React.Fragment key={s.url}>
          {i > 0 && ' · '}
          <SourceLink source={s} />
          {s.note && <span className="text-gray-500"> ({s.note})</span>}
        </React.Fragment>
      ))}
    </li>
  );
}

/**
 * Where to find the current year's laws: federal sources, plus those of the provinces and
 * territories selected for this document, with the rest one click away.
 */
export function LawSources() {
  const selections = useJurisdictionStore((s) => s.selections);
  const year = new Date().getFullYear();

  // Federal sources always; provinces and territories once something in them is selected
  const { relevant, others } = useMemo(() => {
    const all = [federalLawSources(year), ...PROVINCIAL_LAW_SOURCES];
    const codes = new Set<string>(['CA']);
    for (const s of selections) {
      if (s.level === 'provincial' || s.level === 'territorial') codes.add(s.id);
      else if (s.parentCode) codes.add(s.parentCode);
    }
    return {
      relevant: all.filter((g) => codes.has(g.code)),
      others: all.filter((g) => !codes.has(g.code)),
    };
  }, [selections, year]);

  return (
    <aside
      aria-labelledby="law-sources-heading"
      className="border border-black bg-white p-4 text-sm sm:p-6"
    >
      <h2 id="law-sources-heading" className="text-sm font-semibold">
        Where to find current laws ({year})
      </h2>
      <p className="mt-1 text-xs text-gray-600">
        Official consolidated statutes and regulations, kept up to date by each government. Download
        the current version, then upload it here.
      </p>

      <ul className="mt-3 space-y-1">
        {relevant.map((g) => (
          <SourceGroup key={g.code} group={g} />
        ))}
      </ul>

      {others.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs uppercase tracking-wider text-gray-500 hover:text-black">
            {relevant.length > 1 ? 'Other provinces and territories' : 'Provinces and territories'}
          </summary>
          <ul className="mt-2 space-y-1">
            {others.map((g) => (
              <SourceGroup key={g.code} group={g} />
            ))}
          </ul>
        </details>
      )}

      <p className="mt-3 border-t border-gray-300 pt-3 text-xs">
        <span className="font-semibold">Municipal by-laws and Indigenous laws: </span>
        {GENERAL_LAW_SOURCES.map((s, i) => (
          <React.Fragment key={s.url}>
            {i > 0 && ' · '}
            <SourceLink source={s} />
            {s.note && <span className="text-gray-500"> ({s.note})</span>}
          </React.Fragment>
        ))}
        <span className="text-gray-500">
          {' '}
          · Most municipalities also publish their by-laws on their own website.
        </span>
      </p>
    </aside>
  );
}
