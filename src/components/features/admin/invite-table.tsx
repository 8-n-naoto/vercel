'use client'
// 08 5.10 S10 list. Client component because a failed revoke is shown above the table (FormError) while the list refreshes.
import { useState } from 'react'
import { EmptyState } from '@/components/features/common/empty-state'
import { FormError } from '@/components/features/common/form-message'
import { StatusBadge } from '@/components/features/common/status-badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { InviteRow } from '@/lib/dto'
import type { AppErrorShape } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { USER_ROLE_LABELS } from '@/lib/messages'
import { RevokeInviteButton } from './revoke-invite-button'

export const INVITE_EMPTY_TEXT = '招待はありません'

export function InviteTableView({
  items,
  revokeError,
  onRevokeError,
}: {
  items: readonly InviteRow[]
  revokeError: AppErrorShape | null
  onRevokeError: (e: AppErrorShape) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <FormError error={revokeError} />
      {items.length === 0 ? (
        <EmptyState>{INVITE_EMPTY_TEXT}</EmptyState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>宛先</TableHead>
              <TableHead>役割</TableHead>
              <TableHead>状態</TableHead>
              <TableHead>有効期限</TableHead>
              <TableHead>発行者</TableHead>
              <TableHead>発行日時</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => (
              <TableRow key={i.id}>
                <TableCell>{i.email}</TableCell>
                <TableCell>{USER_ROLE_LABELS[i.role]}</TableCell>
                <TableCell>
                  <StatusBadge kind="invite" value={i.state} />
                </TableCell>
                <TableCell>{formatDateTime(i.expiresAt)}</TableCell>
                <TableCell>{i.createdBy.displayName}</TableCell>
                <TableCell>{formatDateTime(i.createdAt)}</TableCell>
                <TableCell>{i.state === 'open' ? <RevokeInviteButton inviteId={i.id} email={i.email} onError={onRevokeError} /> : null}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

export function InviteTable({ items }: { items: readonly InviteRow[] }) {
  const [revokeError, setRevokeError] = useState<AppErrorShape | null>(null)
  return <InviteTableView items={items} revokeError={revokeError} onRevokeError={setRevokeError} />
}
