'use client'
// 08 5.7 [delete] -> ConfirmDialog (title "ファイルを削除", C-01, destructive) -> filesDelete -> back to S05.
import { useRouter } from 'next/navigation'
import { filesDelete } from '@/app/_actions/files'
import { ConfirmDialog } from '@/components/features/common/confirm-dialog'
import { Button } from '@/components/ui/button'
import { deleteFileConfirmText } from '@/lib/messages'

export function DeleteFileButton({ folderId, fileId, displayName }: { folderId: string; fileId: string; displayName: string }) {
  const router = useRouter()
  return (
    <ConfirmDialog
      title="ファイルを削除"
      description={deleteFileConfirmText(displayName)}
      confirmLabel="削除する"
      destructive
      trigger={
        <Button type="button" variant="destructive">
          削除
        </Button>
      }
      onConfirm={() => filesDelete({ fileId })}
      onDone={() => {
        router.push(`/folders/${folderId}`)
        router.refresh()
      }}
    />
  )
}
