'use client'
// 08 5.12 S12 list. Client component because the delete result is shown above the table (FormSuccess) while the list refreshes.
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { DateTime } from '@/components/features/common/date-time'
import { EmptyState } from '@/components/features/common/empty-state'
import { FormSuccess } from '@/components/features/common/form-message'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { AdminFolderRow } from '@/lib/dto'
import { formatBytes } from '@/lib/format'
import { FOLDER_TEXT, folderDeletedDetailText } from '@/lib/messages'
import { DeleteFolderButton } from './delete-folder-button'

export function AdminFolderTableView({
  rows,
  notice,
  onDeleted,
}: {
  rows: readonly AdminFolderRow[]
  notice: string | null
  onDeleted: (r: { deletedFiles: number; revokedLinks: number }) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <FormSuccess>{notice}</FormSuccess>
      {rows.length === 0 ? (
        <EmptyState>{FOLDER_TEXT.emptyAdminAll}</EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名前</TableHead>
              <TableHead>メンバー数</TableHead>
              <TableHead>ファイル数</TableHead>
              <TableHead>使用容量</TableHead>
              <TableHead>有効リンク</TableHead>
              <TableHead>作成者</TableHead>
              <TableHead>更新日時</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell>{r.memberCount}</TableCell>
                <TableCell>{r.fileCount}</TableCell>
                <TableCell>{formatBytes(r.usedBytes)}</TableCell>
                <TableCell>{r.activeShareLinkCount}</TableCell>
                <TableCell>{r.createdBy.displayName}</TableCell>
                <TableCell>
                  <DateTime iso={r.updatedAt} />
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/folders/${r.id}`}>開く</Link>
                    </Button>
                    <DeleteFolderButton folderId={r.id} name={r.name} after="custom" size="sm" onDeleted={onDeleted} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

export function AdminFolderTable({ rows }: { rows: readonly AdminFolderRow[] }) {
  const router = useRouter()
  const [notice, setNotice] = useState<string | null>(null)
  return (
    <AdminFolderTableView
      rows={rows}
      notice={notice}
      onDeleted={(r) => {
        setNotice(folderDeletedDetailText(r)) // purgeFailed is not shown: the daily job retries (08 4.5)
        router.refresh()
      }}
    />
  )
}
