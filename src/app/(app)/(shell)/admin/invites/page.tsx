import { InviteForm } from '@/components/features/admin/invite-form'
import { InviteStateTabs, parseInviteState } from '@/components/features/admin/invite-state-tabs'
import { InviteTable } from '@/components/features/admin/invite-table'
import { Pagination, parsePageParam } from '@/components/features/common/pagination'
import { Breadcrumbs } from '@/components/features/layout/breadcrumbs'
import { PageTitle } from '@/components/features/layout/page-title'
import { pageContext, runPage } from '@/server/page'
import { adminService } from '@/server/services/admin'

export const metadata = { title: '招待' }

const PATH = '/admin/invites'
const PAGE_SIZE = 50

// 08 5.10 S10. An invalid state parameter means all; the page number is clamped by parsePageParam (06 1.5).
export default async function AdminInvitesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const state = parseInviteState(sp.state)
  const page = parsePageParam(sp.page)
  const ctx = await pageContext({ route: PATH, path: PATH, auth: 'admin' })
  const list = await runPage(ctx, () => adminService.listInvites(ctx, { state }, { page, pageSize: PAGE_SIZE }))
  return (
    <>
      <Breadcrumbs items={[{ label: '管理' }, { label: '招待' }]} />
      <PageTitle>招待</PageTitle>
      <InviteForm />
      <InviteStateTabs current={state} pathname={PATH} />
      <InviteTable items={list.items} />
      <div className="mt-4">
        <Pagination page={list.page} pageSize={list.pageSize} total={list.total} pathname={PATH} query={state ? { state } : {}} />
      </div>
    </>
  )
}
