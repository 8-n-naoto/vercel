// Test vectors for security/tokens.ts. Copied one row per case from 07 3 (IDs preserved). TK-04 (1000 generations) is in the test.
export const rep = (ch: string, n: number): string => ch.repeat(n)

export const ENCODE_CASES: { id: string; bytes: number[]; expected: string }[] = [
  { id: 'TK-01', bytes: new Array<number>(32).fill(0x00), expected: rep('A', 43) },
  { id: 'TK-02', bytes: new Array<number>(32).fill(0xff), expected: rep('_', 42) + '8' },
]

export const FORMAT_CASES: { id: string; input: unknown; expected: boolean }[] = [
  { id: 'TK-07', input: rep('A', 43), expected: true },
  { id: 'TK-08', input: rep('A', 42), expected: false },
  { id: 'TK-09', input: rep('A', 44), expected: false },
  { id: 'TK-10', input: rep('A', 42) + '+', expected: false },
  { id: 'TK-11', input: rep('A', 42) + '=', expected: false },
  { id: 'TK-12a', input: rep('A', 42) + ' ', expected: false },
  { id: 'TK-12b', input: rep('A', 42) + 'Ａ', expected: false },
  { id: 'TK-12c', input: null, expected: false },
  { id: 'TK-12d', input: 123, expected: false },
]

// Additions outside 07 (T-018, F-003 proposal 10). IDs use the X marker so they never collide with 07 IDs.
export const FORMAT_X_CASES: { id: string; input: unknown; expected: boolean }[] = [
  { id: 'TK-X01', input: rep('A', 43) + '\n', expected: false }, // 43 valid chars + trailing LF (44 chars)
  { id: 'TK-X02', input: rep('A', 42) + '\n', expected: false }, // 43 chars where the last is LF
  { id: 'TK-X03', input: '\n' + rep('A', 42), expected: false },
  { id: 'TK-X04', input: '', expected: false },
  { id: 'TK-X05', input: undefined, expected: false },
]

export const HASH_X_CASES: { id: string; input: string; expected: string }[] = [
  { id: 'TK-X06', input: '', expected: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  { id: 'TK-X07', input: 'あ', expected: 'dc5a4d3d82f7e15792959dc661538ae0e541ce66494516f5c9cfd9cd3308494d' }, // UTF-8 encoded before hashing
]
