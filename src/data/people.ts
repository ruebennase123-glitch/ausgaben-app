import type { Person, PersonId, Settings } from '../types'

/** All payers selectable for entries, fixed costs and goal deposits: both partners + joint account. */
export function payers(s: Settings): Person[] {
  return [s.persons[0], s.persons[1], s.joint]
}

export function payerById(s: Settings, id: PersonId): Person {
  return payers(s).find((p) => p.id === id) ?? s.persons[0]
}
