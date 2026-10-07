// 08 4.14 / 5.15. Same look for S15 and for the denial screens of S02 / S03 / S09. No hooks: usable from server and client components.
import Link from 'next/link'
import { formatRetryAfter } from '@/lib/format'
import { message } from '@/lib/messages'

export type ErrorScreenVariant = 'not_found' | 'share_invalid' | 'token_invalid' | 'rate_limited' | 'access_denied' | 'internal'

const FOLDER_LINK_VARIANTS: readonly ErrorScreenVariant[] = ['not_found', 'internal', 'access_denied']

export function ErrorScreen({
  variant,
  message: text,
  retryAfterSec,
  showFolderLink,
  actions,
}: {
  variant: ErrorScreenVariant
  message?: string
  retryAfterSec?: number
  showFolderLink?: boolean
  actions?: React.ReactNode
}) {
  let body: string
  switch (variant) {
    case 'not_found':
      body = 'ページが見つかりません' // E-01
      break
    case 'share_invalid':
      body = 'リンクが無効か、期限が切れています' // E-02
      break
    case 'token_invalid':
      body = text ?? message('invite.invalid')
      break
    case 'rate_limited':
      body = message('common.rate_limited') + (retryAfterSec === undefined ? '' : formatRetryAfter(retryAfterSec))
      break
    case 'access_denied':
      body = text ?? message('common.forbidden')
      break
    case 'internal':
      body = text ?? 'エラーが発生しました'
      break
  }
  const folderLink = showFolderLink ?? FOLDER_LINK_VARIANTS.includes(variant)
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">{body}</h1>
      {actions || folderLink ? (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {actions}
          {folderLink ? (
            <Link href="/folders" className="text-sm underline underline-offset-4">
              フォルダ一覧へ
            </Link>
          ) : null}
        </div>
      ) : null}
    </main>
  )
}
