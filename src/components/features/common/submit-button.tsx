'use client'
// 08 4.2. Disabled while pending to prevent double submission of non-idempotent Actions (06 6.1).
import { Button } from '@/components/ui/button'

export function SubmitButton({ pending, children, ...rest }: { pending: boolean } & Omit<React.ComponentProps<typeof Button>, 'type'>) {
  return (
    <Button type="submit" {...rest} disabled={pending || rest.disabled}>
      {pending ? '処理中…' : children}
    </Button>
  )
}
