import React, { useEffect, useMemo, useState } from 'react';
import {
  JURISDICTION_LEVEL_LABELS,
  type JurisdictionLevel,
  type JurisdictionSearchResult,
} from '@lexterrae/shared';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { api, getErrorMessage } from '../../services/api';
import { useJurisdictionStore } from '../../stores/jurisdictionStore';

interface AddJurisdictionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Prefills the name (e.g. from a search that found nothing). */
  initialName?: string;
  /** Prefills the province/territory. */
  initialProvinceCode?: string;
  onCreated?: (item: JurisdictionSearchResult) => void;
}

const LEVEL_OPTIONS: JurisdictionLevel[] = [
  'municipal',
  'regional',
  'indigenous',
  'provincial',
  'territorial',
  'federal',
];

const LEVEL_HINTS: Record<JurisdictionLevel, string> = {
  federal: 'A federal body or area, e.g. a national park or federal agency.',
  provincial: 'Province-level, alongside the ten provinces.',
  territorial: 'Territory-level, alongside Yukon, the Northwest Territories and Nunavut.',
  regional: 'Above municipalities, e.g. a county, regional district or conservation authority.',
  municipal: 'A city, town, village, township or other local government.',
  indigenous: 'A First Nation, Inuit or Métis community, reserve, settlement or lands.',
};

const selectClass =
  'block w-full rounded-md border border-gray-500 bg-white px-3 py-2 text-sm text-black focus:border-black focus:outline-none focus:ring-2 focus:ring-black';

/** Adds a jurisdiction missing from the official list. Only the user who adds it can see it. */
export function AddJurisdictionDialog({
  isOpen,
  onClose,
  initialName = '',
  initialProvinceCode,
  onCreated,
}: AddJurisdictionDialogProps) {
  const { provinces, contents, loadProvinceContents, addCustomJurisdiction, fetchProvinces } =
    useJurisdictionStore();
  const [name, setName] = useState(initialName);
  const [level, setLevel] = useState<JurisdictionLevel>('municipal');
  const [provinceCode, setProvinceCode] = useState(initialProvinceCode ?? '');
  const [regionId, setRegionId] = useState('');
  const [subtype, setSubtype] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | undefined>();
  const [isSaving, setIsSaving] = useState(false);

  // Reset each time the dialog opens
  useEffect(() => {
    if (!isOpen) return;
    setName(initialName);
    setLevel('municipal');
    setProvinceCode(initialProvinceCode ?? '');
    setRegionId('');
    setSubtype('');
    setError(null);
    setNameError(undefined);
    void fetchProvinces();
  }, [isOpen, initialName, initialProvinceCode, fetchProvinces]);

  const needsProvince = level === 'regional' || level === 'municipal' || level === 'indigenous';
  const canBeInRegion = level === 'municipal' || level === 'indigenous';

  // Regions to nest under come from the province's (lazily loaded) contents
  useEffect(() => {
    if (isOpen && canBeInRegion && provinceCode) void loadProvinceContents(provinceCode);
  }, [isOpen, canBeInRegion, provinceCode, loadProvinceContents]);

  const regions = useMemo(
    () =>
      (contents[provinceCode]?.items ?? [])
        .filter((i) => i.level === 'regional')
        .sort((a, b) => a.name.localeCompare(b.name)),
    [contents, provinceCode],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // This form is portalled, but React still bubbles submit to the upload form around it
    e.stopPropagation();
    setError(null);
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setNameError('Enter a name of at least 2 characters.');
      return;
    }
    setNameError(undefined);

    let parentId: string | undefined;
    if (needsProvince) {
      const province = provinces.find((p) => p.code === provinceCode);
      if (!province?.id) {
        setError('Choose the province or territory it is in.');
        return;
      }
      parentId = (canBeInRegion && regionId) || province.id;
    }

    setIsSaving(true);
    try {
      const created = await api.createJurisdiction({
        name: trimmed,
        level,
        parentId,
        subtype: subtype.trim() || undefined,
      });
      addCustomJurisdiction(created);
      onCreated?.(created);
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, 'Could not add the jurisdiction.'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add a jurisdiction"
      description="Add a jurisdiction that is not in the list. Only you will see it."
      disableClose={isSaving}
      maxWidth="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <p className="text-sm text-gray-600">
          Can&apos;t find a jurisdiction? Add it here and it will be selected for this document.
          Jurisdictions you add are visible only to you.
        </p>

        {error && (
          <p role="alert" className="border border-black px-3 py-2 text-sm font-bold italic">
            {error}
          </p>
        )}

        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Toronto and Region Conservation Authority"
          required
          maxLength={200}
          error={nameError}
          autoFocus
        />

        <div>
          <label htmlFor="add-jurisdiction-level" className="mb-1 block text-sm font-medium">
            Level
          </label>
          <select
            id="add-jurisdiction-level"
            value={level}
            onChange={(e) => {
              setLevel(e.target.value as JurisdictionLevel);
              setRegionId('');
            }}
            className={selectClass}
            aria-describedby="add-jurisdiction-level-hint"
          >
            {LEVEL_OPTIONS.map((l) => (
              <option key={l} value={l}>
                {JURISDICTION_LEVEL_LABELS[l]}
              </option>
            ))}
          </select>
          <p id="add-jurisdiction-level-hint" className="mt-1 text-xs text-gray-500">
            {LEVEL_HINTS[level]}
          </p>
        </div>

        {needsProvince && (
          <div>
            <label htmlFor="add-jurisdiction-province" className="mb-1 block text-sm font-medium">
              Province or territory
            </label>
            <select
              id="add-jurisdiction-province"
              value={provinceCode}
              onChange={(e) => {
                setProvinceCode(e.target.value);
                setRegionId('');
              }}
              className={selectClass}
              required
            >
              <option value="">Choose…</option>
              {provinces.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {canBeInRegion && provinceCode && (
          <div>
            <label htmlFor="add-jurisdiction-region" className="mb-1 block text-sm font-medium">
              Inside a region <span className="text-gray-500">(optional)</span>
            </label>
            <select
              id="add-jurisdiction-region"
              value={regionId}
              onChange={(e) => setRegionId(e.target.value)}
              className={selectClass}
              disabled={contents[provinceCode]?.status === 'loading'}
            >
              <option value="">
                {contents[provinceCode]?.status === 'loading'
                  ? 'Loading regions…'
                  : 'Directly in the province or territory'}
              </option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.subtype ? ` (${r.subtype})` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <Input
          label="Type (optional)"
          value={subtype}
          onChange={(e) => setSubtype(e.target.value)}
          placeholder="e.g. Conservation authority, Treaty area, Métis settlement"
          maxLength={80}
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="submit" isLoading={isSaving}>
            Add and select
          </Button>
        </div>
      </form>
    </Modal>
  );
}
