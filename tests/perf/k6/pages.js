// Page TTFB under load: folder list (S04), folder detail (S05 files tab), file detail (S07), member viewer shell (/view/[fileId]).
// NOT RUN YET. Targets: NF-09 (TTFB p95 <= 1.0 s warm), NF-02 (20 concurrent logins / 10 concurrent viewers).
// Run: k6 run --out json=tests/perf/results/pages-<date>.json tests/perf/k6/pages.js
// Env: PERF_APP_ORIGIN, PERF_COOKIE, PERF_FOLDER_ID, PERF_FILE_ID, PERF_STAGE_HOLD (default 2m).
// Page GETs are not counted by the mutation:user rate limit, but each one does one profile SELECT; the Supavisor pool is the thing to watch.
import http from 'k6/http'
import { check, sleep } from 'k6'
import { Trend } from 'k6/metrics'
import { appOrigin, env, ladder, pageHeaders } from './lib.js'

const ttfb = new Trend('page_ttfb', true)

export const options = {
  scenarios: { pages: { executor: 'ramping-vus', startVUs: 0, stages: ladder(env('PERF_STAGE_HOLD', '2m')), gracefulRampDown: '10s' } },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'page_ttfb{page:folders}': ['p(95)<1000'],
    'page_ttfb{page:folder_detail}': ['p(95)<1000'],
    'page_ttfb{page:file_detail}': ['p(95)<1000'],
    'page_ttfb{page:view_shell}': ['p(95)<1000'],
  },
}

export default function scenario() {
  const folderId = env('PERF_FOLDER_ID')
  const fileId = env('PERF_FILE_ID')
  const targets = [
    ['folders', '/folders'],
    ['folder_detail', `/folders/${folderId}`],
    ['file_detail', `/folders/${folderId}/files/${fileId}`],
    ['view_shell', `/view/${fileId}`],
  ]
  for (const [page, path] of targets) {
    const res = http.get(`${appOrigin()}${path}`, { headers: pageHeaders(), redirects: 0, tags: { page } })
    ttfb.add(res.timings.waiting, { page })
    check(res, { [`${page} 200`]: (r) => r.status === 200 })
    sleep(1)
  }
}
