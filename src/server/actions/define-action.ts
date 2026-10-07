// Signature and processing order: 06 3.1 (the contract). Skeleton: 04 3.5.
import 'server-only'
import { unstable_rethrow } from 'next/navigation'
import { z } from 'zod'
import { AppError, appError, type ActionResult } from '@/lib/errors'
import { translateIssueMessage } from '@/lib/schemas/error-map' // also installs the Japanese zod messages (z.config)
import { ACTION_BRAND } from '@/server/actions/brand'
import { clearSessionCookies, requireAdmin, requireUser, type Actor } from '@/server/authz/session'
import { consumeRateLimit } from '@/server/security/rate-limit'
import { getRequestMeta } from '@/server/security/request-meta'

export interface RequestMeta {
  ip: string | null
  userAgent: string | null
  requestId: string
}

export interface ServiceContext {
  actor: Actor | null // null only when auth is 'public'
  requestMeta: RequestMeta
  now: Date
  actionName: string // 'folders.create'; RSC reads use 'page:<route>'
}

export interface RateLimitRule<I> {
  name: string // rule name from 06 3.5, e.g. 'login:email'
  key: (ctx: ServiceContext, input: I) => string | null // null = rule not applied
  limit: number
  windowSec: number
  auditAction?: 'auth.login_rate_limited'
}

export interface ActionDef<I, O> {
  name: string
  auth: 'public' | 'user' | 'admin'
  input: z.ZodType<I>
  rateLimit: RateLimitRule<I>[] // required; an empty array is forbidden for 'public'
  handler: (ctx: ServiceContext, input: I) => Promise<O>
}

type ActionData<O> = [O] extends [void] ? null : O // a void handler returns data: null

/** Rate limit of every user / admin action, prepended automatically (06 3.5, 3.1 step 4). */
const MUTATION_RULE = { name: 'mutation:user', limit: 120, windowSec: 60 } as const

// PostgreSQL error code. Also looks at `cause` because drizzle may wrap driver errors (verified against a real DB in WP-1.x).
function pgCode(e: unknown): string | undefined {
  let cur: unknown = e
  for (let i = 0; i < 3 && cur && typeof cur === 'object'; i++) {
    const code = (cur as { code?: unknown }).code
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code
    cur = (cur as { cause?: unknown }).cause
  }
  return undefined
}

// 06 1.6: deadlock / lock timeout / serialization failure / unique violation -> CONFLICT. 57014 (statement_timeout) falls through to INTERNAL.
export function mapPgError(code: string | undefined): AppError | null {
  if (code && ['40P01', '55P03', '40001', '23505'].includes(code)) return appError('CONFLICT', 'common.concurrent_update')
  return null
}

/** Field name -> messages. Messages are the confirmed Japanese texts (06 1.3, 08 9.2); form-level issues use the key '_form'. */
export function toFieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join('.') : '_form'
    const list = out[key] ?? (out[key] = [])
    list.push(translateIssueMessage(issue.message))
  }
  return out
}

export function defineAction<I, O>(def: ActionDef<I, O>) {
  if (def.auth === 'public' && def.rateLimit.length === 0) {
    throw new Error(`defineAction(${def.name}): auth 'public' requires at least one rateLimit rule (06 3.1)`)
  }

  const run = async (raw: unknown): Promise<ActionResult<ActionData<O>>> => {
    const requestMeta = await getRequestMeta()
    const started = Date.now()
    let userId: string | undefined
    const log = (event: string, extra: Record<string, unknown>) =>
      console.log(
        JSON.stringify({ ts: new Date().toISOString(), event, action: def.name, requestId: requestMeta.requestId, durationMs: Date.now() - started, ...extra }),
      )
    try {
      // 1. ctx
      const ctx: ServiceContext = { actor: null, requestMeta, now: new Date(), actionName: def.name }

      // 2. input validation
      const parsed = def.input.safeParse(raw)
      if (!parsed.success) {
        throw appError('VALIDATION_FAILED', 'common.validation_failed', { fieldErrors: toFieldErrors(parsed.error) })
      }

      // 3. authentication
      try {
        if (def.auth === 'user') ctx.actor = await requireUser()
        else if (def.auth === 'admin') ctx.actor = await requireAdmin()
      } catch (e) {
        if (e instanceof AppError && e.shape.code === 'UNAUTHENTICATED') await clearSessionCookies()
        throw e
      }
      userId = ctx.actor?.userId

      // 4. rate limits (the first exceeded rule wins; the rest are not evaluated)
      const rules: RateLimitRule<I>[] =
        def.auth === 'public'
          ? def.rateLimit
          : [{ ...MUTATION_RULE, key: (c) => (c.actor ? `mutation:user:${c.actor.userId}` : null) }, ...def.rateLimit]
      for (const rule of rules) {
        const key = rule.key(ctx, parsed.data)
        if (key === null) continue
        const r = await consumeRateLimit(
          { name: rule.name, key, limit: rule.limit, windowSec: rule.windowSec, ...(rule.auditAction ? { auditAction: rule.auditAction } : {}) },
          ctx,
        )
        if (!r.ok) throw appError('RATE_LIMITED', 'common.rate_limited', { retryAfterSec: r.retryAfterSec })
      }

      // 5. handler
      const out = await def.handler(ctx, parsed.data)

      // 7-8. done log and success
      log('action.done', { userId, ok: true })
      return { ok: true, data: (out === undefined ? null : out) as ActionData<O> }
    } catch (e) {
      // 6. exceptions. (a) redirect() / notFound() must pass through
      unstable_rethrow(e)
      // (b) AppError
      if (e instanceof AppError) {
        log('action.done', { userId, ok: false, code: e.shape.code })
        return { ok: false, error: e.shape }
      }
      // (c) PostgreSQL errors
      const mapped = mapPgError(pgCode(e))
      if (mapped) {
        log('action.done', { userId, ok: false, code: mapped.shape.code })
        return { ok: false, error: mapped.shape }
      }
      // (d) unknown: log with requestId, never return the stack trace, never log the input
      log('action.failed', { userId, error: e instanceof Error ? e.name : 'unknown', stack: e instanceof Error ? e.stack : undefined })
      const internal = appError('INTERNAL', 'common.internal', { requestId: requestMeta.requestId, params: { requestId: requestMeta.requestId } })
      return { ok: false, error: internal.shape }
    }
  }
  return Object.assign(run, { [ACTION_BRAND]: { name: def.name, auth: def.auth } })
}
