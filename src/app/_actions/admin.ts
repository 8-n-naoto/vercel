'use server'
// 06 5.1 / 5.2 / 5.3. The RSC read admin.listInvites (9.14) lives in services/admin.ts.
import { revalidatePath } from 'next/cache'
import { adminCreateInviteInput, adminIssuePasswordResetInput, adminRevokeInviteInput } from '@/lib/schemas/admin'
import { defineAction } from '@/server/actions/define-action'
import * as adminService from '@/server/services/admin'

export const adminCreateInvite = defineAction({
  name: 'admin.createInvite',
  auth: 'admin',
  input: adminCreateInviteInput,
  rateLimit: [],
  handler: async (ctx, input) => {
    const out = await adminService.createInvite(ctx, input)
    revalidatePath('/admin/invites')
    return out
  },
})

export const adminRevokeInvite = defineAction({
  name: 'admin.revokeInvite',
  auth: 'admin',
  input: adminRevokeInviteInput,
  rateLimit: [],
  handler: async (ctx, input): Promise<void> => {
    await adminService.revokeInvite(ctx, input)
    revalidatePath('/admin/invites')
  },
})

export const adminIssuePasswordReset = defineAction({
  name: 'admin.issuePasswordReset',
  auth: 'admin',
  input: adminIssuePasswordResetInput,
  rateLimit: [],
  handler: async (ctx, input) => {
    const out = await adminService.issuePasswordReset(ctx, input)
    revalidatePath('/admin/users')
    return out
  },
})
