#!/usr/bin/env bash
# One viewing-start measurement: view.openAsMember (Server Action) then GET /raw/<ticket>, with an optional bandwidth cap (NF-11 / NF-12).
# NOT RUN YET (T-048: no test environment).
#
# EGRESS WARNING: with the 50 MB file each run consumes about 50 MB of the 5 GB/month Supabase egress. Run at most 3 times per check (runbook 10).
# Usage:  PERF_APP_ORIGIN=... PERF_CONTENT_ORIGIN=... PERF_COOKIE=... PERF_ACTION_ID_OPEN=... PERF_FILE_ID=... \
#           bash tests/perf/curl/raw-stream.sh [rate_limit]      # rate_limit like 2500k (= 20 Mbps) or empty for no cap
# Output: one CSV line (http_code, action_s, raw_ttfb_s, raw_total_s, bytes, speed_bytes_per_s). Redirect to tests/perf/results/.
# Neither the cookie nor the ticket is printed.
set -euo pipefail

: "${PERF_APP_ORIGIN:?PERF_APP_ORIGIN is required}"
: "${PERF_CONTENT_ORIGIN:?PERF_CONTENT_ORIGIN is required}"
: "${PERF_COOKIE:?PERF_COOKIE is required}"
: "${PERF_ACTION_ID_OPEN:?PERF_ACTION_ID_OPEN is required (see tests/perf/README.md)}"
: "${PERF_FILE_ID:?PERF_FILE_ID is required}"
APP="${PERF_APP_ORIGIN%/}"
CONTENT="${PERF_CONTENT_ORIGIN%/}"
LIMIT="${1:-}"

HDR="$(mktemp)"
BODY="$(mktemp)"
trap 'rm -f "$HDR" "$BODY"' EXIT
chmod 600 "$HDR" "$BODY"
printf 'Cookie: %s\n' "$PERF_COOKIE" >"$HDR"

ACTION_TIME="$(curl -s -o "$BODY" --max-time 30 -w '%{time_total}' \
  -H "@${HDR}" -H "Next-Action: ${PERF_ACTION_ID_OPEN}" -H 'Content-Type: text/plain;charset=UTF-8' \
  -H 'Accept: text/x-component' -H "Origin: ${APP}" \
  --data "[{\"fileId\":\"${PERF_FILE_ID}\"}]" "${APP}/view/${PERF_FILE_ID}")"
TICKET="$(grep -o '/raw/[A-Za-z0-9_-]*' "$BODY" | head -1 | sed 's#/raw/##' || true)"
if [ -z "$TICKET" ]; then
  echo "action did not return a ticket (wrong action id, expired session, rate limit or access denied)" >&2
  exit 1
fi

args=(-s -o /dev/null --max-time 300 -H 'Sec-Fetch-Dest: iframe' \
  -w "%{http_code},${ACTION_TIME},%{time_starttransfer},%{time_total},%{size_download},%{speed_download}\n")
[ -n "$LIMIT" ] && args+=(--limit-rate "$LIMIT")
echo "http_code,action_s,raw_ttfb_s,raw_total_s,bytes,speed_bytes_per_s"
curl "${args[@]}" "${CONTENT}/raw/${TICKET}"
