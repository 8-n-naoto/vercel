// 08 5.5 members tab table (Server Component). Members see display names only; admins also see email, added date and [外す].
import { DateTime } from '@/components/features/common/date-time'
import { EmptyState } from '@/components/features/common/empty-state'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { MemberList } from '@/lib/dto'
import { FOLDER_TEXT } from '@/lib/messages'
import { RemoveMemberButton } from './remove-member-button'

export function MemberTable({ folderId, list }: { folderId: string; list: MemberList }) {
  if (list.members.length === 0) {
    return <EmptyState>{list.access === 'admin' ? `${FOLDER_TEXT.membersEmpty}。${FOLDER_TEXT.membersEmptyAdminSuffix}` : FOLDER_TEXT.membersEmpty}</EmptyState>
  }
  if (list.access === 'member') {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>表示名</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.members.map((m) => (
            <TableRow key={m.userId}>
              <TableCell>{m.displayName}</TableCell>
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
          <TableHead>メール</TableHead>
          <TableHead>追加日時</TableHead>
          <TableHead>操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {list.members.map((m) => (
          <TableRow key={m.userId}>
            <TableCell>
              {m.displayName}
              {m.disabled ? '（無効）' : ''}
            </TableCell>
            <TableCell>{m.email}</TableCell>
            <TableCell>
              <DateTime iso={m.addedAt} />
            </TableCell>
            <TableCell>
              <RemoveMemberButton folderId={folderId} userId={m.userId} displayName={m.displayName} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
