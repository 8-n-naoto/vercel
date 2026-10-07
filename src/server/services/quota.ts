// Upload quota (07 6). Only the pure part exists here; checkQuota (DB) arrives with the upload WP.
export interface QuotaInput {
  userUsed: number
  totalUsed: number
  addBytes: number
  userLimit: number
  totalLimit: number
}

/** Shrinking or no growth is always ok. The per-user check comes first. Exactly at the limit is ok. */
export function decideQuota(i: QuotaInput): 'ok' | 'user' | 'total' {
  if (i.addBytes <= 0) return 'ok'
  if (i.userUsed + i.addBytes > i.userLimit) return 'user'
  if (i.totalUsed + i.addBytes > i.totalLimit) return 'total'
  return 'ok'
}
