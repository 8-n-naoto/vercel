// 06 1.8
import 'server-only'
import { randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import { headers } from 'next/headers'
import type { RequestMeta } from '@/server/actions/define-action'

export async function getRequestMeta(): Promise<RequestMeta> {
  const h = await headers()
  // x-forwarded-for is overwritten by Vercel; take the first element. null when it is not a valid inet value.
  const first = (h.get('x-forwarded-for') ?? '').split(',')[0]?.trim() ?? ''
  const ip = isIP(first) !== 0 && !first.includes('%') ? first : null
  const userAgent = h.get('user-agent')?.slice(0, 256) ?? null
  return { ip, userAgent, requestId: h.get('x-vercel-id') ?? randomUUID() }
}
