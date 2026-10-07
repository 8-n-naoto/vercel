// URL query -> AccessLogFilter / page number (06 9.7, 08 5.5). Invalid values are dropped (treated as not specified), never an error.
import { z } from 'zod'
import { ACCESS_RESULTS, ACCESS_VIAS } from '@/lib/domain'
import type { AccessLogFilter } from '@/lib/dto'
import { zIsoDateTime, zUuid } from './common'

export const ACCESS_LOG_PAGE_SIZE = 50

const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v)
const zResult = z.enum(ACCESS_RESULTS)
const zVia = z.enum(ACCESS_VIAS)

/** Accepts a searchParams-like record. Unknown keys are ignored. */
export function parseAccessLogFilter(raw: Record<string, unknown>): AccessLogFilter {
  const out: AccessLogFilter = {}
  const fileId = zUuid.safeParse(first(raw.fileId))
  if (fileId.success) out.fileId = fileId.data
  const result = zResult.safeParse(first(raw.result))
  if (result.success) out.result = result.data
  const via = zVia.safeParse(first(raw.via))
  if (via.success) out.via = via.data
  const from = zIsoDateTime.safeParse(first(raw.from))
  if (from.success) out.from = from.data
  const to = zIsoDateTime.safeParse(first(raw.to))
  if (to.success) out.to = to.data
  return out
}

/** A missing, non-integer or < 1 page becomes 1. */
export function parsePageNumber(raw: unknown): number {
  const v = first(raw)
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^[0-9]{1,6}$/.test(v) ? Number(v) : NaN
  return Number.isInteger(n) && n >= 1 ? n : 1
}
