'use client'
// 08 5.10: [取り消し] -> ConfirmDialog (C-06) -> adminRevokeInvite -> router.refresh().
import { useRouter } from 'next/navigation'
import { adminRevokeInvite } from '@/app/_actions/admin'
import { ConfirmDialog } from '@/components/features/common/confirm-dialog'
import { Button } from '@/components/ui/button'
import type { ActionResult, AppErrorShape } from '@/lib/errors'

/** 08 9.4 C-06 */
export const revokeConfirmText = (email: string): string => `${email} への招待を取り消します。この招待 URL は使えなくなります。`

/**
 * Runs the revoke Action. A failure (invite.already_used = CONFLICT, or the row vanished = NOT_FOUND) is reported to the caller
 * for display and the list is refreshed so the row shows its real state (08 5.10).
 */
export async function revokeInviteAndReport(
  inviteId: string,
  deps: { action: (input: { inviteId: string }) => Promise<ActionResult<null>>; refresh: () => void; onError: (e: AppErrorShape) => void },
): Promise<ActionResult<null>> {
  const r = await deps.action({ inviteId })
  if (!r.ok) {
    deps.onError(r.error)
    deps.refresh()
  }
  return r
}

export function RevokeInviteButton({ inviteId, email, onError }: { inviteId: string; email: string; onError: (e: AppErrorShape) => void }) {
  const router = useRouter()
  return (
    <ConfirmDialog
      trigger={
        <Button type="button" variant="outline" size="sm">
          取り消し
        </Button>
      }
      title="招待の取り消し"
      description={revokeConfirmText(email)}
      confirmLabel="取り消す"
      destructive
      onConfirm={() => revokeInviteAndReport(inviteId, { action: adminRevokeInvite, refresh: () => router.refresh(), onError })}
      onDone={() => router.refresh()}
    />
  )
}
