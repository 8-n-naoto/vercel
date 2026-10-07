// Parts shared by S02 / S03 (08 5.2 / 5.3): the password pair, its client-side check and the 12..72 notice.
import { FieldError } from '@/components/features/common/form-message'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const PASSWORD_NOTICE = '※ パスワードは 12 文字以上 72 文字以内' // 08 9.4 S02-N1
export const PASSWORD_TOO_SHORT = '12 文字以上で入力してください' // same text as the zod too_small message (08 9.2)
export const PASSWORD_TOO_LONG = '72 文字以内で入力してください'
export const PASSWORD_MISMATCH = 'パスワードが一致しません'

export function formString(fd: FormData, name: string): string {
  const v = fd.get(name)
  return typeof v === 'string' ? v : ''
}

/** Client-side check (08 6.2). The server runs the same rules through zod. Returns the errors keyed by field name, or null. */
export function checkPasswords(password: string, passwordConfirm: string): Record<string, string> | null {
  const errors: Record<string, string> = {}
  if (password.length < 12) errors.password = PASSWORD_TOO_SHORT
  else if (password.length > 72) errors.password = PASSWORD_TOO_LONG
  if (password !== passwordConfirm) errors.passwordConfirm = PASSWORD_MISMATCH
  return Object.keys(errors).length > 0 ? errors : null
}

export function PasswordFields({
  passwordLabel,
  confirmLabel,
  passwordError,
  confirmError,
}: {
  passwordLabel: string
  confirmLabel: string
  passwordError: string | undefined
  confirmError: string | undefined
}) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">{passwordLabel}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={passwordError ? true : undefined}
          aria-describedby={passwordError ? 'password-error' : undefined}
        />
        <FieldError name="password" message={passwordError} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="passwordConfirm">{confirmLabel}</Label>
        <Input
          id="passwordConfirm"
          name="passwordConfirm"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={confirmError ? true : undefined}
          aria-describedby={confirmError ? 'passwordConfirm-error' : undefined}
        />
        <FieldError name="passwordConfirm" message={confirmError} />
      </div>
      <p className="text-sm text-muted-foreground">{PASSWORD_NOTICE}</p>
    </>
  )
}
