// Viewing start: view.openAsMember (Server Action) then GET /raw/<ticket> as a pair (tickets are one-time, so they cannot be reused).
// NOT RUN YET. Target: NF-11 (first byte of the raw HTML p95 <= 2.0 s warm, 1 MB file), NF-02 (10 concurrent viewers).
// Run: k6 run --out json=tests/perf/results/view-raw-<date>.json tests/perf/k6/view-raw.js
// Env: PERF_APP_ORIGIN, PERF_CONTENT_ORIGIN, PERF_COOKIE, PERF_ACTION_ID_OPEN, PERF_FILE_ID (a ~1 MB active file the user can view), PERF_STAGE_HOLD.
// Rate limits (06 3.5): raw:ip 120/min per IP and mutation:user 120/min per user. One iteration is paced to 10 s, so 20 VUs = 120/min: the 20-VU stage
// touches the limit. 429 responses are counted separately (rate_limited_429); a 429 is the limiter working, not a performance failure.
// Every iteration writes one access_logs row (retention 180 days). Use only the test project.
import http from 'k6/http'
import { check, sleep } from 'k6'
import { Counter, Trend } from 'k6/metrics'
import { contentOrigin, env, ladder, openAsMember } from './lib.js'

const openMs = new Trend('open_action_ms', true)
const rawTtfb = new Trend('raw_ttfb', true)
const startMs = new Trend('view_start_ms', true) // action + raw first byte
const limited = new Counter('rate_limited_429')

export const options = {
  scenarios: { view: { executor: 'ramping-vus', startVUs: 0, stages: ladder(env('PERF_STAGE_HOLD', '2m')), gracefulRampDown: '10s' } },
  thresholds: {
    view_start_ms: ['p(95)<2000'],
    'http_req_failed{name:raw_get}': ['rate<0.01'],
  },
}

export default function () {
  const t0 = Date.now()
  const { res, ticket } = openAsMember(env('PERF_FILE_ID'))
  openMs.add(res.timings.duration)
  if (res.status === 429) limited.add(1)
  if (!check(res, { 'action 200': (r) => r.status === 200 }) || ticket === null) {
    sleep(10)
    return
  }
  const raw = http.get(`${contentOrigin()}/raw/${ticket}`, {
    headers: { 'Sec-Fetch-Dest': 'iframe' }, // a view ticket is only valid for an iframe (06 10.1 step 6)
    redirects: 0,
    tags: { name: 'raw_get' },
  })
  rawTtfb.add(raw.timings.waiting)
  startMs.add(Date.now() - t0)
  if (raw.status === 429) limited.add(1)
  check(raw, { 'raw 200': (r) => r.status === 200 })
  sleep(Math.max(0, 10 - (Date.now() - t0) / 1000))
}
