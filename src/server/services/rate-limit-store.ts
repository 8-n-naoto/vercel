// Thin service-layer entry to the rate_limits repository, so that security/rate-limit.ts does not import repositories (lint rule).
import 'server-only'
export { incrementRateLimit } from '@/server/repositories/rate-limits'
