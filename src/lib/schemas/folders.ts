// Input schemas of the folder Actions (06 6.1 / 6.2 / 6.3). Shared by client and server; the backend must not change them.
import { z } from 'zod'
import { zTrimmed, zUuid } from './common'

export const foldersCreateInput = z
  .object({
    name: zTrimmed(1, 100),
    description: z.string().trim().max(500).default(''),
  })
  .strict()

export const foldersUpdateInput = z
  .object({ folderId: zUuid, name: zTrimmed(1, 100), description: z.string().trim().max(500) })
  .strict()

export const foldersDeleteInput = z.object({ folderId: zUuid, confirmName: z.string().trim().min(1).max(100) }).strict()

export type FoldersCreateInput = z.input<typeof foldersCreateInput>
export type FoldersUpdateInput = z.input<typeof foldersUpdateInput>
export type FoldersDeleteInput = z.input<typeof foldersDeleteInput>
