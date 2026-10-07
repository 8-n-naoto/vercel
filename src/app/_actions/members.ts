'use server'
// 06 6.4 / 6.5. (06 1.1 lists these under folders.ts; the split keeps each file small. The export names follow the action names.)
// STUB: WP-3.3 replaces the handlers with membersService calls. Signatures follow 06.
import { appError } from '@/lib/errors'
import { membersAddInput, membersRemoveInput } from '@/lib/schemas/members'
import { defineAction } from '@/server/actions/define-action'

export const membersAdd = defineAction({
  name: 'members.add',
  auth: 'admin',
  input: membersAddInput,
  rateLimit: [],
  handler: async (): Promise<{ added: number; skipped: number }> => {
    throw appError('NOT_FOUND', 'common.not_found') // STUB: WP-3.3 replaces
  },
})

export const membersRemove = defineAction({
  name: 'members.remove',
  auth: 'admin',
  input: membersRemoveInput,
  rateLimit: [],
  handler: async (): Promise<void> => {
    throw appError('NOT_FOUND', 'common.not_found') // STUB: WP-3.3 replaces
  },
})
