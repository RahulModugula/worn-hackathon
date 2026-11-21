// Data-driven allergy check (FRD v2.2 section 4). Pure: patient chart allergies vs a med's `allergyClasses`.

export interface AllergyPatient { allergies?: readonly string[] }
export interface AllergyMed { name: string; dose?: string; allergyClasses?: readonly string[] }
export interface AllergyHit { allergy: string; drug: string }

const norm = (s: string): string => s.trim().toLowerCase()

/** First chart allergy that matches one of the med's classes, or null. Never blocks: the caller shows an alert. */
export function checkAllergy(patient: AllergyPatient, med: AllergyMed): AllergyHit | null {
  const classes = (med.allergyClasses ?? []).map(norm).filter(Boolean)
  if (classes.length === 0) return null
  for (const allergy of patient.allergies ?? []) {
    if (classes.includes(norm(allergy))) return { allergy, drug: [med.name, med.dose].filter(Boolean).join(' ') }
  }
  return null
}

/** The synthetic order the Director injects to demo the alert (SIM_ADD_CONFLICT_ORDER). */
export const CONFLICT_ORDER = {
  name: 'Amoxicillin', dose: '250 mg', route: 'PO', allergyClasses: ['penicillin'],
} as const
