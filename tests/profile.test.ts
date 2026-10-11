import { describe, expect, it } from 'vitest'
import { emptyProfile, validateProfile, profilePayload } from '../src/lib/profile'

describe('profile input', () => {
  it('starts without inferred qualifications or preferences', () => {
    const value = profilePayload({ ...emptyProfile(), full_name: 'Owner', contact_email: 'owner@example.invalid' })
    expect(value.skills).toBeNull()
    expect(value.work_modes).toBeNull()
    expect(value.salary_min).toBeNull()
    expect(value.availability).toBeNull()
  })
  it('rejects invalid contact information, unsafe URLs and reversed salary ranges', () => {
    const errors = validateProfile({ ...emptyProfile(), full_name: ' ', contact_email: 'bad', portfolio_url: 'javascript:alert(1)', salary_min: '200', salary_max: '100' })
    expect(errors.full_name).toBeTruthy()
    expect(errors.contact_email).toBeTruthy()
    expect(errors.portfolio_url).toBeTruthy()
    expect(errors.salary_max).toBeTruthy()
    expect(errors.salary_currency).toBeTruthy()
    expect(errors.salary_period).toBeTruthy()
  })
})
