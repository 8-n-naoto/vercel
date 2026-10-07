// Test vectors for decideQuota. Copied one row per case from 07 6.3 (QT-01..QT-08, IDs preserved). L = 943,718,400.
export const L = 943_718_400
export const MB100 = 104_857_600

export const QT_CASES: {
  id: string; userUsed: number; totalUsed: number; addBytes: number; userLimit: number; totalLimit: number; expected: 'ok' | 'user' | 'total'
}[] = [
  { id: 'QT-01', userUsed: 0, totalUsed: 0, addBytes: 52_428_800, userLimit: L, totalLimit: L, expected: 'ok' },
  { id: 'QT-02', userUsed: L - 100, totalUsed: L - 100, addBytes: 100, userLimit: L, totalLimit: L, expected: 'ok' },
  { id: 'QT-03', userUsed: L - 100, totalUsed: L - 100, addBytes: 101, userLimit: L, totalLimit: L, expected: 'user' },
  { id: 'QT-04', userUsed: 0, totalUsed: L - 100, addBytes: 101, userLimit: L, totalLimit: L, expected: 'total' },
  { id: 'QT-05', userUsed: L + 500, totalUsed: L + 500, addBytes: 0, userLimit: L, totalLimit: L, expected: 'ok' },
  { id: 'QT-06', userUsed: L + 500, totalUsed: L + 500, addBytes: -10, userLimit: L, totalLimit: L, expected: 'ok' },
  { id: 'QT-07', userUsed: 100_000_000, totalUsed: L, addBytes: 1, userLimit: L, totalLimit: L, expected: 'total' },
  // 07 row has addBytes 100, which lands exactly on the 100 MB limit (= ok); 101 matches the stated intent (see T-013 report).
  { id: 'QT-08', userUsed: 104_857_500, totalUsed: 104_857_500, addBytes: 101, userLimit: MB100, totalLimit: L, expected: 'user' },
]

// Additions outside 07 (T-018, F-003 proposal 7). X-marked IDs never collide with 07 IDs.
const MAX = Number.MAX_SAFE_INTEGER
export const QT_X_CASES: typeof QT_CASES = [
  // userLimit larger than totalLimit: the total limit still applies
  { id: 'QT-X01', userUsed: 0, totalUsed: 0, addBytes: 100, userLimit: 1000, totalLimit: 50, expected: 'total' },
  { id: 'QT-X02', userUsed: 0, totalUsed: 0, addBytes: 50, userLimit: 1000, totalLimit: 50, expected: 'ok' },
  // near the safe integer limit
  { id: 'QT-X03', userUsed: MAX - 10, totalUsed: MAX - 10, addBytes: 10, userLimit: MAX, totalLimit: MAX, expected: 'ok' },
  { id: 'QT-X04', userUsed: MAX - 10, totalUsed: MAX - 10, addBytes: 11, userLimit: MAX, totalLimit: MAX, expected: 'user' },
  // inconsistent data (userUsed > totalUsed): each limit is judged on its own value
  { id: 'QT-X05', userUsed: 500, totalUsed: 100, addBytes: 10, userLimit: 1000, totalLimit: 105, expected: 'total' },
  { id: 'QT-X06', userUsed: 500, totalUsed: 100, addBytes: 600, userLimit: 1000, totalLimit: 10_000, expected: 'user' },
  // zero limits reject any growth
  { id: 'QT-X07', userUsed: 0, totalUsed: 0, addBytes: 1, userLimit: 0, totalLimit: L, expected: 'user' },
]
