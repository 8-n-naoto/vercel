// Display formatting (08 6.4). Pure functions shared by client and server. Japan time via UTC arithmetic only.

const JST_OFFSET_MS = 9 * 3600_000
const DASH = '—'

const pad = (n: number): string => String(n).padStart(2, '0')

function jstParts(iso: string): { y: number; mo: number; d: number; h: number; mi: number } | null {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  const t = new Date(ms + JST_OFFSET_MS)
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes() }
}

/** Japan time 'YYYY/MM/DD HH:mm'. null (or unparsable) -> an em dash. */
export function formatDateTime(iso: string | null): string {
  if (iso === null) return DASH
  const p = jstParts(iso)
  return p ? `${p.y}/${pad(p.mo)}/${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}` : DASH
}

/** Japan time 'MM/DD HH:mm' (only for "before publication (10/10 09:00-)"). */
export function formatMonthDayTime(iso: string | null): string {
  if (iso === null) return DASH
  const p = jstParts(iso)
  return p ? `${pad(p.mo)}/${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}` : DASH
}

const UNITS = ['KB', 'MB', 'GB'] as const

function roundForUnit(v: number): number {
  return v < 10 ? Math.round(v * 10) / 10 : Math.round(v)
}

/** 1024-based size. Below 10 one decimal (a trailing .0 is dropped), otherwise an integer. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`
  let unit = 0
  let value = n / 1024
  while (unit < UNITS.length - 1 && value >= 1024) {
    value /= 1024
    unit++
  }
  let rounded = roundForUnit(value)
  // Rounding can reach 1024 (e.g. 1048575 bytes); move to the next unit instead of printing "1024KB".
  if (rounded >= 1024 && unit < UNITS.length - 1) {
    unit++
    rounded = roundForUnit(value / 1024)
  }
  return `${rounded}${UNITS[unit]}`
}

/** floor(ratio * 100) + '%'. The 80% warning is judged on the ratio itself (ratio >= 0.8), not on this text. */
export function formatPercent(ratio: number): string {
  return `${Math.floor(ratio * 100)}%`
}

/** E-03: under 60 seconds in seconds, otherwise in minutes (rounded up). */
export function formatRetryAfter(sec: number): string {
  if (sec < 60) return `（約 ${sec} 秒後に再試行できます）`
  return `（約 ${Math.ceil(sec / 60)} 分後に再試行できます）`
}
