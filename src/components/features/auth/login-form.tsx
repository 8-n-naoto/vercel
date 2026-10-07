'use client'
// 08 5.1 S01 login form. The Action redirects on success, so there is no onSuccess here.
import { authSignIn } from '@/app/_actions/auth'
import { FieldError, FormError } from '@/components/features/common/form-message'
import { SubmitButton } from '@/components/features/common/submit-button'
import { useActionForm } from '@/components/features/common/use-action-form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { parseNext, LOGIN_NOTICE } from './login-params'

const FIELDS = ['email', 'password', 'next'] as const

export function LoginForm({ next }: { next: string | null }) {
  const { state, pending, onSubmit, fieldError } = useActionForm({
    action: authSignIn,
    toInput: (fd) => {
      const get = (n: string): string => {
        const v = fd.get(n)
        return typeof v === 'string' ? v : ''
      }
      return { email: get('email'), password: get('password'), next: parseNext(get('next')) }
    },
  })
  const emailError = fieldError('email')
  const passwordError = fieldError('password')

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">ログイン</h1>
      <FormError error={state !== null && !state.ok ? state.error : null} knownFields={FIELDS} />
      <input type="hidden" name="next" value={next ?? ''} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">メールアドレス</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? 'email-error' : undefined}
        />
        <FieldError name="email" message={emailError} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">パスワード</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={passwordError ? true : undefined}
          aria-describedby={passwordError ? 'password-error' : undefined}
        />
        <FieldError name="password" message={passwordError} />
      </div>
      <SubmitButton pending={pending}>ログイン</SubmitButton>
      <p className="text-sm text-muted-foreground">{LOGIN_NOTICE}</p>
    </form>
  )
}
