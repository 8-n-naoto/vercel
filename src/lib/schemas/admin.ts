// Input schemas of the admin Actions (06 5.1 / 5.2 / 5.3). Shared by client and server.
import { z } from 'zod'
import { zEmail, zUserRole, zUuid } from './common'

export const adminCreateInviteInput = z.object({ email: zEmail, role: zUserRole }).strict()
export type AdminCreateInviteInput = z.input<typeof adminCreateInviteInput>

export const adminRevokeInviteInput = z.object({ inviteId: zUuid }).strict()
export type AdminRevokeInviteInput = z.input<typeof adminRevokeInviteInput>

export const adminIssuePasswordResetInput = z.object({ userId: zUuid }).strict()
export type AdminIssuePasswordResetInput = z.input<typeof adminIssuePasswordResetInput>
