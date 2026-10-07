'use client'
// 08 5.3 S03 reset form. No email / display name. The Action redirects to /login?reset=1 on success.
import { passwordResetComplete } from '@/app/_actions/auth'
import { ErrorScreen } from '@/components/features/common/error-screen'
import { FormError } from '@/components/features/common/form-message'
import { SubmitButton } from '@/components/features/common/submit-button'
import { useActionForm } from '@/components/features/common/use-action-form'
import { message } from '@/lib/messages'
import { checkPasswords, formString, PasswordFields } from './token-form-parts'

const FIELDS = ['password', 'passwordConfirm', 'token'] as const

export function PasswordResetForm({ token }: { token: string }) {
  const { state, pending, onSubmit, fieldError } = useActionForm({
    action: passwordResetComplete,
    toInput: (fd) => {
      const password = formString(fd, 'password')
      const passwordConfirm = formString(fd, 'passwordConfirm')
      const errors = checkPasswords(password, passwordConfirm)
      if (errors) return { clientError: errors }
      return { token, password, passwordConfirm }
    },
  })
  // 06 4.4 NOT_FOUND (reset.invalid): drop the form and show the invalid-URL text.
  if (state !== null && !state.ok && state.error.code === 'NOT_FOUND') return <ErrorScreen variant="token_invalid" message={message('reset.invalid')} />

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">パスワード再設定</h1>
      <FormError error={state !== null && !state.ok ? state.error : null} knownFields={FIELDS} />
      <PasswordFields
        passwordLabel="新しいパスワード"
        confirmLabel="新しいパスワード（確認）"
        passwordError={fieldError('password')}
        confirmError={fieldError('passwordConfirm')}
      />
      <SubmitButton pending={pending}>変更する</SubmitButton>
    </form>
  )
}
