import { cache } from 'react'
import { notFound } from 'next/navigation'
import { MemberViewer } from '@/components/features/viewer/member-viewer'
import { zUuid } from '@/lib/schemas/common'
import { pageContext, runPage } from '@/server/page'
import { viewService } from '@/server/services/view'

const ROUTE = '/view/[fileId]'

// Shared by generateMetadata and the page within one request (React cache), so the file is read once.
// Only the header data is read: no ticket, no access log, no restriction evaluation (02 5.7.2).
const loadContext = cache(async (fileId: string) => {
  const ctx = await pageContext({ route: ROUTE, path: `/view/${encodeURIComponent(fileId)}`, auth: 'user' })
  if (!zUuid.safeParse(fileId).success) notFound() // never reaches the DB
  return runPage(ctx, () => viewService.getMemberViewContext(ctx, fileId))
})

export async function generateMetadata({ params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params
  const context = await loadContext(fileId)
  return { title: context.file.displayName } // 08 3.4: "{file name} | ファイル共有"
}

// 08 5.8 S08. The iframe src comes from MemberViewer, which calls viewOpenAsMember on mount.
export default async function ViewPage({ params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params
  const context = await loadContext(fileId)
  return <MemberViewer context={context} />
}
