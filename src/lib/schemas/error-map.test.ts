import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import '@/lib/schemas/common' // installs the error map
import { translateIssueMessage } from '@/lib/schemas/error-map'

function msg(schema: z.ZodType, value: unknown): string {
  const r = schema.safeParse(value)
  if (r.success) throw new Error('expected failure')
  return r.error.issues[0]?.message ?? ''
}

describe('zod messages (08 9.2, zod 4)', () => {
  it.each([
    ['required: undefined', z.string(), undefined, '入力してください'],
    ['required: empty string (min 1)', z.string().min(1), '', '入力してください'],
    ['too short', z.string().min(3), 'a', '3 文字以上で入力してください'],
    ['too long', z.string().max(2), 'abc', '2 文字以内で入力してください'],
    ['number lower bound', z.number().min(2), 1, '2 以上の数値を入力してください'],
    ['number upper bound', z.number().max(2), 3, '2 以下の数値を入力してください'],
    ['not an integer', z.number().int(), 1.5, '整数を入力してください'],
    ['array lower bound', z.array(z.string()).min(1), [], '1 件以上選択してください'],
    ['array upper bound', z.array(z.string()).max(1), ['a', 'b'], '一度に選択できるのは 1 件までです'],
    ['email', z.string().email(), 'x', 'メールアドレスの形式が正しくありません'],
    ['datetime', z.iso.datetime({ offset: true }), 'x', '日時の形式が正しくありません'],
    ['enum', z.enum(['a']), 'b', '選択肢から選んでください'],
    ['uuid', z.uuid(), 'x', '入力内容が正しくありません'],
    ['regex', z.string().regex(/^a$/), 'b', '入力内容が正しくありません'],
    ['wrong type', z.number(), 'x', '入力内容が正しくありません'],
    ['unknown key (strict)', z.object({ a: z.string() }).strict(), { a: 'x', b: 1 }, '入力内容が正しくありません'],
    ['custom without message', z.string().refine(() => false), 'x', '入力内容が正しくありません'],
  ])('%s', (_name, schema, value, expected) => {
    expect(msg(schema, value)).toBe(expected)
  })

  it.each([
    ['password_mismatch', 'パスワードが一致しません'],
    ['password_same_as_current', '現在と異なるパスワードを指定してください'],
    ['ends_before_starts', '終了日時は開始日時より後にしてください'],
    ['duplicate', '同じユーザーが重複して選択されています'],
    ['extension', '.html または .htm のファイルを選択してください'],
    ['invalid_chars', 'ファイル名に使用できない文字が含まれています'],
    ['empty', '変更する項目がありません'],
    ['invalid_next', '入力内容が正しくありません'],
    ['something_unknown', '入力内容が正しくありません'],
    ['', '入力内容が正しくありません'],
  ])('refine identifier %s', (id, expected) => {
    expect(translateIssueMessage(id)).toBe(expected)
  })

  it('does not leak English default messages', () => {
    for (const [schema, value] of [[z.string().min(3), 'a'], [z.number(), 'x'], [z.object({}).strict(), { a: 1 }]] as const) {
      expect(msg(schema, value)).not.toMatch(/[A-Za-z]{4,}/)
    }
  })
})
