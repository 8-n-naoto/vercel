import { AdminFolderTable } from '@/components/features/folders/admin-folder-table'
import { CreateFolderDialog } from '@/components/features/folders/create-folder-dialog'
import { Breadcrumbs } from '@/components/features/layout/breadcrumbs'
import { PageTitle } from '@/components/features/layout/page-title'
import { pageContext, runPage } from '@/server/page'
import { foldersService } from '@/server/services/folders'

export const metadata = { title: 'フォルダ（全体）' }

const PATH = '/admin/folders'

// 08 5.12 S12. All folders with their size; a non-admin gets 404 from pageContext (FORBIDDEN -> notFound, S12-3).
export default async function AdminFoldersPage() {
  const ctx = await pageContext({ route: PATH, path: PATH, auth: 'admin' })
  const rows = await runPage(ctx, () => foldersService.listFolders(ctx))
  return (
    <>
      <Breadcrumbs items={[{ label: '管理' }, { label: 'フォルダ（全体）' }]} />
      <PageTitle actions={<CreateFolderDialog />}>フォルダ（全体）</PageTitle>
      <AdminFolderTable rows={rows} />
    </>
  )
}
