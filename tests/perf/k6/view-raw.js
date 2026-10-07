// Viewing start: view.openAsMember (Server Action) then GET /raw/<ticket> as a pair (tickets are one-time, so they cannot be reused).
// NOT RUN YET (k6 not installed). Target: NF-11 (first byte of the raw HTML p95 <= 2.0 s warm, 1 MB file), NF-02 (10 concurrent viewers).
//
// Rate-limit budget (06 3.5, D-022; T-057). The script is designed to stay INSIDE the limits:
//   ticket:user    30 / 60 s per member    -> each VU is bound to one member cookie (PERF_COOKIE_1..N, VU k uses cookie ((k-1) mod N)+1)
//   raw:ip        120 / 60 s per source IP -> one k6 machine = one IP; all VUs share it
//   mutation:user 120 / 60 s per member    -> not reached (the ticket:user cap is lower)
// One iteration is paced to PERF_PACE_SEC (default 12 s): 20 VUs = 100 pairs/min in total, under raw:ip 120. At init the script computes the
// worst case per member and per IP and aborts if it exceeds PERF_USER_CAP (24 = 80% of 30) or PERF_IP_CAP (100 = about 83% of 120),
// so the run cannot hit the limiter by design. Set PERF_ALLOW_OVER=1 only to exceed on purpose.
// A rate-limited reply is counted in rate_limited_429 and excluded from view_error_rate (NF-26) and from the latency trends. A Server Action
// reports the limit as HTTP 200 + body code RATE_LIMITED (not HTTP 429); /raw reports a real 429. Both are detected.
//
// Modes (PERF_MODE):
//   ladder (default)  5 -> 10 -> 20 VUs, PERF_STAGE_HOLD each (default 2m). NF-02.
//   nf11              5 VUs, 30 iterations in total (shared-iterations). NF-11 judgement with a 1 MB file. CLI --vus/--iterations are NOT used.
//   limit-check       1 VU, 31 sequential openAsMember with ONE member (the last cookie). Expects calls 1..30 ok and call 31 RATE_LIMITED.
//                     Needs that member to be idle for >= 60 s before (fixed window). Writes 30 access_logs rows, no /raw. Run it alone.
// Run: k6 run --out json=tests/perf/results/view-raw-<date>.json tests/perf/k6/view-raw.js
// Env: PERF_APP_ORIGIN, PERF_CONTENT_ORIGIN, PERF_COOKIE_1..N (or PERF_COOKIE for one member), PERF_ACTION_ID_OPEN, PERF_FILE_ID,
//      PERF_STAGE_HOLD, PERF_PACE_SEC, PERF_MODE, PERF_USER_CAP, PERF_IP_CAP, PERF_ALLOW_OVER.
// Every iteration writes one access_logs row (retention 180 days). Use only the test project.
import http from 'k6/http'
import { check, fail, sleep } from 'k6'
import { Counter, Rate, Trend } from 'k6/metrics'
import { contentOrigin, env, isRateLimited, ladder, memberCookies, openAsMember } from './lib.js'

const openMs = new Trend('open_action_ms', true)
const rawTtfb = new Trend('raw_ttfb', true)
const startMs = new Trend('view_start_ms', true) // action + raw first byte (successful pairs only)
const limited = new Counter('rate_limited_429') // limiter hit (by design this stays 0 in ladder / nf11)
const viewErrors = new Rate('view_error_rate') // real failures only: a rate-limited reply is NOT counted here (NF-26)
const limitOk = new Counter('limit_check_ok')
const limitDenied = new Counter('limit_check_denied')

const mode = env('PERF_MODE', 'ladder')
const pace = Number(env('PERF_PACE_SEC', mode === 'limit-check' ? '1' : '12'))
const cookies = memberCookies()
const userCap = Number(env('PERF_USER_CAP', '24'))
const ipCap = Number(env('PERF_IP_CAP', '100'))

// Peak VUs of the chosen mode (the ladder peaks at 20, see lib.js ladder()).
const peakVus = mode === 'nf11' ? 5 : mode === 'limit-check' ? 1 : 20
const perUserPerMin = Math.ceil(peakVus / cookies.length) * (60 / pace) // worst-loaded member (VUs are assigned round-robin)
const perIpPerMin = peakVus * (60 / pace)
if (mode !== 'limit-check' && __ENV.PERF_ALLOW_OVER !== '1') {
  if (perUserPerMin > userCap) fail(`ticket:user budget: ${perUserPerMin}/min per member > cap ${userCap}. Add member cookies (PERF_COOKIE_n) or raise PERF_PACE_SEC.`)
  if (perIpPerMin > ipCap) fail(`raw:ip budget: ${perIpPerMin}/min per IP > cap ${ipCap}. Raise PERF_PACE_SEC.`)
}

const scenarios = {
  ladder: { view: { executor: 'ramping-vus', startVUs: 0, stages: ladder(env('PERF_STAGE_HOLD', '2m')), gracefulRampDown: '10s', exec: 'scenario' } },
  nf11: { view: { executor: 'shared-iterations', vus: 5, iterations: 30, maxDuration: '5m', exec: 'scenario' } },
  'limit-check': { check: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '2m', exec: 'limitCheck' } },
}
if (scenarios[mode] === undefined) fail(`unknown PERF_MODE ${mode}`)

export const options = {
  scenarios: scenarios[mode],
  thresholds: {
    view_start_ms: ['p(95)<2000'],
    view_error_rate: ['rate<0.01'],
    // Not a performance result: a non-zero count means the pacing exceeded a limit (a flaw of the run), so the latency numbers are partial.
    rate_limited_429: mode === 'limit-check' ? ['count>=0'] : ['count==0'],
  },
}

function cookieOfVu() {
  return cookies[(__VU - 1) % cookies.length]
}

export function scenario() {
  const t0 = Date.now()
  const { res, ticket } = openAsMember(env('PERF_FILE_ID'), cookieOfVu())
  if (isRateLimited(res)) {
    limited.add(1)
    sleep(pace)
    return
  }
  openMs.add(res.timings.duration)
  const actionOk = check(res, { 'action 200': (r) => r.status === 200 }) && ticket !== null
  if (!actionOk) {
    viewErrors.add(true)
    sleep(pace)
    return
  }
  const raw = http.get(`${contentOrigin()}/raw/${ticket}`, {
    headers: { 'Sec-Fetch-Dest': 'iframe' }, // a view ticket is only valid for an iframe (06 10.1 step 6)
    redirects: 0,
    tags: { name: 'raw_get' },
    responseCallback: http.expectedStatuses({ min: 200, max: 299 }, 429), // a 429 is not counted in http_req_failed
  })
  if (isRateLimited(raw)) {
    limited.add(1)
  } else {
    rawTtfb.add(raw.timings.waiting)
    startMs.add(Date.now() - t0)
    viewErrors.add(!check(raw, { 'raw 200': (r) => r.status === 200 }))
  }
  sleep(Math.max(0, pace - (Date.now() - t0) / 1000))
}

// ticket:user boundary: the 30th call is allowed and the 31st is RATE_LIMITED. Uses one member only (the last cookie).
export function limitCheck() {
  const cookie = cookies[cookies.length - 1]
  for (let i = 1; i <= 31; i++) {
    const { res } = openAsMember(env('PERF_FILE_ID'), cookie)
    const denied = isRateLimited(res)
    if (denied) limitDenied.add(1)
    else if (res.status === 200) limitOk.add(1)
    check(res, { [`call ${i} ${i <= 30 ? 'allowed' : 'rate limited'}`]: () => (i <= 30 ? !denied : denied) })
  }
}
