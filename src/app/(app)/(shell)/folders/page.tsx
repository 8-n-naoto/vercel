import { CreateFolderDialog } from '@/components/features/folders/create-folder-dialog'
import { FolderList } from '@/components/features/folders/folder-list'
import { FormSuccess } from '@/components/features/common/form-message'
import { Breadcrumbs } from '@/components/features/layout/breadcrumbs'
import { PageTitle } from '@/components/features/layout/page-title'
import { FOLDER_TEXT } from '@/lib/messages'
import { pageContext, runPage } from '@/server/page'
import { foldersService } from '@/server/services/folders'

export const metadata = { title: 'フォルダ' }

const PATH = '/folders'

// 08 5.4 S04. Members see the folders they belong to, admins see all (the service decides; `isAdmin` only switches the UI).
export default async function FoldersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const ctx = await pageContext({ route: PATH, path: PATH, auth: 'user' })
  const folders = await runPage(ctx, () => foldersService.listVisible(ctx))
  const isAdmin = ctx.actor?.role === 'admin'
  const deleted = (Array.isArray(sp.deleted) ? sp.deleted[0] : sp.deleted) === '1'
  return (
    <>
      <Breadcrumbs items={[{ label: 'フォルダ' }]} />
      <PageTitle actions={isAdmin ? <CreateFolderDialog /> : null}>フォルダ</PageTitle>
      {deleted ? (
        <div className="mb-4">
          <FormSuccess>{FOLDER_TEXT.deleted}</FormSuccess>
        </div>
      ) : null}
      <FolderList folders={folders} isAdmin={isAdmin} />
    </>
  )
}
