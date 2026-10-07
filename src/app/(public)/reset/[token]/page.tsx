import { PasswordResetForm } from '@/components/features/auth/password-reset-form'
import { ErrorScreen } from '@/components/features/common/error-screen'
import { message } from '@/lib/messages'
import { invitesService } from '@/server/services/invites'
import { pageContext, runPublicPage } from '@/server/page'

export const metadata = { title: 'パスワード再設定' }

// 08 5.3 S03. Same structure as S02; the email and display name are never shown.
export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const ctx = await pageContext({ route: '/reset/[token]', path: '/reset/[token]', auth: 'public' })
  const r = await runPublicPage(ctx, () => invitesService.inspect(ctx, token, 'password_reset'))
  if (!r.ok) return <ErrorScreen variant="rate_limited" retryAfterSec={r.rateLimited.retryAfterSec} />
  if (!r.data.valid) return <ErrorScreen variant="token_invalid" message={message('reset.invalid')} />
  return <PasswordResetForm token={token} />
}
