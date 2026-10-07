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
  // D-020: any non-finite number is rejected (NaN would make every comparison false and return ok).
  if (![i.userUsed, i.totalUsed, i.addBytes, i.userLimit, i.totalLimit].every(Number.isFinite)) return 'user'
  if (i.addBytes <= 0) return 'ok'
  if (i.userUsed + i.addBytes > i.userLimit) return 'user'
  if (i.totalUsed + i.addBytes > i.totalLimit) return 'total'
  return 'ok'
}
