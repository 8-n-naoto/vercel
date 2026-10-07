'use client'
// 08 5.14 S14 password section. Success is a server redirect to /login?changed=1, so there is no success state here.
import type { FormEvent } from 'react'
import { accountChangePassword } from '@/app/_actions/account'
import { checkPasswords, formString } from '@/components/features/auth/token-form-parts'
import { FieldError, FormError } from '@/components/features/common/form-message'
import { SubmitButton } from '@/components/features/common/submit-button'
import { useActionForm, type ActionFormState } from '@/components/features/common/use-action-form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const PASSWORD_CHANGE_NOTE = '変更すると、すべての端末でログアウトされます' // 08 9.4 S14-N1
const REQUIRED_TEXT = '入力してください'
const FIELDS = ['currentPassword', 'newPassword', 'newPasswordConfirm'] as const

/** Client-side check (08 6.2) keyed by the field names of the Action. The server runs the same rules through zod. */
export function checkChangePassword(current: string, next: string, confirm: string): Record<string, string> | null {
  const errors: Record<string, string> = {}
  if (current.length === 0) errors.currentPassword = REQUIRED_TEXT
  const pair = checkPasswords(next, confirm)
  if (pair?.password) errors.newPassword = pair.password
  if (pair?.passwordConfirm) errors.newPasswordConfirm = pair.passwordConfirm
  return Object.keys(errors).length > 0 ? errors : null
}

export interface ChangePasswordFormViewProps {
  state: ActionFormState<unknown>
  pending: boolean
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
  fieldError: (name: string) => string | undefined
}

function PasswordField({
  name,
  label,
  autoComplete,
  error,
}: {
  name: (typeof FIELDS)[number]
  label: string
  autoComplete: 'current-password' | 'new-password'
  error: string | undefined
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type="password"
        autoComplete={autoComplete}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${name}-error` : undefined}
      />
      <FieldError name={name} message={error} />
    </div>
  )
}

/** Pure view. Inputs are uncontrolled and the form is never reset, so typed values survive an error (08 6.1). */
export function ChangePasswordFormView({ state, pending, onSubmit, fieldError }: ChangePasswordFormViewProps) {
  return (
    <section aria-labelledby="password-heading">
      <h2 id="password-heading" className="mb-3 text-lg font-semibold">
        パスワード変更
      </h2>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormError error={state !== null && !state.ok ? state.error : null} knownFields={FIELDS} />
        <PasswordField name="currentPassword" label="現在のパスワード" autoComplete="current-password" error={fieldError('currentPassword')} />
        <PasswordField name="newPassword" label="新しいパスワード" autoComplete="new-password" error={fieldError('newPassword')} />
        <PasswordField name="newPasswordConfirm" label="新しいパスワード（確認）" autoComplete="new-password" error={fieldError('newPasswordConfirm')} />
        <p className="text-sm text-muted-foreground">{PASSWORD_CHANGE_NOTE}</p>
        <div>
          <SubmitButton pending={pending}>パスワードを変更</SubmitButton>
        </div>
      </form>
    </section>
  )
}

export function ChangePasswordForm() {
  const { state, pending, onSubmit, fieldError } = useActionForm({
    action: accountChangePassword,
    toInput: (fd) => {
      const currentPassword = formString(fd, 'currentPassword')
      const newPassword = formString(fd, 'newPassword')
      const newPasswordConfirm = formString(fd, 'newPasswordConfirm')
      const errors = checkChangePassword(currentPassword, newPassword, newPasswordConfirm)
      if (errors) return { clientError: errors }
      return { currentPassword, newPassword, newPasswordConfirm }
    },
  })
  return <ChangePasswordFormView state={state} pending={pending} onSubmit={onSubmit} fieldError={fieldError} />
}
