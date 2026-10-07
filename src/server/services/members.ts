/* eslint-disable @typescript-eslint/no-unused-vars -- STUB: WP-3.3 replaces these; the parameters keep the 06 signature */
// Member RSC reads (06 9.5 / 9.6).
// STUB: WP-3.3 replaces these with real queries. Signatures follow 06.
import 'server-only'
import type { MemberCandidate, MemberList } from '@/lib/dto'
import { appError } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'

/** 06 9.5. */
async function list(_ctx: ServiceContext, _folderId: string): Promise<MemberList> {
  throw appError('NOT_FOUND', 'common.not_found')
}

/** 06 9.6 (admin only; the page calls it only when access is 'admin'). */
async function listCandidates(_ctx: ServiceContext, _folderId: string): Promise<MemberCandidate[]> {
  throw appError('NOT_FOUND', 'common.not_found')
}

export const membersService = { list, listCandidates }
