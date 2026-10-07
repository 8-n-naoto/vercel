'use server'
// 06 5.1 / 5.2. STUBS until WP-2.3: the handlers only fix the signatures for S10 and throw the error codes of the S10-2 display path.
import { appError } from '@/lib/errors'
import { adminCreateInviteInput, adminRevokeInviteInput } from '@/lib/schemas/admin'
import { defineAction } from '@/server/actions/define-action'

export const adminCreateInvite = defineAction({
  name: 'admin.createInvite',
  auth: 'admin',
  input: adminCreateInviteInput,
  rateLimit: [],
  handler: async (): Promise<{ inviteId: string; inviteUrl: string; expiresAt: string }> => {
    throw appError('CONFLICT', 'invite.email_registered')
  },
})

export const adminRevokeInvite = defineAction({
  name: 'admin.revokeInvite',
  auth: 'admin',
  input: adminRevokeInviteInput,
  rateLimit: [],
  handler: async (): Promise<void> => {
    throw appError('NOT_FOUND', 'common.not_found')
  },
})
