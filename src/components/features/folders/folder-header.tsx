// 08 5.5 common header: name, description and (admin only) the upload link. The description is plain text, never interpreted as HTML.
import Link from 'next/link'
import { PageTitle } from '@/components/features/layout/page-title'
import { Button } from '@/components/ui/button'
import type { FolderDetail } from '@/lib/dto'

export function FolderHeader({ detail }: { detail: Pick<FolderDetail, 'id' | 'name' | 'description' | 'access'> }) {
  return (
    <>
      <PageTitle
        actions={
          detail.access === 'admin' ? (
            <Button asChild>
              <Link href={`/folders/${detail.id}/upload`}>アップロード</Link>
            </Button>
          ) : null
        }
      >
        {detail.name}
      </PageTitle>
      {detail.description ? <p className="mb-4 whitespace-pre-wrap text-sm text-muted-foreground">{detail.description}</p> : null}
    </>
  )
}
