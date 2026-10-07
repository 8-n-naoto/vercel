// Test vectors for decideAdminChange. Copied one row per case from 07 7 (LA-01..LA-10, IDs preserved).
import type { AdminChangeInput, AdminChangeResult } from '@/server/authz/last-admin'

const A = 'A'
const B = 'B'
const C = 'C'
const adm = { role: 'admin', disabled: false } as const
const adminDisabled = { role: 'admin', disabled: true } as const
const usr = { role: 'user', disabled: false } as const

const c = (id: string, targetId: string, target: AdminChangeInput['target'], op: 'disable' | 'demote', activeAdminIds: string[], expected: AdminChangeResult) =>
  ({ id, input: { actorId: A, targetId, target, op, activeAdminIds }, expected })

export const LA_CASES: { id: string; input: AdminChangeInput; expected: AdminChangeResult }[] = [
  c('LA-01', A, adm, 'disable', [A, B], 'self'),
  c('LA-02', A, adm, 'demote', [A], 'self'),
  c('LA-03', 'X', null, 'disable', [A], 'not_found'),
  c('LA-04', B, adm, 'disable', [A, B], 'ok'),
  c('LA-05', B, adm, 'demote', [A, B], 'ok'),
  c('LA-06', C, usr, 'disable', [A], 'ok'),
  c('LA-07', C, usr, 'demote', [A], 'noop'),
  c('LA-08', B, adm, 'disable', [B], 'last_admin'),
  c('LA-09', B, adminDisabled, 'disable', [A], 'noop'),
  c('LA-10', B, adminDisabled, 'demote', [A], 'ok'),
]

// Additions outside 07 (T-018, F-003 proposal 9). X-marked IDs never collide with 07 IDs.
export const LA_X_CASES: typeof LA_CASES = [
  // an enabled admin target that is missing from activeAdminIds (stale list) is not treated as the last admin
  c('LA-X01', B, adm, 'disable', [A], 'ok'),
  c('LA-X02', B, adm, 'demote', [A], 'ok'),
  // the only active admin is the target and the list has one entry: last_admin for both operations
  c('LA-X03', B, adm, 'demote', [B], 'last_admin'),
  // self check wins over everything else, even for a missing target
  c('LA-X04', A, null, 'disable', [], 'self'),
]
