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
