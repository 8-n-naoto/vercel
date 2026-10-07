'use server'
// 06 4.5 / 4.6. The RSC read account.getProfile (9.19) lives in services/account.ts.
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { accountChangePasswordInput, accountUpdateProfileInput } from '@/lib/schemas/account'
import { defineAction } from '@/server/actions/define-action'
import { rateLimitKey } from '@/server/security/rate-limit'
import * as accountService from '@/server/services/account'

export const accountUpdateProfile = defineAction({
  name: 'account.updateProfile',
  auth: 'user',
  input: accountUpdateProfileInput,
  rateLimit: [],
  handler: async (ctx, input) => {
    const view = await accountService.updateProfile(ctx, input)
    revalidatePath('/', 'layout') // the navigation shows the display name
    return view
  },
})

export const accountChangePassword = defineAction({
  name: 'account.changePassword',
  auth: 'user',
  input: accountChangePasswordInput,
  rateLimit: [
    {
      name: 'login:email',
      key: (ctx) => (ctx.actor ? rateLimitKey('login:email', { email: ctx.actor.email }) : null),
      limit: 5,
      windowSec: 900,
      auditAction: 'auth.login_rate_limited',
    },
  ],
  handler: async (ctx, input) => {
    await accountService.changePassword(ctx, input)
    redirect('/login?changed=1') // outside any try: defineAction re-throws the redirect (06 3.1 step 6a)
  },
})
