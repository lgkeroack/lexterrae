import React, { useMemo } from 'react';
import { X } from 'lucide-react';
import {
  useJurisdictionStore,
  MAX_JURISDICTION_SELECTIONS,
  type JurisdictionSelection,
} from '../../stores/jurisdictionStore';

const chipColors: Record<JurisdictionSelection['level'], string> = {
  federal: 'bg-green-100 text-green-800 border-green-200',
  provincial: 'bg-blue-100 text-blue-800 border-blue-200',
  territorial: 'bg-blue-100 text-blue-800 border-blue-200',
  municipal: 'bg-gray-100 text-gray-800 border-gray-200',
};

/**
 * Removable selection chip. Rendered locally (not via common/Badge) because this lives
 * inside the upload <form>: the remove control must be type="button" so it never submits
 * the form or becomes the form's implicit-submission default button.
 */
function SelectionChip({ selection, label, onRemove }: { selection: JurisdictionSelection; label: string; onRemove: () => void }) {
  return (
    <li
      className={`inline-flex items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1 text-xs font-medium ${chipColors[selection.level]}`}
    >
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className="inline-flex items-center rounded-full p-0.5 hover:bg-black/10 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </li>
  );
}

export function JurisdictionSummary() {
  const { selections, removeSelection, clearAll } = useJurisdictionStore();

  const grouped = useMemo(() => {
    const federal: JurisdictionSelection[] = [];
    const provincial: JurisdictionSelection[] = [];
    const municipal: JurisdictionSelection[] = [];

    selections.forEach((s) => {
      if (s.level === 'federal') federal.push(s);
      else if (s.level === 'provincial' || s.level === 'territorial') provincial.push(s);
      else if (s.level === 'municipal') municipal.push(s);
    });

    return { federal, provincial, municipal };
  }, [selections]);

  const totalCount = selections.length;
  const overLimit = totalCount > MAX_JURISDICTION_SELECTIONS;

  const groups: { title: string; items: JurisdictionSelection[]; label: (s: JurisdictionSelection) => string }[] = [
    { title: 'Federal', items: grouped.federal, label: (s) => s.name },
    { title: 'Provincial / Territorial', items: grouped.provincial, label: (s) => s.name },
    { title: 'Municipal', items: grouped.municipal, label: (s) => (s.parentName ? `${s.name}, ${s.parentName}` : s.name) },
  ];

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4" aria-live="polite">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">
          Selected jurisdictions
          <span
            className={`ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-xs font-medium ${
              overLimit ? 'bg-red-600 text-white' : totalCount > 0 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'
            }`}
          >
            {totalCount}/{MAX_JURISDICTION_SELECTIONS}
          </span>
        </h3>
        {totalCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="rounded-md px-2 py-1 text-sm font-medium text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            Clear all
          </button>
        )}
      </div>

      {totalCount === 0 ? (
        <p className="py-2 text-sm text-gray-500">
          Nothing selected yet. Choose Federal, click provinces on the map, or use the list to pick
          provinces, territories or municipalities.
        </p>
      ) : (
        <div className="space-y-3">
          {groups.map(
            (g) =>
              g.items.length > 0 && (
                <div key={g.title}>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-gray-500">{g.title}</p>
                  <ul className="flex flex-wrap gap-1.5" aria-label={g.title}>
                    {g.items.map((s) => (
                      <SelectionChip key={s.id} selection={s} label={g.label(s)} onRemove={() => removeSelection(s.id)} />
                    ))}
                  </ul>
                </div>
              )
          )}
        </div>
      )}

      {overLimit && (
        <p className="mt-3 text-xs font-medium text-red-600">
          A document can be tagged with at most {MAX_JURISDICTION_SELECTIONS} jurisdictions. Remove{' '}
          {totalCount - MAX_JURISDICTION_SELECTIONS}, or select an entire province instead of many of its municipalities.
        </p>
      )}
    </div>
  );
}
