'use server'
// 06 6.1 / 6.2 / 6.3.
// STUB: WP-3.3 replaces the handlers with foldersService calls (transactions, audit log, revalidatePath). Signatures follow 06.
import { appError } from '@/lib/errors'
import { foldersCreateInput, foldersDeleteInput, foldersUpdateInput } from '@/lib/schemas/folders'
import { defineAction } from '@/server/actions/define-action'

export const foldersCreate = defineAction({
  name: 'folders.create',
  auth: 'admin',
  input: foldersCreateInput,
  rateLimit: [],
  handler: async (): Promise<{ folderId: string }> => {
    throw appError('NOT_FOUND', 'common.not_found') // STUB: WP-3.3 replaces
  },
})

export const foldersUpdate = defineAction({
  name: 'folders.update',
  auth: 'admin',
  input: foldersUpdateInput,
  rateLimit: [],
  handler: async (): Promise<void> => {
    throw appError('NOT_FOUND', 'common.not_found') // STUB: WP-3.3 replaces
  },
})

export const foldersDelete = defineAction({
  name: 'folders.delete',
  auth: 'admin',
  input: foldersDeleteInput,
  rateLimit: [],
  handler: async (): Promise<{ deletedFiles: number; revokedLinks: number; purgeFailed: number }> => {
    throw appError('NOT_FOUND', 'common.not_found') // STUB: WP-3.3 replaces
  },
})
