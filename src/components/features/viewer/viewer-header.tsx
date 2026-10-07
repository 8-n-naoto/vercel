// 08 3.3 / 5.8. Presentation only: the buttons are driven by props (MemberViewer owns the state).
import Link from 'next/link'
import { FormError } from '@/components/features/common/form-message'
import { Button } from '@/components/ui/button'
import type { MemberViewContext } from '@/lib/dto'
import type { AppErrorShape } from '@/lib/errors'
import { VIEWER_TEXT, previewNoticeText } from '@/lib/messages'

export interface ViewerHeaderProps {
  context: MemberViewContext
  canDownload: boolean // false until the Action succeeds and whenever it is not allowed: then neither the button nor a reason is shown
  reloadDisabled: boolean
  downloadPending: boolean
  downloadError: AppErrorShape | null
  onReload: () => void
  onDownload: () => void
}

export function ViewerHeader({ context, canDownload, reloadDisabled, downloadPending, downloadError, onReload, onDownload }: ViewerHeaderProps) {
  const { file, mode, previewNotice } = context
  return (
    <header className="flex flex-col gap-1 border-b px-4 py-2">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/folders/${file.folderId}`} className="text-sm underline underline-offset-4">
          ← {file.folderName}
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{file.displayName}</h1>
        {canDownload ? (
          <Button type="button" variant="outline" size="sm" disabled={downloadPending} onClick={onDownload}>
            {VIEWER_TEXT.download}
          </Button>
        ) : null}
        <Button type="button" variant="outline" size="sm" disabled={reloadDisabled} onClick={onReload}>
          {VIEWER_TEXT.reload}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">⚠ {VIEWER_TEXT.notice}</p>
      {mode === 'admin_preview' && previewNotice !== null ? (
        <p role="note" className="rounded-md border border-amber-500/40 bg-amber-50 px-2 py-1 text-xs text-amber-900">
          {previewNoticeText(previewNotice)}
        </p>
      ) : null}
      <FormError error={downloadError} />
    </header>
  )
}
