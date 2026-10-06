import React, { useMemo } from 'react';
import { X } from 'lucide-react';
import {
  useJurisdictionStore,
  MAX_JURISDICTION_SELECTIONS,
  inheritedJurisdictions,
  type JurisdictionSelection,
} from '../../stores/jurisdictionStore';

const chipColors: Record<JurisdictionSelection['level'], string> = {
  federal: 'bg-black text-white border-black',
  provincial: 'bg-white text-black border-black',
  territorial: 'bg-white text-black border-black border-dashed',
  regional: 'bg-white text-black border-gray-500',
  municipal: 'bg-white text-gray-800 border-gray-400',
  indigenous: 'bg-white text-black border-gray-500 border-dotted',
};

/**
 * Removable selection chip. Rendered locally (not via common/Badge) because this lives
 * inside the upload <form>: the remove control must be type="button" so it never submits
 * the form or becomes the form's implicit-submission default button.
 */
function SelectionChip({
  selection,
  label,
  onRemove,
}: {
  selection: JurisdictionSelection;
  label: string;
  onRemove: () => void;
}) {
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
  const { selections, provinces, removeSelection, clearAll } = useJurisdictionStore();
  const inherited = useMemo(
    () => inheritedJurisdictions(selections, provinces),
    [selections, provinces],
  );

  const totalCount = selections.length;
  const overLimit = totalCount > MAX_JURISDICTION_SELECTIONS;

  const groups = useMemo(() => {
    const withPlace = (s: JurisdictionSelection) =>
      s.parentName ? `${s.name}, ${s.parentName}` : s.name;
    const defs: {
      title: string;
      levels: JurisdictionSelection['level'][];
      label: (s: JurisdictionSelection) => string;
    }[] = [
      { title: 'Federal', levels: ['federal'], label: (s) => s.name },
      {
        title: 'Provincial / Territorial',
        levels: ['provincial', 'territorial'],
        label: (s) => s.name,
      },
      { title: 'Regional', levels: ['regional'], label: withPlace },
      { title: 'Municipal', levels: ['municipal'], label: withPlace },
      { title: 'Indigenous', levels: ['indigenous'], label: withPlace },
    ];
    return defs.map((d) => ({
      ...d,
      items: selections.filter((s) => d.levels.includes(s.level)),
    }));
  }, [selections]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4" aria-live="polite">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">
          Selected jurisdictions
          <span
            className={`ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-xs font-medium ${
              overLimit
                ? 'bg-red-600 text-white'
                : totalCount > 0
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-700'
            }`}
          >
            {totalCount}/{MAX_JURISDICTION_SELECTIONS}
          </span>
        </h3>
        {totalCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="flex-shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-sm font-medium text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            Clear all
          </button>
        )}
      </div>

      {totalCount === 0 ? (
        <p className="py-2 text-sm text-gray-500">
          Nothing selected yet. Choose Federal, click provinces on the map, search above, or browse
          a province for its regions, municipalities and Indigenous lands.
        </p>
      ) : (
        <div className="space-y-3">
          {groups.map(
            (g) =>
              g.items.length > 0 && (
                <div key={g.title}>
                  <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-gray-500">
                    {g.title}
                  </p>
                  <ul className="flex flex-wrap gap-1.5" aria-label={g.title}>
                    {g.items.map((s) => (
                      <SelectionChip
                        key={s.id}
                        selection={s}
                        label={g.label(s)}
                        onRemove={() => removeSelection(s.id)}
                      />
                    ))}
                  </ul>
                </div>
              ),
          )}
          {inherited.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-gray-500">
                Inherited
              </p>
              <ul className="flex flex-wrap gap-1.5" aria-label="Inherited jurisdictions">
                {inherited.map((j) => (
                  <li
                    key={j.id}
                    title={`Included because of: ${j.from.join(', ')}`}
                    className="inline-flex items-center border border-dashed border-gray-500 px-2.5 py-0.5 text-xs text-gray-700"
                  >
                    {j.name}
                    <span className="ml-1 text-gray-500">
                      · from{' '}
                      {j.from.length <= 2 ? j.from.join(', ') : `${j.from.length} selections`}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-xs text-gray-500">
                Added automatically: a document for a place also applies in its province or
                territory and in Canada. Remove the selection to remove these.
              </p>
            </div>
          )}
        </div>
      )}

      {overLimit && (
        <p className="mt-3 text-xs font-medium text-red-600">
          A document can be tagged with at most {MAX_JURISDICTION_SELECTIONS} jurisdictions. Remove{' '}
          {totalCount - MAX_JURISDICTION_SELECTIONS}, or select an entire province instead of many
          of the jurisdictions in it.
        </p>
      )}
    </div>
  );
}
