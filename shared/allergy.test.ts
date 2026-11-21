import { describe, it, expect } from 'vitest'
import { checkAllergy } from './allergy'

describe('checkAllergy', () => {
  const p = { allergies: ['Penicillin'] }
  it('flags a med whose class matches a chart allergy', () => {
    expect(checkAllergy(p, { name: 'Amoxicillin', dose: '250 mg', allergyClasses: ['penicillin'] }))
      .toEqual({ allergy: 'Penicillin', drug: 'Amoxicillin 250 mg' })
  })
  it('returns null with no classes, no allergies or no overlap', () => {
    expect(checkAllergy(p, { name: 'Metformin', dose: '500 mg' })).toBeNull()
    expect(checkAllergy({ allergies: [] }, { name: 'Amoxicillin', dose: '250 mg', allergyClasses: ['penicillin'] })).toBeNull()
    expect(checkAllergy(p, { name: 'Bactrim', dose: '1 tab', allergyClasses: ['sulfa'] })).toBeNull()
  })
  it('matches case-insensitively', () => {
    expect(checkAllergy({ allergies: ['SULFA'] }, { name: 'Bactrim', dose: '1 tab', allergyClasses: ['Sulfa'] })?.allergy).toBe('SULFA')
  })
})
