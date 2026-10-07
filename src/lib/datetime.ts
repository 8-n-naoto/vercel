// Japan-time input conversion (08 6.3). Pure functions shared by client and server. Uses UTC arithmetic only:
// Japan has no daylight saving time, so a fixed +09:00 offset is exact, and the browser time zone must never matter.

const JST_OFFSET_MS = 9 * 3600_000
const MINUTE_INPUT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
const SECOND_INPUT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/

/** Input value ('YYYY-MM-DDTHH:mm', Japan time) to the string sent to an Action. Empty -> null. Unknown formats pass through unchanged. */
export function jstInputToIso(v: FormDataEntryValue | null): string | null {
  if (typeof v !== 'string' || v === '') return null
  if (MINUTE_INPUT.test(v)) return `${v}:00+09:00`
  if (SECOND_INPUT.test(v)) return `${v}+09:00`
  return v // the server-side zod returns the "invalid datetime" message
}

function toJstInput(ms: number): string {
  return new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 16)
}

/** UTC ISO (DTO value) to the input value (Japan time, 'YYYY-MM-DDTHH:mm'). null or unparsable -> ''. */
export function isoToJstInput(iso: string | null): string {
  if (iso === null) return ''
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? '' : toJstInput(ms)
}

/** now + days (Japan time, truncated to the minute) as an input value (default of the share link dialog). */
export function jstInputAfterDays(now: Date, days: number): string {
  return toJstInput(now.getTime() + days * 86_400_000)
}
