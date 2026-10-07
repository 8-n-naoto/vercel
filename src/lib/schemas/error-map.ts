// zod messages in Japanese (08 9.2). zod 4: installed with z.config({ customError }) (06 1.3's z.setErrorMap is the v3 spelling).
// Imported first by src/lib/schemas/common.ts so that every schema gets it. No server-only: used by the browser too.
import { z } from 'zod'

/** Identifiers passed as the 2nd argument of refine() -> message (08 9.2). A schema-level message wins over customError in zod 4,
 *  so the identifier reaches the issue as its message; translateIssueMessage() maps it when fieldErrors are built. */
export const REFINE_MESSAGES = {
  password_mismatch: 'パスワードが一致しません',
  password_same_as_current: '現在と異なるパスワードを指定してください',
  ends_before_starts: '終了日時は開始日時より後にしてください',
  duplicate: '同じユーザーが重複して選択されています',
  extension: '.html または .htm のファイルを選択してください',
  invalid_chars: 'ファイル名に使用できない文字が含まれています',
  empty: '変更する項目がありません',
  invalid_next: '入力内容が正しくありません',
} as const satisfies Record<string, string>

export const GENERIC_INVALID = '入力内容が正しくありません'
const REQUIRED = '入力してください'

const IDENTIFIER = /^[a-z][a-z0-9_]*$/

/** Maps a refine() identifier to its message. Unknown identifiers (and any other English text) become the generic message. */
export function translateIssueMessage(message: string): string {
  if (message === '') return GENERIC_INVALID
  if (Object.hasOwn(REFINE_MESSAGES, message)) return REFINE_MESSAGES[message as keyof typeof REFINE_MESSAGES]
  return IDENTIFIER.test(message) ? GENERIC_INVALID : message
}

type Issue = {
  code: string
  origin?: string
  minimum?: number | bigint
  maximum?: number | bigint
  format?: string
  expected?: string
  input?: unknown
  message?: string
}

export function japaneseIssueMessage(iss: Issue): string {
  switch (iss.code) {
    case 'invalid_type':
      if (iss.expected === 'int') return '整数を入力してください'
      return iss.input === undefined ? REQUIRED : GENERIC_INVALID
    case 'too_small': {
      const min = Number(iss.minimum)
      if (iss.origin === 'string') return min <= 1 ? REQUIRED : `${min} 文字以上で入力してください`
      if (iss.origin === 'array' || iss.origin === 'set') return `${min} 件以上選択してください`
      return `${min} 以上の数値を入力してください`
    }
    case 'too_big': {
      const max = Number(iss.maximum)
      if (iss.origin === 'string') return `${max} 文字以内で入力してください`
      if (iss.origin === 'array' || iss.origin === 'set') return `一度に選択できるのは ${max} 件までです`
      return `${max} 以下の数値を入力してください`
    }
    case 'invalid_format':
      if (iss.format === 'email') return 'メールアドレスの形式が正しくありません'
      if (iss.format === 'datetime') return '日時の形式が正しくありません'
      return GENERIC_INVALID
    case 'invalid_value':
      return '選択肢から選んでください'
    case 'custom':
      return translateIssueMessage(iss.message ?? '')
    default:
      return GENERIC_INVALID // unrecognized_keys, not_multiple_of, invalid_union, ...
  }
}

z.config({ customError: (iss) => japaneseIssueMessage(iss as Issue) })
