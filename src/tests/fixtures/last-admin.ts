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
