// Shared by server and client (no 'server-only'). Definitions follow 02 8.1 and 06 1.7.
import { message, type MessageKey, type MessageParams } from '@/lib/messages'
export type { PublicDenyReason } from '@/lib/domain'
import type { PublicDenyReason } from '@/lib/domain'

export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  | 'QUOTA_EXCEEDED'
  | 'UPLOAD_NOT_FOUND'
  | 'UPLOAD_VERIFICATION_FAILED'
  | 'ACCESS_DENIED'
  | 'INTERNAL'

export interface AppErrorShape {
  code: ErrorCode
  message: string // user-facing Japanese text resolved from lib/messages.ts (06 1.7)
  fieldErrors?: Record<string, string[]>
  retryAfterSec?: number
  reason?: PublicDenyReason // ACCESS_DENIED
  startsAt?: string // ACCESS_DENIED + NOT_STARTED (D-018 (e))
  requestId?: string // INTERNAL
}

export class AppError extends Error {
  constructor(public readonly shape: AppErrorShape) {
    super(shape.message)
    this.name = 'AppError'
  }
}

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: AppErrorShape }

type AppErrorExtra = Partial<Omit<AppErrorShape, 'code' | 'message'>> & { params?: MessageParams }

/** Builds an AppError whose message is resolved from lib/messages.ts (06 1.7). */
export function appError(code: ErrorCode, messageKey: MessageKey, extra: AppErrorExtra = {}): AppError {
  const { params, ...rest } = extra
  return new AppError({ code, message: message(messageKey, params), ...rest })
}
