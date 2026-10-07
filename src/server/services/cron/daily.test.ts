// WP-4.3 unit tests (07 10): steps 2-4 with a store double and the fake Storage. The SQL is checked in repositories/cron-queries.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeObjects } from '@/tests/fakes/objects'
import { runDaily, type DailyDeps, type DailyStore, type FileTarget } from './daily'

const NOW = new Date('2026-10-11T18:00:00.000Z')
const path = (i: number) => `f/${i}.html`
const targets = (n: number): FileTarget[] => Array.from({ length: n }, (_, i) => ({ id: `id${i}`, storagePath: path(i) }))

function setup(opts: { pending?: FileTarget[]; expired?: FileTarget[]; unpurged?: FileTarget[] } = {}) {
  const objects = createFakeObjects()
  const purged: string[] = []
  const calls: string[] = []
  const store: DailyStore = {
    abandonPending: async (now, limit) => {
      calls.push(`abandon:${now.toISOString()}:${limit}`)
      return (opts.pending ?? []).slice(0, limit)
    },
    expireFiles: async (now, days, limit) => {
      calls.push(`expire:${now.toISOString()}:${days}:${limit}`)
      return (opts.expired ?? []).slice(0, limit)
    },
    listUnpurged: async (limit) => (opts.unpurged ?? []).slice(0, limit),
    markPurged: async (ids) => void purged.push(...ids),
  }
  const deps: Partial<DailyDeps> = { keepalive: async () => {}, now: () => NOW, objects: () => objects, retentionDays: () => 30, store }
  return { objects, purged, calls, deps, store }
}
const by = (r: Awaited<ReturnType<typeof runDaily>>, step: string) => r.find((x) => x.step === step)

afterEach(() => vi.restoreAllMocks())

describe('runDaily steps 2-4', () => {
  it('runs keepalive, pending_cleanup, expired_files and purge_retry with the fixed now and the configured retention days', async () => {
    const { deps, purged, calls } = setup({ pending: targets(2), expired: targets(1), unpurged: [{ id: 'u', storagePath: 'u.html' }] })
    const r = await runDaily(deps)
    expect(r.map((x) => x.step)).toEqual(['keepalive', 'pending_cleanup', 'expired_files', 'purge_retry'])
    expect(by(r, 'pending_cleanup')).toMatchObject({ processed: 2, failed: 0 })
    expect(by(r, 'expired_files')).toMatchObject({ processed: 1, failed: 0 })
    expect(by(r, 'purge_retry')).toMatchObject({ processed: 1, failed: 0 })
    expect(calls).toEqual([`abandon:${NOW.toISOString()}:500`, `expire:${NOW.toISOString()}:30:500`])
    expect(purged).toEqual(['id0', 'id1', 'id0', 'u'])
  })

  it('an object that does not exist counts as removed (CR-03)', async () => {
    const { deps, purged } = setup({ pending: targets(1) })
    const r = await runDaily(deps)
    expect(by(r, 'pending_cleanup')).toMatchObject({ processed: 1, failed: 0 })
    expect(purged).toEqual(['id0'])
  })

  it('removes the objects of the changed rows', async () => {
    const { deps, objects } = setup({ expired: targets(1) })
    objects.put(path(0), new Uint8Array([1]), 'text/html')
    await runDaily(deps)
    expect(objects.has(path(0))).toBe(false)
  })

  it('a failing removal leaves purged_at unset and counts failed; the next run advances (CR-06)', async () => {
    const { deps, objects, purged } = setup({ unpurged: targets(1) })
    objects.failNext('removeMany')
    const first = await runDaily(deps)
    expect(by(first, 'purge_retry')).toMatchObject({ processed: 0, failed: 1 })
    expect(purged).toEqual([])
    const second = await runDaily(deps)
    expect(by(second, 'purge_retry')).toMatchObject({ processed: 1, failed: 0 })
    expect(purged).toEqual(['id0'])
  })

  it('an exception from removeMany counts the chunk as failed and the step still finishes', async () => {
    const { deps, objects } = setup({ pending: targets(3) })
    objects.removeMany = async () => {
      throw new Error('boom')
    }
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const r = await runDaily(deps)
    expect(by(r, 'pending_cleanup')).toMatchObject({ processed: 3, failed: 3 })
  })

  it('removes 100 paths per call', async () => {
    const { deps, objects } = setup({ unpurged: targets(250) })
    const sizes: number[] = []
    const orig = objects.removeMany.bind(objects)
    objects.removeMany = async (p) => {
      sizes.push(p.length)
      return orig(p)
    }
    const r = await runDaily(deps)
    expect(sizes).toEqual([100, 100, 50])
    expect(by(r, 'purge_retry')).toMatchObject({ processed: 250, failed: 0 })
  })

  it('logs cron.step_truncated when the limit is reached (CR-07) and not below it', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await runDaily(setup({ pending: targets(501) }).deps)
    const events = log.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
    expect(events).toContainEqual(expect.objectContaining({ event: 'cron.step_truncated', step: 'pending_cleanup', limit: 500 }))
    log.mockClear()
    await runDaily(setup({ pending: targets(499) }).deps)
    expect(log.mock.calls.map((c) => String(c[0])).join('')).not.toContain('cron.step_truncated')
  })

  it('a failure in step 2 does not stop steps 3 and 4 (CR-17, unit)', async () => {
    const { deps, purged, store } = setup({ expired: targets(1), unpurged: [{ id: 'u', storagePath: 'u.html' }] })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken: DailyStore = {
      ...store,
      abandonPending: async () => {
        throw new Error('sql failed with secret')
      },
    }
    const r = await runDaily({ ...deps, store: broken })
    expect(by(r, 'pending_cleanup')).toMatchObject({ processed: 0, failed: 1 })
    expect(by(r, 'expired_files')).toMatchObject({ processed: 1, failed: 0 })
    expect(by(r, 'purge_retry')).toMatchObject({ processed: 1, failed: 0 })
    expect(purged).toEqual(['id0', 'u'])
    const logged = String(err.mock.calls[0]?.[0])
    expect(logged).toContain('cron.step_failed')
    expect(logged).not.toContain('secret')
  })
})
