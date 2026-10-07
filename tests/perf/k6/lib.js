// Shared helpers for the k6 scripts. NOT RUN YET (T-048: no test environment). Values come from environment variables only.
// Required: PERF_APP_ORIGIN, PERF_CONTENT_ORIGIN (the two fixed hosts of the test environment), PERF_COOKIE (Cookie header value of a logged-in test user).
import http from 'k6/http'
import { fail } from 'k6'

export function env(name, fallback) {
  const v = __ENV[name]
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback
    fail(`missing environment variable ${name}`)
  }
  return v
}

export function appOrigin() {
  return env('PERF_APP_ORIGIN').replace(/\/$/, '')
}
export function contentOrigin() {
  return env('PERF_CONTENT_ORIGIN').replace(/\/$/, '')
}

/** Headers for page requests as a logged-in user. The cookie is never printed. */
export function pageHeaders() {
  return { Cookie: env('PERF_COOKIE'), Accept: 'text/html' }
}

/**
 * Calls view.openAsMember (Server Action) and returns the one-time /raw ticket, or null.
 * The Next-Action id changes per build: take it from .next/server/server-reference-manifest.json (exportedName viewOpenAsMember) of the deployed commit.
 */
export function openAsMember(fileId, cookie = env('PERF_COOKIE')) {
  const res = http.post(`${appOrigin()}/view/${fileId}`, JSON.stringify([{ fileId }]), {
    headers: {
      Cookie: cookie,
      'Next-Action': env('PERF_ACTION_ID_OPEN'),
      'Content-Type': 'text/plain;charset=UTF-8',
      Accept: 'text/x-component',
      Origin: appOrigin(),
    },
    tags: { name: 'action_openAsMember' },
  })
  const m = res.status === 200 ? /\/raw\/([A-Za-z0-9_-]+)/.exec(res.body) : null
  return { res, ticket: m ? m[1] : null }
}

/**
 * Member cookies for view-raw.js (T-057): PERF_COOKIE_1 .. PERF_COOKIE_20 (one logged-in member each, contiguous from 1), or PERF_COOKIE as a single member.
 * Never printed.
 */
export function memberCookies() {
  const list = []
  for (let i = 1; i <= 20; i++) {
    const v = __ENV[`PERF_COOKIE_${i}`]
    if (v === undefined || v === '') break
    list.push(v)
  }
  if (list.length === 0) list.push(env('PERF_COOKIE'))
  return list
}

/**
 * The ticket:user limit (06 3.5) comes back from a Server Action as HTTP 200 with { ok: false, error: { code: 'RATE_LIMITED' } } in the body
 * (define-action.ts), not as HTTP 429. A route handler (/raw) returns a real 429. Both mean "the limiter worked", not a failure.
 */
export function isRateLimited(res) {
  if (res.status === 429) return true
  return res.status === 200 && typeof res.body === 'string' && (res.body.indexOf('RATE_LIMITED') !== -1 || res.body.indexOf('common.rate_limited') !== -1)
}

/** Stage ladder required by the task: 5 -> 10 -> 20 concurrent users, each held for `hold` and ramped in `ramp`. */
export function ladder(hold = '2m', ramp = '20s') {
  return [
    { duration: ramp, target: 5 },
    { duration: hold, target: 5 },
    { duration: ramp, target: 10 },
    { duration: hold, target: 10 },
    { duration: ramp, target: 20 },
    { duration: hold, target: 20 },
    { duration: ramp, target: 0 },
  ]
}
