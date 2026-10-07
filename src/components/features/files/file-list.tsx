// 08 5.5 files tab (Server Component). WP-3.4 provides the frame, the empty states and the tables; WP-4.4 adds the sort select and completes it.
// Members get a table without state, link count and detail link (S05-2): those columns are not rendered, not just hidden.
import Link from 'next/link'
import { DateTime } from '@/components/features/common/date-time'
import { EmptyState } from '@/components/features/common/empty-state'
import { StatusBadge } from '@/components/features/common/status-badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { FileList as FileListDto } from '@/lib/dto'
import { formatBytes } from '@/lib/format'
import { FOLDER_TEXT } from '@/lib/messages'

export function FileList({ list }: { list: FileListDto }) {
  if (list.files.length === 0) return <EmptyState>{list.access === 'admin' ? FOLDER_TEXT.filesEmptyAdmin : FOLDER_TEXT.filesEmptyMember}</EmptyState>
  if (list.access === 'member') {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>表示名</TableHead>
            <TableHead>サイズ</TableHead>
            <TableHead>更新日時</TableHead>
            <TableHead>操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.files.map((f) => (
            <TableRow key={f.id}>
              <TableCell className="font-medium">{f.displayName}</TableCell>
              <TableCell>{formatBytes(f.sizeBytes)}</TableCell>
              <TableCell>
                <DateTime iso={f.updatedAt} />
              </TableCell>
              <TableCell>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/view/${f.id}`}>開く</Link>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>表示名</TableHead>
          <TableHead>状態</TableHead>
          <TableHead>公開リンク</TableHead>
          <TableHead>サイズ</TableHead>
          <TableHead>更新日時</TableHead>
          <TableHead>操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {list.files.map((f) => (
          <TableRow key={f.id}>
            <TableCell className="font-medium">{f.displayName}</TableCell>
            <TableCell>
              <StatusBadge kind="file" value={f.displayState} viewStartsAt={f.viewStartsAt} />
            </TableCell>
            <TableCell>{`${f.activeShareLinkCount} 本`}</TableCell>
            <TableCell>{formatBytes(f.sizeBytes)}</TableCell>
            <TableCell>
              <DateTime iso={f.updatedAt} />
            </TableCell>
            <TableCell>
              <div className="flex gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href={`/view/${f.id}`}>開く</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/folders/${f.folderId}/files/${f.id}`}>詳細</Link>
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
