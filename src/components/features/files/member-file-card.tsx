// 08 5.7 member view of S07 (Server Component). Only name, size, update time, download flag and [open]; no restrictions, links, delete or preview.
import Link from 'next/link'
import { DateTime } from '@/components/features/common/date-time'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { MemberFileDetail } from '@/lib/dto'
import { formatBytes } from '@/lib/format'

export function MemberFileCard({ file }: { file: MemberFileDetail }) {
  return (
    <Card className="sm:max-w-xl">
      <CardContent className="flex flex-col gap-4 pt-4">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">サイズ</dt>
          <dd>{formatBytes(file.sizeBytes)}</dd>
          <dt className="text-muted-foreground">更新日時</dt>
          <dd>
            <DateTime iso={file.updatedAt} />
          </dd>
          <dt className="text-muted-foreground">ダウンロード</dt>
          <dd>{file.downloadAllowed ? '可' : '不可'}</dd>
        </dl>
        <div>
          <Button asChild>
            <Link href={`/view/${file.id}`}>開く</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
