import { ErrorScreen } from '@/components/features/common/error-screen'

// S15 for an invalid public link (08 5.15). No link to the app: viewers must not learn that an internal area exists.
export default function ShareNotFound() {
  return <ErrorScreen variant="share_invalid" />
}
