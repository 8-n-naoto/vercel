import { notFound } from 'next/navigation'
import { UploadForm } from '@/components/features/files/upload-form'
import { Breadcrumbs } from '@/components/features/layout/breadcrumbs'
import { PageTitle } from '@/components/features/layout/page-title'
import { zUuid } from '@/lib/schemas/common'
import { pageContext, runPage } from '@/server/page'
import { filesService } from '@/server/services/files'

export const metadata = { title: 'アップロード' }

const ROUTE = '/folders/[folderId]/upload'

// 08 5.6 S06. Admin only: a member (FORBIDDEN), an unknown or deleted folder and a non-uuid id are all 404 (S06-5).
export default async function UploadPage({ params }: { params: Promise<{ folderId: string }> }) {
  const { folderId } = await params
  const ctx = await pageContext({ route: ROUTE, path: `/folders/${encodeURIComponent(folderId)}/upload`, auth: 'admin' })
  if (!zUuid.safeParse(folderId).success) notFound() // never reaches the DB (06 9.3)
  const uploadCtx = await runPage(ctx, () => filesService.getUploadContext(ctx, folderId))
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'フォルダ', href: '/folders' },
          { label: uploadCtx.folder.name, href: `/folders/${folderId}` },
          { label: 'アップロード' },
        ]}
      />
      <PageTitle>{`${uploadCtx.folder.name} にアップロード`}</PageTitle>
      <UploadForm folderId={folderId} ctx={uploadCtx} />
    </>
  )
}
