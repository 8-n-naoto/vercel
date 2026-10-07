#!/usr/bin/env bash
# Single-request TTFB / total time per page, with the first request labelled "first" (cold if the deployment was idle) and the rest "warm".
# NOT RUN YET (T-048: no test environment). No load: sequential requests only.
#
# Usage:  PERF_APP_ORIGIN=... PERF_COOKIE=... PERF_FOLDER_ID=... PERF_FILE_ID=... bash tests/perf/curl/ttfb.sh [warm_count]
#   Cold measurement: do not call the app for at least 15 minutes (Vercel Hobby functions are reclaimed after idle), then run once.
#   Record the idle time next to the CSV. Output: CSV on stdout (redirect to tests/perf/results/ttfb-<date>.csv).
# The cookie is passed through a 0600 temporary header file so it does not show up in the process list. It is never printed.
set -euo pipefail

: "${PERF_APP_ORIGIN:?PERF_APP_ORIGIN is required}"
: "${PERF_COOKIE:?PERF_COOKIE is required}"
: "${PERF_FOLDER_ID:?PERF_FOLDER_ID is required}"
: "${PERF_FILE_ID:?PERF_FILE_ID is required}"
WARM="${1:-10}"
ORIGIN="${PERF_APP_ORIGIN%/}"

HDR="$(mktemp)"
trap 'rm -f "$HDR"' EXIT
chmod 600 "$HDR"
printf 'Cookie: %s\n' "$PERF_COOKIE" >"$HDR"

PAGES=(
  "login:/login:anon"
  "folders:/folders:auth"
  "folder_detail:/folders/${PERF_FOLDER_ID}:auth"
  "file_detail:/folders/${PERF_FOLDER_ID}/files/${PERF_FILE_ID}:auth"
  "view_shell:/view/${PERF_FILE_ID}:auth"
)

echo "page,phase,http_code,ttfb_s,total_s,size_download_bytes"
for entry in "${PAGES[@]}"; do
  IFS=':' read -r name path mode <<<"$entry"
  for ((i = 0; i <= WARM; i++)); do
    phase=warm
    [ "$i" -eq 0 ] && phase=first
    args=(-s -o /dev/null --max-time 60 -w "${name},${phase},%{http_code},%{time_starttransfer},%{time_total},%{size_download}\n")
    [ "$mode" = "auth" ] && args+=(-H "@${HDR}")
    curl "${args[@]}" "${ORIGIN}${path}"
    sleep 0.5
  done
done
