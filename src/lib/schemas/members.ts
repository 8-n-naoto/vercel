// Input schemas of the member Actions (06 6.4 / 6.5). Shared by client and server; the backend must not change them.
import { z } from 'zod'
import { zUuid } from './common'

export const membersAddInput = z
  .object({ folderId: zUuid, userIds: z.array(zUuid).min(1).max(50) })
  .strict()
  .refine((v) => new Set(v.userIds).size === v.userIds.length, { path: ['userIds'], message: 'duplicate' })

export const membersRemoveInput = z.object({ folderId: zUuid, userId: zUuid }).strict()

export type MembersAddInput = z.input<typeof membersAddInput>
export type MembersRemoveInput = z.input<typeof membersRemoveInput>
