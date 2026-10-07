// 08 5.4 S04 list (Server Component). Rows come in the server order (name ascending, 06 2.1).
import Link from 'next/link'
import { DateTime } from '@/components/features/common/date-time'
import { EmptyState } from '@/components/features/common/empty-state'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { FolderSummary } from '@/lib/dto'
import { FOLDER_TEXT } from '@/lib/messages'

export function FolderList({ folders, isAdmin }: { folders: readonly FolderSummary[]; isAdmin: boolean }) {
  if (folders.length === 0) return <EmptyState>{isAdmin ? FOLDER_TEXT.emptyAdmin : FOLDER_TEXT.emptyMember}</EmptyState>
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>名前</TableHead>
          <TableHead>説明</TableHead>
          <TableHead>ファイル数</TableHead>
          <TableHead>更新日時</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {folders.map((f) => (
          <TableRow key={f.id}>
            <TableCell>
              <Link href={`/folders/${f.id}`} className="font-medium underline underline-offset-4">
                {f.name}
              </Link>
            </TableCell>
            {/* One line with an ellipsis; the title attribute holds the whole text. Plain text, never HTML. */}
            <TableCell className="max-w-xs truncate" title={f.description}>
              {f.description}
            </TableCell>
            <TableCell>{f.fileCount}</TableCell>
            <TableCell>
              <DateTime iso={f.updatedAt} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
