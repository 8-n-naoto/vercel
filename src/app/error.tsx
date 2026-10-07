'use client'
// S15 500 (08 5.15). In production `error.message` is hidden and only `digest` remains; never show message or stack, and do not
// branch on the error type here (type information is lost in production).
import { ErrorScreen } from '@/components/features/common/error-screen'
import { Button } from '@/components/ui/button'
import { message } from '@/lib/messages'

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <>
      <title>エラー</title>
      <ErrorScreen
        variant="internal"
        message={message('common.internal', { requestId: error.digest ?? '-' })}
        actions={
          <Button type="button" onClick={() => reset()}>
            再試行
          </Button>
        }
      />
    </>
  )
}
