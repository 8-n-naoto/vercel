'use client'
// 08 5.5: [外す] -> ConfirmDialog (C-02) -> membersRemove. NOT_FOUND (already removed) is treated as done: the list is just refreshed.
import { useRouter } from 'next/navigation'
import { membersRemove } from '@/app/_actions/members'
import { ConfirmDialog } from '@/components/features/common/confirm-dialog'
import { Button } from '@/components/ui/button'
import type { ActionResult } from '@/lib/errors'
import { removeMemberConfirmText } from '@/lib/messages'

/** Pure: a NOT_FOUND result is reported as success so the dialog closes (06 6.5: the second call is NOT_FOUND). */
export function treatNotFoundAsDone(r: ActionResult<null>): ActionResult<null> {
  return !r.ok && r.error.code === 'NOT_FOUND' ? { ok: true, data: null } : r
}

export function RemoveMemberButton({ folderId, userId, displayName }: { folderId: string; userId: string; displayName: string }) {
  const router = useRouter()
  return (
    <ConfirmDialog
      trigger={
        <Button type="button" variant="outline" size="sm">
          外す
        </Button>
      }
      title="メンバーを外す"
      description={removeMemberConfirmText(displayName)}
      confirmLabel="外す"
      destructive
      onConfirm={async () => treatNotFoundAsDone(await membersRemove({ folderId, userId }))}
      onDone={() => router.refresh()}
    />
  )
}
