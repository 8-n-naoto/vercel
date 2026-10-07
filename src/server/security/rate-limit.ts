// Phase 0 stub. Implemented in WP-1.4 (06 3.5, 07 5).
import 'server-only'
import type { ServiceContext } from '@/server/actions/define-action'

export async function consumeRateLimit(
  rule: { name: string; key: string; limit: number; windowSec: number },
  ctx: ServiceContext,
): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  void rule
  void ctx
  return { ok: true } // no-op until app.rate_limits exists
}
