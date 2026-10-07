'use client'
// 08 4.5 D05 launcher. after=redirect (S05 settings): go to /folders?deleted=1. after=custom (S12): the caller shows the result and refreshes.
import { useRouter } from 'next/navigation'
import { foldersDelete } from '@/app/_actions/folders'
import { ConfirmDeleteDialog } from '@/components/features/common/confirm-delete-dialog'
import { Button } from '@/components/ui/button'

export interface FolderDeleteResult {
  deletedFiles: number
  revokedLinks: number
  purgeFailed: number
}

export function DeleteFolderButton({
  folderId,
  name,
  after,
  onDeleted,
  size = 'default',
}: {
  folderId: string
  name: string
  after: 'redirect' | 'custom'
  onDeleted?: (r: FolderDeleteResult) => void
  size?: 'default' | 'sm'
}) {
  const router = useRouter()
  return (
    <ConfirmDeleteDialog
      name={name}
      trigger={
        <Button type="button" variant="destructive" size={size}>
          {after === 'redirect' ? 'フォルダを削除' : '削除'}
        </Button>
      }
      onConfirm={(confirmName) => foldersDelete({ folderId, confirmName })}
      onDone={(r) => {
        if (after === 'redirect') router.push('/folders?deleted=1')
        else onDeleted?.(r)
      }}
    />
  )
}
