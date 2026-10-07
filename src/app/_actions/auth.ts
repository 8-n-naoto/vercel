'use server'
// 06 4.1. Only auth.signIn lives here for now (auth.signOut: WP-2.1).
import { appError } from '@/lib/errors'
import { authSignInInput } from '@/lib/schemas/auth'
import { defineAction } from '@/server/actions/define-action'
import { rateLimitKey } from '@/server/security/rate-limit'

export const authSignIn = defineAction({
  name: 'auth.signIn',
  auth: 'public',
  input: authSignInInput,
  rateLimit: [
    { name: 'login:ip', key: (ctx) => rateLimitKey('login:ip', { ip: ctx.requestMeta.ip }), limit: 20, windowSec: 900, auditAction: 'auth.login_rate_limited' },
    { name: 'login:email', key: (_ctx, input) => rateLimitKey('login:email', { email: input.email }), limit: 5, windowSec: 900, auditAction: 'auth.login_rate_limited' },
  ],
  // WP-2.1 (06 4.1) replaces this handler; the stub only fixes the signature for S01.
  handler: async () => {
    throw appError('VALIDATION_FAILED', 'auth.invalid_credentials')
  },
})
