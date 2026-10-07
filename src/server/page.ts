// Entry points for pages (page.tsx / layout.tsx). Contract: 06 9.0, 08 7.5. Authentication and "error -> screen" conversion live here only.
import 'server-only'
import { notFound, redirect, unstable_rethrow } from 'next/navigation'
import { AppError } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'
import { requireAdmin, requireUser } from '@/server/authz/session'
import { getRequestMeta } from '@/server/security/request-meta'

// The path given to pageContext, kept per context so that runPage can redirect to /login?next=<path> without widening ServiceContext.
const pathOf = new WeakMap<ServiceContext, string>()

function loginUrl(path: string | undefined): string {
  return path === undefined ? '/login' : `/login?next=${encodeURIComponent(path)}`
}

/** Converts AppError into the screen behaviour of 06 9.0. Never returns for handled codes. Unhandled errors are returned to the caller. */
function toScreen(ctx: ServiceContext, e: unknown): never | void {
  unstable_rethrow(e) // redirect() / notFound() pass through
  if (!(e instanceof AppError)) return
  const code = e.shape.code
  if (code === 'UNAUTHENTICATED') redirect(loginUrl(pathOf.get(ctx)))
  // FORBIDDEN (a non-admin on /admin/*) must not reveal that the page exists
  if (code === 'FORBIDDEN' || code === 'NOT_FOUND') notFound()
}

function logPageFailed(ctx: ServiceContext, e: unknown): void {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: 'page.failed',
      route: ctx.actionName,
      requestId: ctx.requestMeta.requestId,
      error: e instanceof Error ? e.name : 'unknown',
      code: e instanceof AppError ? e.shape.code : undefined,
      stack: e instanceof Error ? e.stack : undefined,
    }),
  )
}

export async function pageContext(opts: { route: string; path: string; auth: 'public' | 'user' | 'admin' }): Promise<ServiceContext> {
  const requestMeta = await getRequestMeta()
  const ctx: ServiceContext = { actor: null, requestMeta, now: new Date(), actionName: `page:${opts.route}` }
  pathOf.set(ctx, opts.path)
  try {
    if (opts.auth === 'user') ctx.actor = await requireUser()
    else if (opts.auth === 'admin') ctx.actor = await requireAdmin()
  } catch (e) {
    toScreen(ctx, e)
    logPageFailed(ctx, e)
    throw e
  }
  return ctx
}

export async function runPage<T>(ctx: ServiceContext, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    // RATE_LIMITED is rethrown (S15 500). Public pages that need the 429 screen use runPublicPage.
    toScreen(ctx, e)
    logPageFailed(ctx, e)
    throw e
  }
}

export async function runPublicPage<T>(
  ctx: ServiceContext,
  fn: () => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false; rateLimited: { retryAfterSec: number } }> {
  try {
    return { ok: true, data: await fn() }
  } catch (e) {
    if (e instanceof AppError && e.shape.code === 'RATE_LIMITED') {
      return { ok: false, rateLimited: { retryAfterSec: e.shape.retryAfterSec ?? 0 } }
    }
    toScreen(ctx, e)
    logPageFailed(ctx, e)
    throw e
  }
}
