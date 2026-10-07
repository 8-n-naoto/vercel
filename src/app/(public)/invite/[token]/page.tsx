import { InviteAcceptForm } from '@/components/features/auth/invite-accept-form'
import { ErrorScreen } from '@/components/features/common/error-screen'
import { invitesService } from '@/server/services/invites'
import { pageContext, runPublicPage } from '@/server/page'

export const metadata = { title: 'アカウント登録' }

// 08 5.2 S02. An invalid URL is shown as HTTP 200 (not notFound()); rate limiting gets the 429 screen via runPublicPage (08 7.5).
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const ctx = await pageContext({ route: '/invite/[token]', path: '/invite/[token]', auth: 'public' })
  const r = await runPublicPage(ctx, () => invitesService.inspect(ctx, token, 'signup'))
  if (!r.ok) return <ErrorScreen variant="rate_limited" retryAfterSec={r.rateLimited.retryAfterSec} />
  if (!r.data.valid || r.data.email === null) return <ErrorScreen variant="token_invalid" />
  return <InviteAcceptForm token={token} email={r.data.email} />
}
