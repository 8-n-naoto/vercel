// Input schemas of the account Actions (06 4.5 / 4.6). Shared by client and server.
import { z } from 'zod'
import { zDisplayName, zLoginPassword } from './common'

export const accountUpdateProfileInput = z.object({ displayName: zDisplayName }).strict()

export const accountChangePasswordInput = z
  .object({
    currentPassword: z.string().min(1).max(72),
    newPassword: zLoginPassword,
    newPasswordConfirm: z.string(),
  })
  .strict()
  .refine((v) => v.newPassword === v.newPasswordConfirm, { path: ['newPasswordConfirm'], message: 'password_mismatch' })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ['newPassword'], message: 'password_same_as_current' })

export type AccountUpdateProfileInput = z.input<typeof accountUpdateProfileInput>
export type AccountChangePasswordInput = z.input<typeof accountChangePasswordInput>
