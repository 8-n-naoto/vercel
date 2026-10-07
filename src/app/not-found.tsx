import type { Metadata } from 'next'
import { ErrorScreen } from '@/components/features/common/error-screen'

// S15 (08 5.15). The same screen for "does not exist" and "not allowed" so that existence is not revealed.
export const metadata: Metadata = { title: { absolute: 'ページが見つかりません' } }

export default function NotFound() {
  return <ErrorScreen variant="not_found" />
}
