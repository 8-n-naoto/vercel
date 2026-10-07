'use client'
// Replaces the root layout when it fails (08 5.15), so it renders <html> itself. No environment banner here (08 3.5).
import './globals.css'
import { ErrorScreen } from '@/components/features/common/error-screen'
import { Button } from '@/components/ui/button'
import { message } from '@/lib/messages'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ja">
      <body className="flex min-h-dvh flex-col">
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
      </body>
    </html>
  )
}
