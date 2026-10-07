// 06 9.14. STUB until WP-2.3: always an empty page, no DB access. The real implementation must call requireAdmin and compute
// `state` with inviteState() (07 11.3).
import 'server-only'
import type { InviteRow, Page } from '@/lib/dto'
import type { InviteState } from '@/lib/domain'
import type { ServiceContext } from '@/server/actions/define-action'

async function listInvites(_ctx: ServiceContext, _filter: { state?: InviteState }, page: { page: number; pageSize: number }): Promise<Page<InviteRow>> {
  return { items: [], page: page.page, pageSize: page.pageSize, total: 0 }
}

export const adminService = { listInvites }
