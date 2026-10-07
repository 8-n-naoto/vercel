import 'server-only'
import type { rateLimits } from '@/server/db/schema'
import { notImplemented } from './not-implemented'

export type RateLimitRow = typeof rateLimits.$inferSelect

export async function incrementRateLimit(key: string, windowStart: Date): Promise<RateLimitRow> {
  return notImplemented('rateLimits.incrementRateLimit', [key, windowStart])
}
