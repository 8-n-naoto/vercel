// 06 9.13. STUB until WP-2.3: always { valid: false } so that S02 / S03 can render the invalid-token screen locally.
// It deliberately does not call the token:ip rate limit; the real implementation (WP-2.3) must, and must then throw RATE_LIMITED.
import 'server-only'
import type { InviteInspect } from '@/lib/dto'
import type { ServiceContext } from '@/server/actions/define-action'

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub keeps the 06 9.13 signature
async function inspect(_ctx: ServiceContext, _token: string, _purpose: 'signup' | 'password_reset'): Promise<InviteInspect> {
  return { valid: false }
}

export const invitesService = { inspect }
