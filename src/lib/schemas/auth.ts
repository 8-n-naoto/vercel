// Input schemas of the auth Actions (06 4). Shared by client and server.
import { z } from 'zod'
import { zDisplayName, zEmail, zLoginPassword, zNextPath, zToken } from './common'

export const authSignInInput = z
  .object({
    email: zEmail,
    password: z.string().min(1).max(72),
    next: zNextPath.nullable().default(null),
  })
  .strict()

// 06 4.2
// default({}): UserMenu calls the Action without arguments (08 3.1).
export const authSignOutInput = z.object({}).strict().default({})

export type AuthSignInInput = z.input<typeof authSignInInput>

// 06 4.3. The refine identifier 'password_mismatch' is mapped to the Japanese message by error-map.
export const invitesAcceptInput = z
  .object({
    token: zToken,
    displayName: zDisplayName,
    password: zLoginPassword,
    passwordConfirm: z.string(),
  })
  .strict()
  .refine((v) => v.password === v.passwordConfirm, { path: ['passwordConfirm'], message: 'password_mismatch' })

// 06 4.4
export const passwordResetCompleteInput = z
  .object({
    token: zToken,
    password: zLoginPassword,
    passwordConfirm: z.string(),
  })
  .strict()
  .refine((v) => v.password === v.passwordConfirm, { path: ['passwordConfirm'], message: 'password_mismatch' })

export type InvitesAcceptInput = z.input<typeof invitesAcceptInput>
export type PasswordResetCompleteInput = z.input<typeof passwordResetCompleteInput>
