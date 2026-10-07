/* eslint-disable @typescript-eslint/no-unused-vars -- STUB: WP-3.3 replaces these; the parameters keep the 06 signature */
// File RSC reads (06 9.4 ...). Only listInFolder exists so far.
// STUB: WP-4.x replaces this with the real query. Signature follows 06.
import 'server-only'
import type { FileList } from '@/lib/dto'
import { appError } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'

export const FILE_SORTS = ['updated_desc', 'name_asc', 'size_desc'] as const
export type FileSort = (typeof FILE_SORTS)[number]

/** 06 9.4: an invalid or missing value is 'updated_desc'. */
export function parseFileSort(v: string | string[] | undefined): FileSort {
  const s = Array.isArray(v) ? v[0] : v
  return FILE_SORTS.find((x) => x === s) ?? 'updated_desc'
}

async function listInFolder(_ctx: ServiceContext, _folderId: string, _sort: FileSort): Promise<FileList> {
  throw appError('NOT_FOUND', 'common.not_found')
}

export const filesService = { listInFolder }
