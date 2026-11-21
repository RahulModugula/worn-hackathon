// Every statistic shown on /impact. Only numbers and URLs from docs/PITCH.md are allowed here.
// SOURCED = published figure with a URL. ESTIMATE = our derivation from a published figure.
// ASSUMPTION = a value the reader can change; it is not a finding.

export type Badge = 'SOURCED' | 'ESTIMATE' | 'ASSUMPTION';

export interface Stat {
  id: string;
  label: string;
  value: string;
  badge: Badge;
  /** For SOURCED: the URL text from docs/PITCH.md. For others: how it was derived. */
  source: string;
  note?: string;
}

export const PUBLISHED: Stat[] = [
  {
    id: 'docHours',
    label: 'EMR documentation per 12-hour shift',
    value: '4.7 h',
    badge: 'SOURCED',
    source: 'escholarship.org/content/qt08x7j3f7/qt08x7j3f7.pdf',
    note: 'Acute-care nurses, average. Study year not verified.',
  },
  {
    id: 'flowsheets',
    label: 'Flowsheets share of a 12-hour shift',
    value: '31%',
    badge: 'SOURCED',
    source: 'nursing.jmir.org/2025/1/e69651 (JMIR Nursing 2025)',
  },
  {
    id: 'medError',
    label: 'Observed doses with a medication error (median)',
    value: 'About 1 in 5',
    badge: 'SOURCED',
    source: 'psnet.ahrq.gov, "prevalence and nature of medication administration errors" (Keers 2013)',
    note: 'Mostly timing errors. Secondary summary; exact figures not verified at the primary source.',
  },
  {
    id: 'barcode',
    label: 'Administrations with barcode-scanning workarounds',
    value: '66%',
    badge: 'SOURCED',
    source: 'pmc.ncbi.nlm.nih.gov/articles/PMC7646849 (van der Veen et al., JAMIA 2018)',
    note: 'Abstract says 66% (results table: 63%). 36% of workarounds were procedural, such as not scanning.',
  },
  {
    id: 'interrupted',
    label: 'Administrations interrupted',
    value: '53.1%',
    badge: 'SOURCED',
    source: 'sciencedaily.com/releases/2010/04/100426181958.htm (2010)',
  },
  {
    id: 'turnover',
    label: 'Turnover cost per bedside RN',
    value: '$60,090',
    badge: 'SOURCED',
    source: 'nsinursingsolutions.com, NSI National Health Care Retention Report (NSI 2026, CY2025 data)',
    note: '17.6% turnover, 8.6% vacancy.',
  },
  {
    id: 'rnJobs',
    label: 'US registered nurse jobs (2025)',
    value: '3,465,400',
    badge: 'SOURCED',
    source: 'bls.gov/ooh/healthcare/registered-nurses.htm',
    note: 'About 59% in hospitals.',
  },
  {
    id: 'hospitals',
    label: 'US hospitals',
    value: '6,100',
    badge: 'SOURCED',
    source: 'aha.org/statistics/fast-facts-us-hospitals (AHA 2024 survey)',
    note: '907,216 staffed beds.',
  },
];

export const MODEL: Stat[] = [
  {
    id: 'loadedCostPerNurseYear',
    label: 'Loaded cost per nurse per year',
    value: '$139,497',
    badge: 'ESTIMATE',
    source: 'BLS median RN wage $97,550 (May 2025, all industries, bls.gov/ooh/healthcare/registered-nurses.htm, read 2026-11-21) x 1.43 benefits factor (our assumption).',
  },
  {
    id: 'benefitFactor',
    label: 'Benefits multiplier on wage',
    value: '1.43',
    badge: 'ASSUMPTION',
    source: 'Our planning factor, not a sourced figure.',
  },
  {
    id: 'minutesPerShift',
    label: 'Minutes saved per shift',
    value: '15 min',
    badge: 'ASSUMPTION',
    source: 'No study measures glasses savings. The pilot measures it.',
  },
  {
    id: 'capturePct',
    label: 'Share of saved minutes captured',
    value: '50%',
    badge: 'ASSUMPTION',
    source: 'Our assumption. Not every saved minute turns into paid, reclaimed time.',
  },
  {
    id: 'devicePriceUsd',
    label: 'Device price',
    value: '$450',
    badge: 'ASSUMPTION',
    source: 'Our target range of $300-600 for a waveguide display with a camera. Not a quote.',
  },
  {
    id: 'shiftsPerYear',
    label: 'Shifts per nurse per year',
    value: '173',
    badge: 'ASSUMPTION',
    source: 'Our assumption: about 2,080 paid hours at 12 h per shift.',
  },
  {
    id: 'shiftMinutes',
    label: 'Minutes per shift (paid)',
    value: '720',
    badge: 'ASSUMPTION',
    source: 'A 12-hour shift, the shift length used in the documentation study above.',
  },
  {
    id: 'nursesPerUnit',
    label: 'Nurses per unit',
    value: '30',
    badge: 'ASSUMPTION',
    source: 'Scenario input for a med-surg unit.',
  },
  {
    id: 'units',
    label: 'Units in the pilot scenario',
    value: '1',
    badge: 'ASSUMPTION',
    source: 'Scenario input. The pilot is one med-surg unit.',
  },
  {
    id: 'bedsPerNurseOnShift',
    label: 'Beds per nurse on shift',
    value: '5',
    badge: 'ASSUMPTION',
    source: 'Assumption for the hospital scenario only. Not sourced; confirm before quoting. Also sets devices = one per on-shift nurse.',
  },
  {
    id: 'runningCostPerDeviceYear',
    label: 'Running cost per device per year (software + MDM + cleaning)',
    value: '$120',
    badge: 'ASSUMPTION',
    source: 'Our placeholder: about $60 software + $36 device management + $24 cleaning supplies. Not a quote; replace with your own.',
  },
  {
    id: 'deviceLifeYears',
    label: 'Device life',
    value: '3 years',
    badge: 'ASSUMPTION',
    source: 'Our planning life for a shared clinical wearable. Only used for the net-value-per-year line.',
  },
  {
    id: 'hospitalBeds',
    label: 'Beds in the hospital scenario',
    value: '500',
    badge: 'ASSUMPTION',
    source: 'Scenario size. Not a real hospital.',
  },
];

export const ALL_STATS: Stat[] = [...PUBLISHED, ...MODEL];

export function badgeFor(id: string): Badge {
  const s = ALL_STATS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown stat id: ${id}`);
  return s.badge;
}
