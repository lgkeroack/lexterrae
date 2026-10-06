/**
 * Official sources for current (consolidated) legislation, by jurisdiction. Shown in the upload
 * area so users can find this year's version of a law before uploading it.
 */
export interface LawSource {
  label: string;
  url: string;
  note?: string;
}

export interface JurisdictionLawSources {
  /** Province/territory code, or "CA" for federal. */
  code: string;
  name: string;
  sources: LawSource[];
}

export function federalLawSources(year: number): JurisdictionLawSources {
  return {
    code: 'CA',
    name: 'Federal (Canada)',
    sources: [
      {
        label: 'Justice Laws Website',
        url: 'https://laws-lois.justice.gc.ca/eng/',
        note: 'Consolidated Acts and regulations',
      },
      {
        label: `Annual Statutes ${year}`,
        url: `https://laws-lois.justice.gc.ca/eng/AnnualStatutes/index${year}.html`,
        note: 'Acts passed this year',
      },
      {
        label: 'Canada Gazette',
        url: 'https://gazette.gc.ca/rp-pr/publications-eng.html',
        note: 'New regulations and notices',
      },
    ],
  };
}

export const PROVINCIAL_LAW_SOURCES: JurisdictionLawSources[] = [
  {
    code: 'AB',
    name: 'Alberta',
    sources: [{ label: "Alberta King's Printer", url: 'https://kings-printer.alberta.ca/' }],
  },
  {
    code: 'BC',
    name: 'British Columbia',
    sources: [{ label: 'BC Laws', url: 'https://www.bclaws.gov.bc.ca/' }],
  },
  {
    code: 'MB',
    name: 'Manitoba',
    sources: [{ label: 'Manitoba Laws', url: 'https://web2.gov.mb.ca/laws/index.php' }],
  },
  {
    code: 'NB',
    name: 'New Brunswick',
    sources: [{ label: 'New Brunswick Acts and Regulations', url: 'https://laws.gnb.ca/en/' }],
  },
  {
    code: 'NL',
    name: 'Newfoundland and Labrador',
    sources: [
      { label: 'House of Assembly: Legislation', url: 'https://www.assembly.nl.ca/legislation/' },
    ],
  },
  {
    code: 'NS',
    name: 'Nova Scotia',
    sources: [
      {
        label: 'Consolidated Public Statutes',
        url: 'https://nslegislature.ca/legislative-business/bills-statutes/consolidated-public-statutes',
      },
    ],
  },
  {
    code: 'NT',
    name: 'Northwest Territories',
    sources: [
      { label: 'NWT Justice: Legislation', url: 'https://www.justice.gov.nt.ca/en/legislation/' },
    ],
  },
  {
    code: 'NU',
    name: 'Nunavut',
    sources: [{ label: 'Nunavut Legislation', url: 'https://www.nunavutlegislation.ca/' }],
  },
  {
    code: 'ON',
    name: 'Ontario',
    sources: [{ label: 'Ontario e-Laws', url: 'https://www.ontario.ca/laws' }],
  },
  {
    code: 'PE',
    name: 'Prince Edward Island',
    sources: [
      { label: 'PEI Legislation', url: 'https://www.princeedwardisland.ca/en/legislation' },
    ],
  },
  {
    code: 'QC',
    name: 'Quebec',
    sources: [{ label: 'LégisQuébec', url: 'https://www.legisquebec.gouv.qc.ca/en' }],
  },
  {
    code: 'SK',
    name: 'Saskatchewan',
    sources: [{ label: 'Publications Saskatchewan', url: 'https://publications.saskatchewan.ca/' }],
  },
  {
    code: 'YT',
    name: 'Yukon',
    sources: [{ label: 'Yukon Laws', url: 'https://laws.yukon.ca/' }],
  },
];

/** Not tied to one province: municipal by-laws and Indigenous laws. */
export const GENERAL_LAW_SOURCES: LawSource[] = [
  {
    label: 'CanLII',
    url: 'https://www.canlii.org/',
    note: 'Free legislation and case law for every jurisdiction',
  },
  {
    label: 'First Nations Gazette',
    url: 'https://fng.ca/',
    note: 'First Nations laws and by-laws',
  },
];
