// searchParams handling of S01 (08 5.1). Pure, so the page and the tests share it.
import { zNextPath } from '@/lib/schemas/common'

export const LOGIN_CHANGED_MESSAGE = 'パスワードを変更しました。新しいパスワードでログインしてください' // 08 9.4 S01-M1
export const LOGIN_NOTICE = '※ アカウントは招待制です。パスワードを忘れた場合は管理者に連絡してください。' // 08 9.4 S01-N1

type Raw = string | string[] | undefined

/** `next` is used only when it passes zNextPath; anything else (including repeated parameters) becomes null. */
export function parseNext(raw: Raw): string | null {
  if (typeof raw !== 'string') return null
  const r = zNextPath.safeParse(raw)
  return r.success ? r.data : null
}

export function parseLoginParams(sp: Record<string, Raw>): { next: string | null; showChanged: boolean } {
  return { next: parseNext(sp.next), showChanged: sp.reset === '1' || sp.changed === '1' }
}
