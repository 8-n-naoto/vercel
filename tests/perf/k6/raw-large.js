// 50 MB delivery through /raw (streaming pass-through of Supabase Storage). NOT RUN YET.
// Targets: NF-12 (50 MB complete in 30 s at 20 Mbps, function duration < 300 s), NF-08 (egress).
// EGRESS WARNING: every iteration consumes about 50 MB of the 5 GB/month Supabase egress. Default is 3 iterations, 1 VU (runbook 10: at most 3 per check).
// Run: k6 run --out json=tests/perf/results/raw-large-<date>.json -e PERF_LARGE_ITERATIONS=3 tests/perf/k6/raw-large.js
// Env: PERF_APP_ORIGIN, PERF_CONTENT_ORIGIN, PERF_COOKIE, PERF_ACTION_ID_OPEN, PERF_LARGE_FILE_ID (an active file of about 50 MB), PERF_LARGE_ITERATIONS (default 3).
// k6 measures from the load generator, so the result includes the generator's line speed; use tests/perf/curl/raw-stream.sh with --limit-rate for the 20 Mbps case.
import http from 'k6/http'
import { check } from 'k6'
import { Trend } from 'k6/metrics'
import { contentOrigin, env, openAsMember } from './lib.js'

const first = new Trend('raw_first_byte', true)
const total = new Trend('raw_total', true)

export const options = {
  scenarios: { large: { executor: 'per-vu-iterations', vus: 1, iterations: Number(env('PERF_LARGE_ITERATIONS', '3')), maxDuration: '10m' } },
  thresholds: { raw_total: ['max<30000'], http_req_failed: ['rate<0.01'] },
}

export default function () {
  const { res, ticket } = openAsMember(env('PERF_LARGE_FILE_ID'))
  if (!check(res, { 'action 200': (r) => r.status === 200 }) || ticket === null) return
  const raw = http.get(`${contentOrigin()}/raw/${ticket}`, { headers: { 'Sec-Fetch-Dest': 'iframe' }, redirects: 0, tags: { name: 'raw_large' }, timeout: '300s' })
  first.add(raw.timings.waiting)
  total.add(raw.timings.duration)
  check(raw, { 'raw 200': (r) => r.status === 200, 'raw has body': (r) => r.body !== null && r.body.length > 40 * 1024 * 1024 })
}
