import Link from 'next/link'
import { notFound } from 'next/navigation'
import { EmptyState } from '@/components/features/common/empty-state'
import { FormSuccess } from '@/components/features/common/form-message'
import { DeleteFileButton } from '@/components/features/files/delete-file-button'
import { FileInfoForm } from '@/components/features/files/file-info-form'
import { MemberFileCard } from '@/components/features/files/member-file-card'
import { RestrictionsForm } from '@/components/features/files/restrictions-form'
import { Breadcrumbs } from '@/components/features/layout/breadcrumbs'
import { PageTitle } from '@/components/features/layout/page-title'
import { Button } from '@/components/ui/button'
import { FILE_TEXT } from '@/lib/messages'
import { zUuid } from '@/lib/schemas/common'
import { pageContext, runPage } from '@/server/page'
import { filesService } from '@/server/services/files'

export const metadata = { title: 'ファイル詳細' }

const ROUTE = '/folders/[folderId]/files/[fileId]'

// 08 5.7 S07. What is shown is decided here from `access` of files.getDetail (not by hiding in the client).
// A folder/file pair that does not match, an id that is not a uuid, and a file a member may not see are all 404.
export default async function FileDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ folderId: string; fileId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { folderId, fileId } = await params
  const sp = await searchParams
  const uploaded = (Array.isArray(sp.uploaded) ? sp.uploaded[0] : sp.uploaded) === '1'
  const path = `/folders/${encodeURIComponent(folderId)}/files/${encodeURIComponent(fileId)}${uploaded ? '?uploaded=1' : ''}`
  const ctx = await pageContext({ route: ROUTE, path, auth: 'user' })
  if (!zUuid.safeParse(folderId).success || !zUuid.safeParse(fileId).success) notFound() // never reaches the DB (06 9.3)
  const detail = await runPage(ctx, () => filesService.getDetail(ctx, fileId))
  if (detail.file.folderId !== folderId) notFound()

  const crumbs = (name: string) => [
    { label: 'フォルダ', href: '/folders' },
    { label: detail.file.folderName, href: `/folders/${folderId}` },
    { label: name },
  ]

  if (detail.access === 'member') {
    return (
      <>
        <Breadcrumbs items={crumbs(detail.file.displayName)} />
        <PageTitle>{detail.file.displayName}</PageTitle>
        <MemberFileCard file={detail.file} />
      </>
    )
  }

  const file = detail.file
  return (
    <>
      <Breadcrumbs items={crumbs(file.displayName)} />
      <PageTitle
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href={`/view/${file.id}`}>プレビュー</Link>
            </Button>
            <DeleteFileButton folderId={folderId} fileId={file.id} displayName={file.displayName} />
          </div>
        }
      >
        {file.displayName}
      </PageTitle>
      {uploaded ? <FormSuccess>{FILE_TEXT.uploaded}</FormSuccess> : null}
      <div className="mt-6 flex flex-col gap-10">
        <FileInfoForm fileId={file.id} file={file} />
        <RestrictionsForm fileId={file.id} restrictions={file.restrictions} displayState={file.displayState} />
        {/* The share link table, [+ 公開リンク発行] (D03) and D04 arrive with WP-6.3; only the frame and the empty text exist here. */}
        <section aria-labelledby="links-heading" className="flex flex-col gap-3">
          <h2 id="links-heading" className="text-lg font-semibold">
            {FILE_TEXT.linksHeading}
          </h2>
          <EmptyState>{FILE_TEXT.linksEmpty}</EmptyState>
        </section>
      </div>
    </>
  )
}
