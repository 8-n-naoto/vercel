import { ChangePasswordForm } from '@/components/features/account/change-password-form'
import { ProfileForm } from '@/components/features/account/profile-form'
import { Breadcrumbs } from '@/components/features/layout/breadcrumbs'
import { PageTitle } from '@/components/features/layout/page-title'
import { pageContext, runPage } from '@/server/page'
import { getProfile } from '@/server/services/account'

export const metadata = { title: 'アカウント設定' }

const PATH = '/account'

// 08 5.14 S14. Own profile only: the profile comes from the session, never from a URL parameter.
export default async function AccountPage() {
  const ctx = await pageContext({ route: PATH, path: PATH, auth: 'user' })
  const profile = await runPage(ctx, () => getProfile(ctx))
  return (
    <>
      <Breadcrumbs items={[{ label: 'アカウント設定' }]} />
      <PageTitle>アカウント設定</PageTitle>
      <div className="flex flex-col gap-8 sm:max-w-xl">
        <ProfileForm email={profile.email} role={profile.role} displayName={profile.displayName} />
        <ChangePasswordForm />
      </div>
    </>
  )
}
