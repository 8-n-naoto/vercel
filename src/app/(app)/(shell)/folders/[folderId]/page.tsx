import { notFound } from 'next/navigation'
import { parseLogPeriod, periodFrom } from '@/components/features/access-logs/access-log-filter'
import { AccessLogTab } from '@/components/features/access-logs/access-log-tab'
import { FileTable } from '@/components/features/files/file-table'
import { FolderHeader } from '@/components/features/folders/folder-header'
import { FolderSettings } from '@/components/features/folders/folder-settings-form'
import { FolderTabs, parseFolderTab } from '@/components/features/folders/folder-tabs'
import { Breadcrumbs } from '@/components/features/layout/breadcrumbs'
import { AddMembersDialog } from '@/components/features/members/add-members-dialog'
import { MemberTable } from '@/components/features/members/member-table'
import { FOLDER_TEXT } from '@/lib/messages'
import { parseAccessLogFilter, parsePageNumber } from '@/lib/schemas/access-logs'
import { zUuid } from '@/lib/schemas/common'
import { pageContext, runPage } from '@/server/page'
import { accessLogService } from '@/server/services/access-logs'
import { filesService, parseFileSort } from '@/server/services/files'
import { foldersService } from '@/server/services/folders'
import { membersService } from '@/server/services/members'

// TODO: the title should be the folder name (08 9.4); it needs the detail read once more, so it stays fixed until a cached read exists.
export const metadata = { title: 'フォルダ' }

const ROUTE = '/folders/[folderId]'

// 08 5.5 S05. Which tabs exist and what they show is decided here from `access` of folders.getDetail (not by hiding in the client).
// A folder the user cannot see, a deleted one and an id that is not a uuid are all 404 (S05-3).
export default async function FolderPage({
  params,
  searchParams,
}: {
  params: Promise<{ folderId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { folderId } = await params
  const sp = await searchParams
  const rawTab = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab
  const path = `/folders/${encodeURIComponent(folderId)}${rawTab ? `?tab=${encodeURIComponent(rawTab)}` : ''}`
  const ctx = await pageContext({ route: ROUTE, path, auth: 'user' })
  if (!zUuid.safeParse(folderId).success) notFound() // never reaches the DB (06 9.3)
  const detail = await runPage(ctx, () => foldersService.getDetail(ctx, folderId))
  const tab = parseFolderTab(sp.tab, detail.access)

  let body: React.ReactNode
  if (tab === 'files') {
    const sort = parseFileSort(sp.sort)
    const list = await runPage(ctx, () => filesService.listInFolder(ctx, folderId, sort))
    body = <FileTable folderId={folderId} list={list} sort={sort} />
  } else if (tab === 'members') {
    const [list, candidates] = await runPage(ctx, () =>
      Promise.all([membersService.list(ctx, folderId), detail.access === 'admin' ? membersService.listCandidates(ctx, folderId) : Promise.resolve(null)]),
    )
    body = (
      <div className="flex flex-col gap-4">
        {candidates !== null ? <AddMembersDialog folderId={folderId} candidates={candidates} /> : null}
        <MemberTable folderId={folderId} list={list} />
        <p className="text-sm text-muted-foreground">{FOLDER_TEXT.membersNote}</p>
      </div>
    )
  } else if (tab === 'logs') {
    // Only an admin reaches this branch (parseFolderTab). Invalid filter values are dropped to the defaults (06 9.7).
    const period = parseLogPeriod(sp.period)
    const filter = parseAccessLogFilter({ fileId: sp.file, result: sp.result, via: sp.via, from: periodFrom(period, ctx.now) })
    const page = parsePageNumber(sp.page)
    const [list, fileList] = await runPage(ctx, () =>
      Promise.all([accessLogService.listForFolder(ctx, folderId, filter, { page }), filesService.listInFolder(ctx, folderId, 'name_asc')]),
    )
    body = (
      <AccessLogTab
        folderId={folderId}
        list={list}
        files={fileList.files.map((f) => ({ id: f.id, displayName: f.displayName }))}
        period={period}
        file={filter.fileId ?? ''}
        result={filter.result ?? ''}
        via={filter.via ?? ''}
      />
    )
  } else {
    body = <FolderSettings folderId={folderId} name={detail.name} description={detail.description} />
  }

  return (
    <>
      <Breadcrumbs items={[{ label: 'フォルダ', href: '/folders' }, { label: detail.name }]} />
      <FolderHeader detail={detail} />
      <FolderTabs folderId={folderId} current={tab} access={detail.access} />
      {body}
    </>
  )
}
