// 07 5.2 RL-08 .. RL-11 (integration). Skipped when the dev database is unreachable (probe below); run with npm run test:integration.
// Counters use the key prefix 'rltest:' and are removed afterwards. Connection strings are never printed.
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { AppError } from '@/lib/errors'
import { resetConfigCache } from '@/server/config'
import { closeDb, pingDb } from '@/server/db/client'
import { binWindowStart, countRateLimitRows, deleteRateLimitsByKeyPrefix, incrementRateLimit, incrementRateLimitAt } from '@/server/repositories/rate-limits'
import { consumeRateLimit, decideRateLimit } from '@/server/security/rate-limit'

const dbUp = await pingDb().then(
  () => true,
  () => false,
)
const PREFIX = 'rltest:'
const ctx = {
  actor: null,
  requestMeta: { ip: '127.0.0.1', userAgent: 'vitest', requestId: 'req-rl-int' },
  now: new Date(),
  actionName: 'rl.integration',
}

afterAll(async () => {
  if (dbUp) await deleteRateLimitsByKeyPrefix(PREFIX)
  await closeDb()
})

describe.skipIf(!dbUp)('rate limit SQL (07 5.1)', () => {
  it('RL-08 six hits on one key: count 1..6, only the 6th is rejected', async () => {
    const key = `${PREFIX}${randomUUID()}`
    const decisions = []
    for (let i = 1; i <= 6; i++) {
      const hit = await incrementRateLimit(key, 900)
      expect(hit.count).toBe(i)
      decisions.push(decideRateLimit(hit.count, 5, hit.retryAfter).ok)
    }
    expect(decisions).toEqual([true, true, true, true, true, false])
  })

  it('RL-09 hits on both sides of a window boundary land in different rows', async () => {
    const key = `${PREFIX}${randomUUID()}`
    const before = await binWindowStart('2026-01-01T00:14:59.500Z', 900)
    const after = await binWindowStart('2026-01-01T00:15:00.100Z', 900)
    expect(before.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(after.toISOString()).toBe('2026-01-01T00:15:00.000Z')
    expect((await incrementRateLimitAt(key, before, 900)).count).toBe(1)
    expect((await incrementRateLimitAt(key, after, 900)).count).toBe(1)
    expect(await countRateLimitRows(key)).toBe(2)
  })

  it('RL-10 retry_after is between 1 and windowSec', async () => {
    const hit = await incrementRateLimit(`${PREFIX}${randomUUID()}`, 900)
    expect(hit.retryAfter).toBeGreaterThanOrEqual(1)
    expect(hit.retryAfter).toBeLessThanOrEqual(900)
  })

  it('consumeRateLimit: ok under the limit (the over-limit audit path is covered by unit tests; it would leave an audit row here)', async () => {
    const rule = { name: 'login:ip', key: `${PREFIX}${randomUUID()}`, limit: 1_000_000, windowSec: 900 }
    await expect(consumeRateLimit(rule, ctx)).resolves.toEqual({ ok: true })
  })
})

describe.skipIf(!dbUp)('fail-closed (RL-11)', () => {
  it('RL-11 DB unreachable: consumeRateLimit rejects with INTERNAL, never ok', async () => {
    const saved = process.env.DATABASE_URL
    await closeDb()
    process.env.DATABASE_URL = 'postgresql://nobody:nopass@127.0.0.1:1/postgres' // unreachable on purpose; no real credentials
    resetConfigCache()
    try {
      const err = await consumeRateLimit({ name: 'login:ip', key: `${PREFIX}x`, limit: 5, windowSec: 900 }, ctx).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(AppError)
      expect(err instanceof AppError && err.shape.code).toBe('INTERNAL')
    } finally {
      await closeDb()
      if (saved === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = saved
      resetConfigCache()
    }
  })
})
