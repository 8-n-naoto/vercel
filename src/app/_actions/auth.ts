'use server'
// 06 4.1 / 4.3 / 4.4. auth.signOut (WP-2.1 done); invites.accept and passwordReset.complete are stubs until WP-2.3.
import { redirect } from 'next/navigation'
import { appError } from '@/lib/errors'
import { authSignInInput, authSignOutInput, invitesAcceptInput, passwordResetCompleteInput } from '@/lib/schemas/auth'
import { defineAction } from '@/server/actions/define-action'
import { rateLimitKey } from '@/server/security/rate-limit'
import * as authService from '@/server/services/auth'

export const authSignIn = defineAction({
  name: 'auth.signIn',
  auth: 'public',
  input: authSignInInput,
  rateLimit: [
    { name: 'login:ip', key: (ctx) => rateLimitKey('login:ip', { ip: ctx.requestMeta.ip }), limit: 20, windowSec: 900, auditAction: 'auth.login_rate_limited' },
    { name: 'login:email', key: (_ctx, input) => rateLimitKey('login:email', { email: input.email }), limit: 5, windowSec: 900, auditAction: 'auth.login_rate_limited' },
  ],
  handler: async (ctx, input) => {
    const to = await authService.signIn(ctx, input)
    redirect(to) // outside any try: defineAction re-throws the redirect (06 3.1 step 6a)
  },
})

// 06 4.2. A second call is UNAUTHENTICATED (requireUser in defineAction).
export const authSignOut = defineAction({
  name: 'auth.signOut',
  auth: 'user',
  input: authSignOutInput,
  rateLimit: [],
  handler: async (ctx) => {
    await authService.signOut(ctx)
    redirect('/login')
  },
})

// 06 4.3. WP-2.3 replaces this handler; the stub only fixes the signature for S02.
export const invitesAccept = defineAction({
  name: 'invites.accept',
  auth: 'public',
  input: invitesAcceptInput,
  rateLimit: [{ name: 'token:ip', key: (ctx) => rateLimitKey('token:ip', { ip: ctx.requestMeta.ip }), limit: 10, windowSec: 900 }],
  handler: async () => {
    throw appError('VALIDATION_FAILED', 'invite.invalid')
  },
})

// 06 4.4. WP-2.3 replaces this handler; the stub only fixes the signature for S03.
export const passwordResetComplete = defineAction({
  name: 'passwordReset.complete',
  auth: 'public',
  input: passwordResetCompleteInput,
  rateLimit: [{ name: 'token:ip', key: (ctx) => rateLimitKey('token:ip', { ip: ctx.requestMeta.ip }), limit: 10, windowSec: 900 }],
  handler: async () => {
    throw appError('VALIDATION_FAILED', 'reset.invalid')
  },
})
