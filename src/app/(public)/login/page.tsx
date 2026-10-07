import { redirect } from 'next/navigation'
import { FormSuccess } from '@/components/features/common/form-message'
import { LoginForm } from '@/components/features/auth/login-form'
import { LOGIN_CHANGED_MESSAGE, parseLoginParams } from '@/components/features/auth/login-params'
import { getActorOrNull } from '@/server/authz/session'
import { pageContext } from '@/server/page'

export const metadata = { title: 'ログイン' }

// 08 5.1 S01. Already signed in -> redirect(next ?? '/folders'). next is accepted only when it passes zNextPath.
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await pageContext({ route: '/login', path: '/login', auth: 'public' })
  const { next, showChanged } = parseLoginParams(await searchParams)
  if ((await getActorOrNull()) !== null) redirect(next ?? '/folders')
  return (
    <div className="flex flex-col gap-4">
      {showChanged ? <FormSuccess>{LOGIN_CHANGED_MESSAGE}</FormSuccess> : null}
      <LoginForm next={next} />
    </div>
  )
}
