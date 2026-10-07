'use client'
// 08 5.2 S02 registration form. The Action redirects on success (/folders, or /login when auto sign-in fails).
import { invitesAccept } from '@/app/_actions/auth'
import { ErrorScreen } from '@/components/features/common/error-screen'
import { FieldError, FormError } from '@/components/features/common/form-message'
import { SubmitButton } from '@/components/features/common/submit-button'
import { useActionForm } from '@/components/features/common/use-action-form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { checkPasswords, formString, PasswordFields } from './token-form-parts'

const FIELDS = ['displayName', 'password', 'passwordConfirm', 'token'] as const

export function InviteAcceptForm({ token, email }: { token: string; email: string }) {
  const { state, pending, onSubmit, fieldError } = useActionForm({
    action: invitesAccept,
    toInput: (fd) => {
      const password = formString(fd, 'password')
      const passwordConfirm = formString(fd, 'passwordConfirm')
      const displayName = formString(fd, 'displayName').trim()
      const errors: Record<string, string> = { ...checkPasswords(password, passwordConfirm) }
      if (displayName.length === 0) errors.displayName = '入力してください'
      else if (displayName.length > 50) errors.displayName = '50 文字以内で入力してください'
      if (Object.keys(errors).length > 0) return { clientError: errors }
      return { token, displayName, password, passwordConfirm }
    },
  })
  // The URL became invalid between the page load and the submit (06 4.3 NOT_FOUND): drop the form, show the same text as S02-2.
  if (state !== null && !state.ok && state.error.code === 'NOT_FOUND') return <ErrorScreen variant="token_invalid" />
  const nameError = fieldError('displayName')

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">アカウント登録</h1>
      <FormError error={state !== null && !state.ok ? state.error : null} knownFields={FIELDS} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">メールアドレス</Label>
        <Input id="email" name="email" type="email" autoComplete="username" value={email} readOnly />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="displayName">表示名</Label>
        <Input
          id="displayName"
          name="displayName"
          type="text"
          autoComplete="name"
          maxLength={50}
          required
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? 'displayName-error' : undefined}
        />
        <FieldError name="displayName" message={nameError} />
      </div>
      <PasswordFields
        passwordLabel="パスワード"
        confirmLabel="パスワード（確認）"
        passwordError={fieldError('password')}
        confirmError={fieldError('passwordConfirm')}
      />
      <SubmitButton pending={pending}>登録する</SubmitButton>
    </form>
  )
}
